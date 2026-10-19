// Slice 1 of the nationwide geography catalog port
// (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Migration-shape / RLS
// assertions in this repo's existing style (string/regex checks against the
// migration SQL text, no PGlite / real Postgres -- see
// tests/property-report-vault-security.test.ts and
// tests/property-owner-documents-security.test.ts for the template).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260924140000_property_intelligence_geography_catalog.sql",
    import.meta.url,
  ),
  "utf8",
);

test("Slice 1: both property_core and property_ingest schemas are created and locked down at the schema level", () => {
  assert.match(migration, /create schema if not exists property_core;/);
  assert.match(migration, /create schema if not exists property_ingest;/);
  assert.match(migration, /revoke all on schema property_core from public, anon, authenticated;/);
  assert.match(migration, /revoke all on schema property_ingest from public, anon, authenticated;/);
  assert.match(
    migration,
    /grant usage on schema property_core, property_ingest to authenticated, service_role;/,
  );
});

test("Slice 1: property_core.jurisdictions enforces RLS and is force-RLS (no bypass for the table owner)", () => {
  assert.match(migration, /alter table property_core\.jurisdictions enable row level security;/);
  assert.match(migration, /alter table property_core\.jurisdictions force row level security;/);
});

test("Slice 1: any authenticated user can read jurisdictions, but only an admin can write", () => {
  assert.match(
    migration,
    /create policy jurisdictions_read\s+on property_core\.jurisdictions for select to authenticated\s+using \(true\);/,
  );
  assert.match(
    migration,
    /create policy jurisdictions_admin_write\s+on property_core\.jurisdictions for insert to authenticated\s+with check \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/,
  );
  assert.match(
    migration,
    /create policy jurisdictions_admin_update\s+on property_core\.jurisdictions for update to authenticated\s+using \(public\.has_role\(auth\.uid\(\), 'admin'\)\)\s+with check \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/,
  );
  assert.match(
    migration,
    /create policy jurisdictions_admin_delete\s+on property_core\.jurisdictions for delete to authenticated\s+using \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/,
  );
  // No ordinary-user write policy exists -- every write policy on this
  // table must be admin-gated.
  const writePolicies = migration.match(
    /create policy \w+\s+on property_core\.jurisdictions for (insert|update|delete)/g,
  );
  assert.equal(
    writePolicies?.length,
    3,
    "exactly three write policies (insert/update/delete) should exist",
  );
  for (const block of migration.matchAll(
    /create policy \w+\s+on property_core\.jurisdictions for (?:insert|update|delete)[\s\S]*?;/g,
  )) {
    assert.match(block[0], /public\.has_role\(auth\.uid\(\), 'admin'\)/);
  }
});

test("Slice 1: geography_catalog_imports and geography_catalog_entries are read-only to authenticated, with no write grant or policy at all", () => {
  assert.match(
    migration,
    /grant select on property_ingest\.geography_catalog_imports,\s*\n\s*property_ingest\.geography_catalog_entries to authenticated;/,
  );
  assert.doesNotMatch(
    migration,
    /grant insert on property_ingest\.geography_catalog_imports.*to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant.*update.*property_ingest\.geography_catalog_(imports|entries).*to authenticated/,
  );
  assert.match(
    migration,
    /create policy geography_catalog_imports_read\s+on property_ingest\.geography_catalog_imports for select to authenticated\s+using \(true\);/,
  );
  assert.match(
    migration,
    /create policy geography_catalog_entries_read\s+on property_ingest\.geography_catalog_entries for select to authenticated\s+using \(true\);/,
  );
  // No insert/update/delete policy exists on either ledger table.
  assert.doesNotMatch(
    migration,
    /property_ingest\.geography_catalog_imports for (insert|update|delete)/,
  );
  assert.doesNotMatch(
    migration,
    /property_ingest\.geography_catalog_entries for (insert|update|delete)/,
  );
});

test("Slice 1: service_role retains full access to every geography table", () => {
  assert.match(migration, /grant all on property_core\.jurisdictions to service_role;/);
  assert.match(
    migration,
    /grant all on property_ingest\.geography_catalog_imports,\s*\n\s*property_ingest\.geography_catalog_entries to service_role;/,
  );
});

test("Slice 1: geography_catalog_entries membership is guarded by a deferred constraint trigger tied to validate_geography_catalog_import", () => {
  assert.match(
    migration,
    /create constraint trigger enforce_geography_catalog_import_membership\s*\nafter insert on property_ingest\.geography_catalog_imports\s*\ndeferrable initially deferred/,
  );
  assert.match(
    migration,
    /create trigger enforce_geography_catalog_entry_membership\s*\nafter insert on property_ingest\.geography_catalog_entries\s*\nreferencing new table as new_entries\s*\nfor each statement/,
  );
});

test("Slice 1: jurisdiction identity uniqueness is enforced by federal code, not just by name", () => {
  assert.match(migration, /create unique index jurisdictions_state_code_uidx/);
  assert.match(migration, /create unique index jurisdictions_state_fips_uidx/);
  assert.match(migration, /create unique index jurisdictions_county_fips_uidx/);
});

test("Slice 1: geography_catalog_entries uniquely ties one jurisdiction, county FIPS, and ANSI code per import", () => {
  assert.match(migration, /unique \(catalog_import_id, jurisdiction_id\)/);
  assert.match(migration, /unique \(catalog_import_id, county_fips\)/);
  assert.match(migration, /unique \(catalog_import_id, ansi_code\)/);
});
