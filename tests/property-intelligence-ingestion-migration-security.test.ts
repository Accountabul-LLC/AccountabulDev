// Slice 2 of the nationwide multi-state ingestion port. Migration-shape /
// RLS assertions in this repo's existing style (string/regex checks against
// the migration SQL text, no PGlite / real Postgres -- see
// tests/property-intelligence-geography-migration-security.test.ts for the
// Slice 1 template this mirrors).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260924150000_property_intelligence_ingestion_pipeline.sql",
    import.meta.url,
  ),
  "utf8",
);

const INGEST_TABLES = [
  "source_definitions",
  "source_candidates",
  "source_candidate_assessments",
  "source_candidate_assessment_fields",
  "source_research_catalog_imports",
  "source_research_catalog_entries",
  "source_candidate_promotions",
  "source_documents",
  "ingestion_runs",
  "ingestion_dispatches",
  "ingestion_health_incidents",
  "ingestion_health_monitor_state",
  "ingestion_health_outbox",
  "ingestion_batches",
  "ingestion_batch_members",
  "ingestion_batch_profiles",
  "ingestion_batch_field_profiles",
  "snapshot_members",
  "ingestion_rejections",
];

test("Slice 2: every property_ingest pipeline table is created", () => {
  for (const table of INGEST_TABLES) {
    assert.match(
      migration,
      new RegExp(`create table property_ingest\\.${table} \\(`),
      `expected property_ingest.${table} to be created`,
    );
  }
});

test("Slice 2: every property_ingest pipeline table enables and forces row level security", () => {
  for (const table of INGEST_TABLES) {
    assert.match(
      migration,
      new RegExp(`alter table property_ingest\\.${table} enable row level security`),
      `expected RLS enabled on ${table}`,
    );
    assert.match(
      migration,
      new RegExp(`alter table property_ingest\\.${table} force row level security`),
      `expected RLS forced on ${table}`,
    );
  }
});

test("Slice 2: no authenticated write policy exists on any pipeline table -- writes are service-role only", () => {
  for (const table of INGEST_TABLES) {
    assert.doesNotMatch(
      migration,
      new RegExp(`on property_ingest\\.${table} for (insert|update|delete) to authenticated`),
      `expected no authenticated write policy on ${table}`,
    );
  }
  // No "create policy ... for insert/update/delete" appears anywhere in this
  // migration at all -- every write policy line is absent, not merely
  // ungranted.
  assert.doesNotMatch(
    migration,
    /create policy \w+\s+on property_ingest\.\w+ for (insert|update|delete)/,
  );
});

test("Slice 2: SELECT is admin-gated (not blanket-authenticated, unlike Slice 1's geography catalog)", () => {
  for (const table of INGEST_TABLES) {
    assert.match(
      migration,
      new RegExp(
        `create policy ${table}_admin_read\\s*\\n\\s*on property_ingest\\.${table} for select to authenticated\\s*\\n\\s*using \\(public\\.has_role\\(auth\\.uid\\(\\), 'admin'\\)\\)`,
      ),
      `expected an admin-gated read policy on ${table}`,
    );
  }
  assert.doesNotMatch(migration, /using \(true\)/);
});

test("Slice 2: service_role retains full access to every pipeline table", () => {
  for (const table of INGEST_TABLES) {
    assert.match(migration, new RegExp(`grant all on property_ingest\\.${table} to service_role`));
  }
});

test("Slice 2: ledger integrity triggers exist for field inventory, research catalog membership, and promotion", () => {
  assert.match(
    migration,
    /create constraint trigger enforce_source_candidate_assessment_field_inventory/,
  );
  assert.match(
    migration,
    /create constraint trigger enforce_source_candidate_assessment_field_rows/,
  );
  assert.match(
    migration,
    /create constraint trigger enforce_source_research_catalog_import_membership/,
  );
  assert.match(
    migration,
    /create constraint trigger enforce_source_research_catalog_entry_membership/,
  );
  assert.match(migration, /create trigger enforce_source_candidate_promotion/);
});

test("Slice 2: enqueue_due_ingestion_dispatches is defined but restricted to service_role and granted to no one else", () => {
  assert.match(
    migration,
    /create or replace function property_ingest\.enqueue_due_ingestion_dispatches/,
  );
  assert.match(
    migration,
    /revoke all on function property_ingest\.enqueue_due_ingestion_dispatches\(timestamptz\)\s*\n\s*from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function property_ingest\.enqueue_due_ingestion_dispatches\(timestamptz\)\s*\n\s*to service_role;/,
  );
  // Never scheduled from this migration: no pg_cron.schedule call anywhere.
  assert.doesNotMatch(migration, /cron\.schedule/);
});

test("Slice 2: only one active incident per (source, alert_code) can exist at a time", () => {
  assert.match(
    migration,
    /create unique index ingestion_health_incidents_one_active_idx\s*\n\s*on property_ingest\.ingestion_health_incidents \(source_definition_id, alert_code\)\s*\n\s*where resolved_at is null;/,
  );
});

test("Slice 2: the content-addressed artifact bucket is private with no public flag and no authenticated storage policy", () => {
  assert.match(
    migration,
    /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)/,
  );
  assert.match(
    migration,
    /'nationwide-source-artifacts',\s*\n\s*'nationwide-source-artifacts',\s*\n\s*false,/,
  );
  assert.doesNotMatch(migration, /storage\.objects.*nationwide-source-artifacts/s);
});

test("Slice 2: not applied to the live project -- this file only exists as a migration, never actually schedules or calls out", () => {
  assert.doesNotMatch(migration, /cron\.schedule|net\.http_post/);
});
