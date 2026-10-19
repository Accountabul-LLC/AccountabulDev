import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUSINESS_REVIEW_DECISIONS,
  businessReviewRequiresNote,
  isBusinessApproved,
  isBusinessDecisionCurrent,
  isBusinessReviewDecision,
  needsBusinessReview,
  planBusinessReviewDecision,
} from "../src/lib/business-review.ts";
import { canManageBusinessWorkspace } from "../src/lib/business-capabilities.ts";

const NOW = "2026-09-01T09:15:00.000Z";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901090118_business_experience_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const operationsRoute = readFileSync(
  new URL("../src/routes/api/internal/ops/businesses.ts", import.meta.url),
  "utf8",
);
const businessDirectoryRoute = readFileSync(
  new URL("../src/routes/businesses.index.tsx", import.meta.url),
  "utf8",
);
const marketplaceRoute = readFileSync(
  new URL("../src/routes/marketplace.tsx", import.meta.url),
  "utf8",
);
const propertyDetailRoute = readFileSync(
  new URL("../src/routes/properties.$slug.tsx", import.meta.url),
  "utf8",
);
const propertyRoleGuard = readFileSync(
  new URL(
    "../supabase/migrations/20260901114700_property_management_role_guard.sql",
    import.meta.url,
  ),
  "utf8",
);
const childMediaGuard = readFileSync(
  new URL(
    "../supabase/migrations/20260901115500_child_media_visibility_guard.sql",
    import.meta.url,
  ),
  "utf8",
);
const transitionGuard = readFileSync(
  new URL(
    "../supabase/migrations/20260901170719_business_review_transition_guards.sql",
    import.meta.url,
  ),
  "utf8",
);
const approvalAuditBackfill = readFileSync(
  new URL(
    "../supabase/migrations/20260901194300_backfill_business_approval_reconciliation_audit.sql",
    import.meta.url,
  ),
  "utf8",
);
const oneBusinessGuard = readFileSync(
  new URL("../supabase/migrations/20260901172858_one_authoritative_business.sql", import.meta.url),
  "utf8",
);
const businessOnboardingRoute = readFileSync(
  new URL("../src/routes/onboarding.business.tsx", import.meta.url),
  "utf8",
);

test("approval publishes, verifies, and enables a business atomically", () => {
  assert.deepEqual(planBusinessReviewDecision("approve", NOW), {
    profile_status: "published",
    verification_status: "verified",
    public_profile_enabled: true,
    published_at: NOW,
  });
});

test("non-approval decisions always hide the public profile", () => {
  for (const decision of BUSINESS_REVIEW_DECISIONS.filter((value) => value !== "approve")) {
    const patch = planBusinessReviewDecision(decision, NOW);
    assert.equal(patch.public_profile_enabled, false);
    assert.equal(patch.published_at, null);
    assert.notEqual(patch.profile_status, "published");
  }
});

test("review decisions reject unknown actions", () => {
  assert.equal(isBusinessReviewDecision("approve"), true);
  assert.equal(isBusinessReviewDecision("publish_without_review"), false);
  assert.equal(isBusinessReviewDecision(""), false);
});

test("every decision that hides a business requires an operator note", () => {
  assert.equal(businessReviewRequiresNote("approve"), false);
  assert.equal(businessReviewRequiresNote("request_changes"), true);
  assert.equal(businessReviewRequiresNote("reject"), true);
  assert.equal(businessReviewRequiresNote("suspend"), true);
});

test("approval requires publication, verification, and public visibility together", () => {
  assert.equal(
    isBusinessApproved({
      profile_status: "published",
      verification_status: "verified",
      public_profile_enabled: true,
    }),
    true,
  );
  assert.equal(
    isBusinessApproved({
      profile_status: "published",
      verification_status: "in_review",
      public_profile_enabled: false,
    }),
    false,
  );
});

test("partially approved records stay in the review queue and can be repaired", () => {
  const partial = {
    profile_status: "published",
    verification_status: "in_review",
    public_profile_enabled: false,
  };
  assert.equal(needsBusinessReview(partial), true);
  assert.equal(isBusinessDecisionCurrent(partial, "approve"), false);
});

test("an approved business leaves the review queue and disables duplicate approval", () => {
  const approved = {
    profile_status: "published",
    verification_status: "verified",
    public_profile_enabled: true,
  };
  assert.equal(needsBusinessReview(approved), false);
  assert.equal(isBusinessDecisionCurrent(approved, "approve"), true);
});

test("only owners and managers receive business workspace mutation controls", () => {
  assert.equal(canManageBusinessWorkspace("owner"), true);
  assert.equal(canManageBusinessWorkspace("manager"), true);
  assert.equal(canManageBusinessWorkspace("listing_manager"), false);
  assert.equal(canManageBusinessWorkspace("lead_manager"), false);
  assert.equal(canManageBusinessWorkspace("viewer"), false);
  assert.equal(canManageBusinessWorkspace(null), false);
});

test("business onboarding resumes one authoritative owner-created record", () => {
  assert.match(
    oneBusinessGuard,
    /create unique index if not exists businesses_one_created_record_per_user/,
  );
  assert.match(oneBusinessGuard, /on public\.businesses \(created_by\)/);
  assert.match(oneBusinessGuard, /where created_by is not null/);
  assert.match(oneBusinessGuard, /\(m\.membership_role = 'owner'::public\.membership_role\) desc/);
  assert.match(businessOnboardingRoute, /business\?\.id \?\? createdBusinessId/);
  assert.match(businessOnboardingRoute, /\.eq\("created_by", userId!\)/);
  assert.match(businessOnboardingRoute, /setCreatedBusinessId\(existing\.id\)/);
});

test("the operations API delegates review decisions to one transactional database function", () => {
  assert.match(operationsRoute, /\.rpc\("review_business"/);
  assert.doesNotMatch(operationsRoute, /\.from\("businesses"\)\s*\.update/);
  assert.match(migration, /create or replace function public\.review_business/);
  assert.match(migration, /for update;/);
  assert.match(migration, /insert into public\.audit_log/);
});

test("review transition conflicts are enforced by the database and returned explicitly", () => {
  assert.match(transitionGuard, /Only an approved business can be suspended/);
  assert.match(transitionGuard, /The business is already approved/);
  assert.match(transitionGuard, /Changes have already been requested/);
  assert.match(transitionGuard, /The business is already rejected/);
  assert.match(transitionGuard, /length\(coalesce\(p_note, ''\)\) > 2000/);
  assert.match(operationsRoute, /error\?\.code === "22023"/);
  assert.match(operationsRoute, /status: 409/);
  assert.match(operationsRoute, /valid JSON review request/);
  assert.match(operationsRoute, /Array\.isArray\(parsed\)/);
  assert.match(operationsRoute, /note\.length > 2_000/);
  assert.match(operationsRoute, /may not exceed 2,000 characters/);
});

test("legacy approval repairs receive one honest, idempotent reconciliation audit", () => {
  assert.match(approvalAuditBackfill, /'ops\.business\.approval_reconciled'/);
  assert.match(approvalAuditBackfill, /'legacy_partial_approval_repair'/);
  assert.match(approvalAuditBackfill, /select\s+null,/);
  assert.match(approvalAuditBackfill, /where b\.profile_status = 'published'/);
  assert.match(approvalAuditBackfill, /b\.verification_status = 'verified'/);
  assert.match(approvalAuditBackfill, /b\.public_profile_enabled/);
  assert.match(approvalAuditBackfill, /and not exists \(/);
  assert.match(approvalAuditBackfill, /'ops\.business\.approve'/);
  assert.doesNotMatch(approvalAuditBackfill, /update public\.businesses/i);
});

test("the migration repairs legacy partial approvals and applies one public approval rule", () => {
  assert.match(migration, /where profile_status = 'published'/);
  assert.match(migration, /verification_status = 'verified'/);
  assert.match(migration, /public_profile_enabled = true/);

  for (const policy of [
    "businesses_public_read",
    "properties_public_read",
    "property_media_public_read",
    "services_public_read",
  ]) {
    const policyStart = migration.indexOf(`create policy ${policy}`);
    assert.notEqual(policyStart, -1, `${policy} must be replaced by this migration`);
    const policySql = migration.slice(policyStart, policyStart + 700);
    assert.match(policySql, /profile_status = 'published'/);
    assert.match(policySql, /verification_status = 'verified'/);
    assert.match(policySql, /public_profile_enabled/);
  }
});

test("the public business directory applies the complete approval tuple", () => {
  assert.match(businessDirectoryRoute, /\.eq\("profile_status", "published"\)/);
  assert.match(businessDirectoryRoute, /\.eq\("verification_status", "verified"\)/);
  assert.match(businessDirectoryRoute, /\.eq\("public_profile_enabled", true\)/);
});

test("public property routes require an approved parent and resolve stored media paths", () => {
  for (const route of [marketplaceRoute, propertyDetailRoute]) {
    assert.match(route, /businesses!inner/);
    assert.match(route, /\.eq\("businesses\.profile_status", "published"\)/);
    assert.match(route, /\.eq\("businesses\.verification_status", "verified"\)/);
    assert.match(route, /\.eq\("businesses\.public_profile_enabled", true\)/);
    assert.match(route, /PROPERTY_MEDIA_BUCKET/);
    assert.match(route, /useMediaUrl/);
  }
});

test("property draft mutations require an owner or manager at the database boundary", () => {
  for (const policy of ["properties_insert", "properties_update", "properties_delete"]) {
    const policyStart = propertyRoleGuard.indexOf(`create policy ${policy}`);
    assert.notEqual(policyStart, -1, `${policy} must be replaced by the role-guard migration`);
    const policySql = propertyRoleGuard.slice(policyStart, policyStart + 500);
    assert.match(policySql, /can_manage_business\(business_id, \(select auth\.uid\(\)\)\)/);
    assert.doesNotMatch(policySql, /is_business_member/);
  }
});

test("public child media requires the exact service or property to be published", () => {
  const businessMediaStart = childMediaGuard.indexOf("create policy business_media_public_read");
  assert.notEqual(businessMediaStart, -1);
  const businessMediaPolicy = childMediaGuard.slice(businessMediaStart, businessMediaStart + 1300);
  assert.match(businessMediaPolicy, /s\.status = 'published'/);
  assert.match(businessMediaPolicy, /s\.image_path = storage\.objects\.name/);
  assert.match(businessMediaPolicy, /b\.profile_status = 'published'/);
  assert.match(businessMediaPolicy, /b\.verification_status = 'verified'/);
  assert.match(businessMediaPolicy, /b\.public_profile_enabled/);

  const propertyMediaStart = childMediaGuard.indexOf("create policy property_storage_public_read");
  assert.notEqual(propertyMediaStart, -1);
  const propertyMediaPolicy = childMediaGuard.slice(propertyMediaStart, propertyMediaStart + 1300);
  assert.match(propertyMediaPolicy, /p\.status = 'published'/);
  assert.match(propertyMediaPolicy, /p\.cover_path = storage\.objects\.name/);
  assert.match(propertyMediaPolicy, /pm\.storage_path = storage\.objects\.name/);
  assert.match(propertyMediaPolicy, /b\.profile_status = 'published'/);
  assert.match(propertyMediaPolicy, /b\.verification_status = 'verified'/);
  assert.match(propertyMediaPolicy, /b\.public_profile_enabled/);
});
