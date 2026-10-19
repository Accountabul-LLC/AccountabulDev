import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260924120000_property_api_access_requests.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Phase 5: a user cannot self-approve — insert must land as pending, and there is no owner UPDATE policy", () => {
  assert.match(
    migration,
    /create policy property_api_access_requests_owner_insert[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\) and status = 'pending'\)/,
  );

  const updatePolicies = migration.match(
    /create policy \w+\s+on public\.property_api_access_requests for update/g,
  );
  assert.equal(updatePolicies?.length, 1, "exactly one UPDATE policy should exist");
  assert.match(
    migration,
    /create policy property_api_access_requests_admin_update\s+on public\.property_api_access_requests for update to authenticated\s+using \(public\.has_role\(auth\.uid\(\), 'admin'\)\)\s+with check \(public\.has_role\(auth\.uid\(\), 'admin'\)\)/,
  );
});

test("Phase 5: a non-owner cannot read another user's request row", () => {
  assert.match(
    migration,
    /create policy property_api_access_requests_read\s+on public\.property_api_access_requests for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) or public\.has_role\(auth\.uid\(\), 'admin'\)\)/,
  );
});

test("Phase 5: one request per account is enforced at the database level", () => {
  assert.match(migration, /user_id uuid not null unique default auth\.uid\(\)/);
});

test("Phase 5: status defaults to pending, not approved", () => {
  assert.match(
    migration,
    /status text not null default 'pending' check \(status in \('pending', 'approved', 'denied'\)\)/,
  );
});

test("Phase 5: submitting a request never grants credentials — status is not client-settable outside 'pending'", () => {
  const submitFn = readFileSync(
    new URL("../src/lib/property-intelligence/api-access-requests.functions.ts", import.meta.url),
    "utf8",
  );
  // submitApiAccessRequest's insert must never set status itself (the DB default/insert
  // policy owns that); only reviewApiAccessRequest, gated by has_role(admin), may set it.
  const submitBlock = submitFn.slice(
    submitFn.indexOf("submitApiAccessRequest"),
    submitFn.indexOf("getOwnApiAccessRequest"),
  );
  assert.doesNotMatch(submitBlock, /status:/);
  assert.match(submitFn, /has_role["'`]?,?\s*{\s*_user_id: context\.userId,\s*_role: "admin"/);
});
