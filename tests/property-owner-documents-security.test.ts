import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filterTimelineEligible } from "../src/lib/property-intelligence/property-records-upload-validation.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260924110000_property_owner_documents.sql", import.meta.url),
  "utf8",
);

test("Phase 3: an owner cannot self-verify their own document — no owner UPDATE policy exists", () => {
  // The only UPDATE policy on property_owner_documents must be gated on
  // has_role(admin/moderator), and no owner-scoped UPDATE policy may exist at all.
  assert.match(
    migration,
    /create policy property_owner_documents_review_update\s+on public\.property_owner_documents for update to authenticated\s+using \(public\.has_role\(auth\.uid\(\), 'admin'\) or public\.has_role\(auth\.uid\(\), 'moderator'\)\)/,
  );
  const updatePolicies = migration.match(
    /create policy \w+\s+on public\.property_owner_documents for update/g,
  );
  assert.equal(updatePolicies?.length, 1, "exactly one UPDATE policy should exist");
});

test("Phase 3: an owner's insert can never arrive pre-verified or pre-reviewed", () => {
  assert.match(
    migration,
    /create policy property_owner_documents_owner_insert[\s\S]*?with check \(\s*user_id = \(select auth\.uid\(\)\)\s*and status = 'submitted'\s*and review_note is null\s*and reviewed_by is null\s*and reviewed_at is null\s*\)/,
  );
});

test("Phase 3: property_record_reviews is append-only — insert-only for admin/moderator, no update/delete policy", () => {
  assert.match(
    migration,
    /create policy property_record_reviews_reviewer_insert\s+on public\.property_record_reviews for insert to authenticated/,
  );
  assert.doesNotMatch(migration, /property_record_reviews.*for update/is);
  assert.doesNotMatch(migration, /property_record_reviews.*for delete/is);
});

test("Phase 3: a non-owner cannot read another user's document row — select policy is owner-or-reviewer only", () => {
  assert.match(
    migration,
    /create policy property_owner_documents_read\s+on public\.property_owner_documents for select to authenticated\s+using \(\s*user_id = \(select auth\.uid\(\)\)\s*or public\.has_role\(auth\.uid\(\), 'admin'\)\s*or public\.has_role\(auth\.uid\(\), 'moderator'\)\s*\)/,
  );
});

test("Phase 3: storage reads for property-owner-records are limited to the owner's own folder or a reviewer role", () => {
  assert.match(
    migration,
    /create policy property_owner_records_read\s+on storage\.objects for select to authenticated\s+using \(\s*bucket_id = 'property-owner-records'\s+and \(\s*split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text\s+or public\.has_role\(auth\.uid\(\), 'admin'\)\s+or public\.has_role\(auth\.uid\(\), 'moderator'\)\s*\)\s*\)/,
  );
  // No public/anon grant exists on the bucket's storage.objects rows -- private, signed URLs only.
  assert.doesNotMatch(migration, /storage\.objects.*to anon/is);
});

test("Phase 3: the storage bucket is private with no public flag", () => {
  assert.match(migration, /'property-owner-records',\s*'property-owner-records',\s*false,/);
});

test("Phase 3: only a verified document is eligible for timeline display", () => {
  const docs = [
    { id: "a", status: "submitted" as const },
    { id: "b", status: "verified" as const },
    { id: "c", status: "rejected" as const },
  ];
  const eligible = filterTimelineEligible(docs);
  assert.deepEqual(
    eligible.map((d) => d.id),
    ["b"],
  );
});

test("Phase 3: the timeline filter treats every non-verified status as ineligible", () => {
  for (const status of ["submitted", "rejected"] as const) {
    assert.deepEqual(filterTimelineEligible([{ id: "x", status }]), []);
  }
  assert.deepEqual(filterTimelineEligible([{ id: "x", status: "verified" as const }]).length, 1);
});
