import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260924181500_property_intelligence_red_team_fixes.sql",
    import.meta.url,
  ),
  "utf8",
);
const reportVaultServer = readFileSync(
  new URL("../src/lib/property-intelligence/report-vault.server.ts", import.meta.url),
  "utf8",
);

test("ACC-20260924-001: property_owner_documents insert now requires thread ownership, not just actor identity", () => {
  assert.match(
    fixMigration,
    /drop policy property_owner_documents_owner_insert on public\.property_owner_documents;/,
  );
  assert.match(
    fixMigration,
    /create policy property_owner_documents_owner_insert[\s\S]*?with check \([\s\S]*?exists \(\s*select 1 from public\.property_analysis_threads t\s*where t\.id = thread_id and t\.user_id = \(select auth\.uid\(\)\)\s*\)/,
  );
});

test("ACC-20260924-001: the replacement insert policy still requires status/review-field defaults", () => {
  assert.match(
    fixMigration,
    /create policy property_owner_documents_owner_insert[\s\S]*?with check \(\s*user_id = \(select auth\.uid\(\)\)\s*and status = 'submitted'\s*and review_note is null\s*and reviewed_by is null\s*and reviewed_at is null/,
  );
});

test("ACC-20260924-002: authenticated no longer has an INSERT policy or grant on property_reports", () => {
  assert.match(
    fixMigration,
    /drop policy property_reports_owner_insert on public\.property_reports;/,
  );
  assert.match(fixMigration, /revoke insert on public\.property_reports from authenticated;/);
});

test("ACC-20260924-002: generateReportSnapshot writes property_reports through the service-role client, not the caller's", () => {
  const insertBlock = reportVaultServer.match(
    /const \{ data: inserted, error: insertError \} = await (\w+)\s*\.from\("property_reports"\)/,
  );
  assert.ok(
    insertBlock,
    "could not locate the property_reports insert call in report-vault.server.ts",
  );
  assert.equal(
    insertBlock?.[1],
    "supabaseAdmin",
    "the property_reports insert must use supabaseAdmin now that authenticated has no INSERT grant on the table",
  );
});
