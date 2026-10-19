// Wiring for the intake and notice UI.
//
// A server function nobody renders is as unreachable as a module nobody
// calls -- the same gap one layer up. These assertions pin that the two
// components exist, that they consume the server functions rather than
// reaching past them, and that the notice's dismissal gate is not
// re-decided in the browser, where it could simply be edited away.
//
// Source-level assertions, in this repo's existing style for wiring tests:
// the components import @tanstack/react-start and React, which this session
// cannot resolve.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function sourceOf(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const INTAKE_UI = sourceOf("../src/components/property-intelligence/property-intake.tsx");
const NOTICE_UI = sourceOf(
  "../src/components/property-intelligence/property-intelligence-notice.tsx",
);

test("the intake form is rendered by a component that calls the intake server functions", () => {
  assert.match(INTAKE_UI, /export function PropertyIntake/);
  assert.match(INTAKE_UI, /property-intake-notice\.functions/);
  assert.match(INTAKE_UI, /useServerFn\(getPropertyIntake\)/);
  assert.match(INTAKE_UI, /useServerFn\(savePropertyIntake\)/);
});

test("the notice is rendered by a component that calls the notice server functions", () => {
  assert.match(NOTICE_UI, /export function PropertyIntelligenceNotice/);
  assert.match(NOTICE_UI, /property-intake-notice\.functions/);
  assert.match(NOTICE_UI, /useServerFn\(getPropertyIntelligenceNotice\)/);
  assert.match(NOTICE_UI, /useServerFn\(acknowledgePropertyIntelligenceNotice\)/);
});

test("neither component reaches past its server function to the database", () => {
  for (const [name, source] of [
    ["intake", INTAKE_UI],
    ["notice", NOTICE_UI],
  ] as const) {
    assert.ok(
      !/supabase|client\.server|\.server"/.test(source),
      `${name} UI must go through its server function, not a database client`,
    );
  }
});

test("the notice's dismissal gate is reported by the server, never decided in the browser", () => {
  // The three-acknowledgment rule lives in the server module and a table
  // check constraint. A component-side threshold could be edited away.
  assert.match(NOTICE_UI, /const canDismissNow = current\.canDismiss/);
  assert.ok(
    !/acknowledgmentCount\s*\+\s*1\s*>=|>=\s*3\b/.test(NOTICE_UI),
    "the UI must not compute its own dismissal eligibility",
  );
});

test("the notice renders nothing once the account has dismissed it", () => {
  assert.match(NOTICE_UI, /if \(current\.dismissed\) return null/);
});

test("a rejected intake value is surfaced rather than swallowed", () => {
  // Server-side normalization can refuse a claim; the user has to learn
  // which one, so the error path must reach the UI.
  assert.match(INTAKE_UI, /onError/);
  assert.match(INTAKE_UI, /toast\.error/);
});

test("the server's stored answers win over the local draft", () => {
  assert.match(INTAKE_UI, /if \(data\) setClaims\(data\)/);
  assert.match(INTAKE_UI, /onSuccess:[\s\S]{0,120}setClaims\(saved\)/);
});
