// Wiring for the intake, notice, dossier and analysis-Q&A surfaces.
//
// Each underlying module was ported and tested but had no caller anywhere in
// src/, so none of it could be reached from the application: the Q&A module
// had zero callers, and the dossier module was called only by other
// unreachable modules. These server functions are what connects them.
//
// The modules import @tanstack/react-start, which this session cannot
// resolve, so these are source-level assertions in this repo's existing
// style for route and function wiring (see
// property-intelligence-st-louis-lra-ops-route.test.ts). What they pin is
// the part that regresses silently: losing the auth middleware, accepting a
// caller-supplied answer into an append-only trail, or dropping the
// ownership check that keeps one account out of another's workspace.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function sourceOf(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const INTAKE = sourceOf("../src/lib/property-intelligence/property-intake-notice.functions.ts");
const QA = sourceOf("../src/lib/property-intelligence/property-analysis-qa.functions.ts");

test("the intake and notice server module is now reachable", () => {
  for (const exported of [
    "getPropertyIntake",
    "savePropertyIntake",
    "getPropertyIntelligenceNotice",
    "acknowledgePropertyIntelligenceNotice",
  ]) {
    assert.match(INTAKE, new RegExp(`export const ${exported} = createServerFn`), exported);
  }
  assert.match(INTAKE, /property-intake-notice\.server/);
});

test("the dossier and Q&A server modules are now reachable", () => {
  for (const exported of [
    "getPropertyDossierForWorkspace",
    "askPropertyAnalysisQuestion",
    "getPropertyAnalysisQuestionMetrics",
  ]) {
    assert.match(QA, new RegExp(`export const ${exported} = createServerFn`), exported);
  }
  assert.match(QA, /property-analysis-qa\.server/);
  assert.match(QA, /property-dossier\.server/);
});

test("every exposed function requires authentication", () => {
  for (const [name, source] of [
    ["intake/notice", INTAKE],
    ["dossier/Q&A", QA],
  ] as const) {
    const handlers = source.match(/createServerFn\(/g) ?? [];
    const guards = source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
    assert.equal(
      guards.length,
      handlers.length,
      `${name}: every server function must be behind requireSupabaseAuth`,
    );
  }
});

test("the analysis answer is produced server-side, never accepted from the caller", () => {
  // The validator is the whole surface a client can influence. If it ever
  // accepts a report, dossier, answer or profile, a caller could write
  // arbitrary content into an append-only audit trail.
  const validator = QA.slice(QA.indexOf("askPropertyAnalysisQuestion"));
  const accepted = validator.slice(
    validator.indexOf(".validator("),
    validator.indexOf(".handler("),
  );
  for (const forbidden of ["report", "dossier", "answer", "profile"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(accepted),
      `the ask validator must not accept a caller-supplied ${forbidden}`,
    );
  }
  assert.match(QA, /buildPropertyReport\(dossier, profile\)/);
});

test("workspace ownership is confirmed before intake rows are read or written", () => {
  assert.match(INTAKE, /async function assertOwnsThread/);
  for (const handler of ["getPropertyIntake", "savePropertyIntake"]) {
    const start = INTAKE.indexOf(`export const ${handler} =`);
    const next = INTAKE.indexOf("export const ", start + 1);
    const body = INTAKE.slice(start, next === -1 ? undefined : next);
    assert.match(body, /assertOwnsThread\(/, `${handler} must confirm ownership`);
  }
});

test("workspace ownership is confirmed before the dossier or the trail is touched", () => {
  assert.match(QA, /async function ownedWorkspace/);
  for (const handler of ["getPropertyDossierForWorkspace", "askPropertyAnalysisQuestion"]) {
    const start = QA.indexOf(`export const ${handler} =`);
    const next = QA.indexOf("export const ", start + 1);
    const body = QA.slice(start, next === -1 ? undefined : next);
    assert.match(body, /ownedWorkspace\(/, `${handler} must confirm ownership`);
  }
});

test("writes are rate limited per account", () => {
  assert.match(INTAKE, /throwIfRateLimited\(\s*`property-intake-save:\$\{context\.userId\}`/);
  assert.match(INTAKE, /throwIfRateLimited\(\s*`property-notice-ack:\$\{context\.userId\}`/);
  assert.match(QA, /throwIfRateLimited\(\s*`property-analysis-ask:\$\{context\.userId\}`/);
});

test("the notice dismissal gate is passed through, not re-decided in the transport", () => {
  // The three-acknowledgment rule lives in the server module and in a table
  // check constraint. This layer must only validate the action name.
  assert.match(INTAKE, /acknowledge-and-dismiss/);
  assert.ok(
    !/acknowledgment_count|>= 3|dismissed_at/.test(INTAKE),
    "the dismissal gate must not be re-implemented in the function layer",
  );
});

test("the dossier refresh and the Q&A trail write both use the service-role client, not the caller's", () => {
  // ACC-20260924-003: property_analysis_messages/_question_runs/_question_events
  // are service-role write only (20260924210000) -- `authenticated` holds no
  // INSERT grant on any of the three, so askAnalysisThread must never be
  // called with the request's own client.
  assert.match(QA, /withPropertyDossierClient\(/);
  assert.match(QA, /askAnalysisThread\(database,/);
  assert.ok(
    !/askAnalysisThread\(context\.supabase/.test(QA),
    "askAnalysisThread must not be called with the caller's own RLS-scoped client",
  );
});
