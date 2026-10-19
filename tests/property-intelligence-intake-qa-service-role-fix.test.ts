// Regression coverage for ACC-20260924-003 (docs/security/2026-09-24-red-team-intake-notice-qa-wiring.md).
//
// Three write paths called service-role-only tables through the request's
// own authenticated client, which has no INSERT/UPDATE grant on any of the
// five tables involved -- so savePropertyIntake, the notice acknowledgment,
// and askPropertyAnalysisQuestion all threw on first use. The fix routes
// those writes through the service-role client instead, following the same
// pattern report-vault.server.ts already uses for property_reports
// (ACC-20260924-002) -- never by loosening the migrations' grants, which is
// the exact bypass the grants exist to prevent (see this test file's second
// half).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function sourceOf(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const INTAKE = sourceOf("../src/lib/property-intelligence/property-intake-notice.functions.ts");
const QA = sourceOf("../src/lib/property-intelligence/property-analysis-qa.functions.ts");
const INTAKE_MIGRATION = sourceOf(
  "../supabase/migrations/20260924200000_property_intelligence_intake_and_notice.sql",
);
const TRAIL_MIGRATION = sourceOf(
  "../supabase/migrations/20260924210000_property_intelligence_question_trail.sql",
);

test("savePropertyIntake writes property_intake_claims through the service-role client", () => {
  const start = INTAKE.indexOf("export const savePropertyIntake =");
  const next = INTAKE.indexOf("export const ", start + 1);
  const body = INTAKE.slice(start, next === -1 ? undefined : next);
  assert.match(
    body,
    /const \{ supabaseAdmin \} = await import\("@\/integrations\/supabase\/client\.server"\)/,
    "savePropertyIntake must obtain the service-role client",
  );
  assert.match(
    body,
    /savePropertyIntakeClaims\(\s*supabaseAdmin as never/,
    "savePropertyIntakeClaims must be called with supabaseAdmin, not context.supabase",
  );
});

test("acknowledgePropertyIntelligenceNotice writes property_intelligence_notice_preferences through the service-role client", () => {
  const start = INTAKE.indexOf("export const acknowledgePropertyIntelligenceNotice =");
  const next = INTAKE.indexOf("export const ", start + 1);
  const body = INTAKE.slice(start, next === -1 ? undefined : next);
  assert.match(
    body,
    /const \{ supabaseAdmin \} = await import\("@\/integrations\/supabase\/client\.server"\)/,
    "acknowledgePropertyIntelligenceNotice must obtain the service-role client",
  );
  assert.match(
    body,
    /acknowledge\(supabaseAdmin as never/,
    "the server module must be called with supabaseAdmin, not context.supabase",
  );
});

test("askPropertyAnalysisQuestion writes the Q&A trail through the service-role client", () => {
  const start = QA.indexOf("export const askPropertyAnalysisQuestion =");
  const next = QA.indexOf("export const ", start + 1);
  const body = QA.slice(start, next === -1 ? undefined : next);
  assert.match(
    body,
    /withPropertyDossierClient\(\(database: DossierDatabase\) =>\s*askAnalysisThread\(database,/,
    "askAnalysisThread must be called with the service-role database from withPropertyDossierClient",
  );
  assert.ok(
    !/askAnalysisThread\(context\.supabase/.test(body),
    "askAnalysisThread must not be called with the caller's own RLS-scoped client",
  );
});

test("authenticated still has no INSERT/UPDATE grant on property_intake_claims or property_intelligence_notice_preferences", () => {
  // The fix must route around the grant, never loosen it -- that is exactly
  // the bypass this migration's own header warns against (unbounded intake
  // values skipping normalizePropertyIntakeClaims, and a client setting
  // acknowledgment_count directly to defeat the three-review dismissal gate).
  assert.match(
    INTAKE_MIGRATION,
    /grant select on public\.property_intake_claims to authenticated;/,
  );
  assert.match(INTAKE_MIGRATION, /grant all on public\.property_intake_claims to service_role;/);
  assert.ok(
    !/grant\s+(?:insert|update|all)\s+on public\.property_intake_claims to authenticated/.test(
      INTAKE_MIGRATION,
    ),
    "authenticated must not gain insert/update/all on property_intake_claims",
  );

  assert.match(
    INTAKE_MIGRATION,
    /grant select on public\.property_intelligence_notice_preferences to authenticated;/,
  );
  assert.match(
    INTAKE_MIGRATION,
    /grant all on public\.property_intelligence_notice_preferences to service_role;/,
  );
  assert.ok(
    !/grant\s+(?:insert|update|all)\s+on public\.property_intelligence_notice_preferences to authenticated/.test(
      INTAKE_MIGRATION,
    ),
    "authenticated must not gain insert/update/all on property_intelligence_notice_preferences",
  );
});

test("authenticated still has no INSERT grant on the Q&A trail tables", () => {
  for (const table of [
    "property_analysis_messages",
    "property_analysis_question_runs",
    "property_analysis_question_events",
  ]) {
    const selectGrant = new RegExp(`grant select on public\\.${table} to authenticated;`);
    const serviceRoleGrant = new RegExp(
      `grant select, insert on public\\.${table} to service_role;`,
    );
    assert.match(TRAIL_MIGRATION, selectGrant, `${table}: authenticated select grant`);
    assert.match(TRAIL_MIGRATION, serviceRoleGrant, `${table}: service_role insert grant`);
    assert.ok(
      !new RegExp(`grant\\s+(?:insert|update|all)\\s+on public\\.${table} to authenticated`).test(
        TRAIL_MIGRATION,
      ),
      `${table}: authenticated must not gain insert/update/all`,
    );
  }
});

test("workspace/thread ownership is still checked before each of these three writes", () => {
  // The fix changes only which client performs the write -- every existing
  // authorization check stays in place.
  const saveStart = INTAKE.indexOf("export const savePropertyIntake =");
  const saveNext = INTAKE.indexOf("export const ", saveStart + 1);
  assert.match(
    INTAKE.slice(saveStart, saveNext),
    /assertOwnsThread\(/,
    "savePropertyIntake must still confirm thread ownership",
  );

  const askStart = QA.indexOf("export const askPropertyAnalysisQuestion =");
  const askNext = QA.indexOf("export const ", askStart + 1);
  assert.match(
    QA.slice(askStart, askNext),
    /ownedWorkspace\(/,
    "askPropertyAnalysisQuestion must still confirm workspace ownership",
  );

  assert.match(
    INTAKE,
    /throwIfRateLimited\(\s*`property-intake-save:\$\{context\.userId\}`/,
    "savePropertyIntake must still be rate limited",
  );
  assert.match(
    INTAKE,
    /throwIfRateLimited\(\s*`property-notice-ack:\$\{context\.userId\}`/,
    "acknowledgePropertyIntelligenceNotice must still be rate limited",
  );
  assert.match(
    QA,
    /throwIfRateLimited\(\s*`property-analysis-ask:\$\{context\.userId\}`/,
    "askPropertyAnalysisQuestion must still be rate limited",
  );
});
