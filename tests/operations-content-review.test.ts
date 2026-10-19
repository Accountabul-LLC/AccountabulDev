import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  contentReviewRequiresNote,
  credentialReviewRequiresNote,
  isContentReviewDecision,
  isCredentialReviewDecision,
} from "../src/lib/operations/content-review.ts";
import {
  parseReviewRequest,
  reviewRpcErrorResponse,
} from "../src/lib/operations/review-request.ts";

const VALID_ID = "d94a51b7-0dd9-4db8-b65c-14b88ab4da2c";
const migration = readFileSync(
  new URL("../supabase/migrations/20260901174957_operations_content_review.sql", import.meta.url),
  "utf8",
);
const propertyRoute = readFileSync(
  new URL("../src/routes/api/internal/ops/properties.ts", import.meta.url),
  "utf8",
);
const serviceRoute = readFileSync(
  new URL("../src/routes/api/internal/ops/services.ts", import.meta.url),
  "utf8",
);
const credentialRoute = readFileSync(
  new URL("../src/routes/api/internal/ops/credentials.ts", import.meta.url),
  "utf8",
);
const auditRoute = readFileSync(
  new URL("../src/routes/api/internal/ops/audit.ts", import.meta.url),
  "utf8",
);

test("content and credential review decisions are explicit", () => {
  assert.equal(isContentReviewDecision("approve"), true);
  assert.equal(isContentReviewDecision("suspend"), true);
  assert.equal(isContentReviewDecision("delete"), false);
  assert.equal(isCredentialReviewDecision("approve"), true);
  assert.equal(isCredentialReviewDecision("reject"), true);
  assert.equal(isCredentialReviewDecision("suspend"), false);
});

test("decisions that hide or reject records require an operator note", () => {
  assert.equal(contentReviewRequiresNote("approve"), false);
  assert.equal(contentReviewRequiresNote("request_changes"), true);
  assert.equal(contentReviewRequiresNote("reject"), true);
  assert.equal(contentReviewRequiresNote("suspend"), true);
  assert.equal(credentialReviewRequiresNote("approve"), false);
  assert.equal(credentialReviewRequiresNote("reject"), true);
});

test("the shared request parser rejects invalid JSON and invalid identifiers", async () => {
  const invalidJson = await parseReviewRequest(
    new Request("https://accountabul.test/review", { method: "PATCH", body: "{" }),
    {
      entity: "property",
      isDecision: isContentReviewDecision,
      requiresNote: contentReviewRequiresNote,
    },
  );
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.equal(invalidJson.response.status, 400);

  const invalidId = await parseReviewRequest(
    jsonRequest({ id: "not-a-uuid", decision: "approve" }),
    {
      entity: "property",
      isDecision: isContentReviewDecision,
      requiresNote: contentReviewRequiresNote,
    },
  );
  assert.equal(invalidId.ok, false);
  if (!invalidId.ok) assert.equal(invalidId.response.status, 400);
});

test("the shared request parser enforces notes and returns normalized input", async () => {
  const missingNote = await parseReviewRequest(jsonRequest({ id: VALID_ID, decision: "reject" }), {
    entity: "property",
    isDecision: isContentReviewDecision,
    requiresNote: contentReviewRequiresNote,
  });
  assert.equal(missingNote.ok, false);
  if (!missingNote.ok) assert.equal(missingNote.response.status, 400);

  const parsed = await parseReviewRequest(
    jsonRequest({ id: ` ${VALID_ID} `, decision: " request_changes ", note: " Add photos. " }),
    {
      entity: "property",
      isDecision: isContentReviewDecision,
      requiresNote: contentReviewRequiresNote,
    },
  );
  assert.deepEqual(parsed, {
    ok: true,
    id: VALID_ID,
    decision: "request_changes",
    note: "Add photos.",
  });
});

test("database conflicts and authorization failures map to stable HTTP responses", () => {
  assert.equal(reviewRpcErrorResponse({ code: "22023", message: "Conflict" })?.status, 409);
  assert.equal(reviewRpcErrorResponse({ code: "42501", message: "Denied" })?.status, 403);
  assert.equal(reviewRpcErrorResponse({ code: "XX000", message: "Unexpected" }), null);
  assert.equal(reviewRpcErrorResponse(null), null);
});

test("every operations review mutation is atomic, audited, and least-privilege", () => {
  for (const functionName of ["review_property", "review_service", "review_business_credential"]) {
    const start = migration.indexOf(`function public.${functionName}(`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    const sql = migration.slice(start, start + 8_000);
    assert.match(sql, /security definer/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /for update;/);
    assert.match(sql, /insert into public\.audit_log/);
    assert.match(sql, /using errcode = '42501'/);
    assert.match(sql, /using errcode = '22023'/);
  }

  assert.match(
    migration,
    /revoke execute on function public\.review_property[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke execute on function public\.review_service[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke execute on function public\.review_business_credential[\s\S]*from public, anon, authenticated/,
  );
  assert.equal((migration.match(/to service_role;/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /to authenticated, service_role/);
});

test("property and service approval require one canonically approved parent business", () => {
  for (const functionName of ["review_property", "review_service"]) {
    const start = migration.indexOf(`function public.${functionName}(`);
    const sql = migration.slice(start, start + 8_000);
    assert.match(sql, /profile_status = 'published'/);
    assert.match(sql, /verification_status = 'verified'/);
    assert.match(sql, /public_profile_enabled/);
    assert.match(sql, /Only a pending .* can receive this review decision/);
  }
});

test("operations routes authenticate, return bounded lists, and call transactional RPCs", () => {
  const routes = [
    [propertyRoute, "review_property", "properties"],
    [serviceRoute, "review_service", "services"],
    [credentialRoute, "review_business_credential", "business_credentials"],
  ] as const;

  for (const [route, rpc, table] of routes) {
    assert.match(route, /authorizeOperationsRequest/);
    assert.match(route, /\.limit\(500\)/);
    assert.match(route, new RegExp(`\\.from\\("${table}"\\)`));
    assert.match(route, new RegExp(`\\.rpc\\("${rpc}"`));
    assert.doesNotMatch(route, /\.update\(/);
    assert.match(route, /reviewRpcErrorResponse/);
  }
});

test("the audit contract adds bounded migration history without replacing audit items", () => {
  assert.match(auditRoute, /Promise\.all/);
  assert.match(auditRoute, /\.from\("audit_log"\)/);
  assert.match(auditRoute, /\.from\("migration_batches"\)/);
  assert.match(auditRoute, /items: auditResult\.data \?\? \[\]/);
  assert.match(auditRoute, /migrationBatches: migrationResult\.data \?\? \[\]/);
  assert.match(auditRoute, /\.limit\(200\)/);
});

function jsonRequest(value: unknown) {
  return new Request("https://accountabul.test/review", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}
