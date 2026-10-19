// Wiring for the sandbox API key manager.
//
// property-api-keys.functions.ts predates this session and was complete and
// tested, but no component consumed it, so the key surface was unreachable
// from the application. These assertions pin the half that was missing, and
// the one property that makes this component different from a list view: a
// newly minted secret is returned exactly once and never stored, so it must
// be shown at creation and then dropped, not refetched or cached.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const UI = readFileSync(
  fileURLToPath(new URL("../src/components/property-intelligence/api-keys.tsx", import.meta.url)),
  "utf8",
);

test("the key manager consumes all three server functions", () => {
  assert.match(UI, /export function ApiKeys/);
  assert.match(UI, /useServerFn\(listSandboxApiKeys\)/);
  assert.match(UI, /useServerFn\(createSandboxApiKey\)/);
  assert.match(UI, /useServerFn\(revokeSandboxApiKey\)/);
  assert.match(UI, /property-api-keys\.functions/);
});

test("the raw secret is surfaced once and then discarded from component state", () => {
  assert.match(UI, /setFreshSecret\(result\.rawKey\)/);
  assert.match(UI, /setFreshSecret\(null\)/, "the secret must be dismissable, not left in memory");
  assert.ok(
    !/queryKey: \["property-api-key-secret/.test(UI),
    "the secret must never be cached by the query client",
  );
});

test("the UI does not reach past its server functions to a database client", () => {
  assert.ok(!/supabase|client\.server/.test(UI));
});

test("the quota and access-request rules are shown, not re-decided", () => {
  // Both are enforced by the server module and a database trigger. The
  // component may display the count but must not gate on its own arithmetic.
  assert.match(UI, /activeKeys\.length/);
  assert.ok(
    !/activeKeys\.length\s*>=\s*3\s*\?|disabled=\{[^}]*activeKeys\.length\s*>=/.test(UI),
    "the 3-key quota belongs to the server, not the button's disabled state",
  );
});

test("server refusals reach the user verbatim", () => {
  // "No approved access request" and "revoke a key first" are the useful
  // messages here; swallowing them would leave a dead button.
  assert.match(UI, /onError/);
  assert.match(UI, /toast\.error/);
  assert.match(UI, /error instanceof Error \? error\.message/);
});

// --- Analysis Q&A panel -----------------------------------------------------

const QA_UI = readFileSync(
  fileURLToPath(
    new URL("../src/components/property-intelligence/property-analysis-qa.tsx", import.meta.url),
  ),
  "utf8",
);

const ANALYSIS_UI = readFileSync(
  fileURLToPath(
    new URL("../src/components/property-intelligence/property-analysis.tsx", import.meta.url),
  ),
  "utf8",
);

test("the Q&A panel consumes the ask server function and is rendered by the analysis view", () => {
  assert.match(QA_UI, /useServerFn\(askPropertyAnalysisQuestion\)/);
  assert.match(ANALYSIS_UI, /import \{ PropertyAnalysisQa \}/);
  assert.match(ANALYSIS_UI, /<PropertyAnalysisQa threadId=\{activeThreadId\}/);
});

test("an unanswerable question is shown as unanswerable, not as a finding", () => {
  // routePropertyQuestion reports handlerCanAnswer server-side. Rendering a
  // routed non-answer as an ordinary paragraph would read as a conclusion.
  assert.match(QA_UI, /exchange\.decision\.handlerCanAnswer \? null :/);
  assert.match(QA_UI, /could not be answered from the records on file/);
  assert.match(QA_UI, /missingSources/);
});

test("the panel never computes an answer of its own", () => {
  // Comments stripped first: the header explains WHY routing stays on the
  // server, and matching that prose would pass or fail for the wrong reason.
  const code = QA_UI.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/routePropertyQuestion|buildPropertyReport/.test(code),
    "the answer and its routing decision must come from the server",
  );
  assert.ok(!/supabase|client\.server/.test(code));
});

test("every property-intelligence server-function surface has a UI consumer", () => {
  // The gap this suite exists for is a tested surface nobody renders. This
  // is the sweep, so a new .functions.ts added without a consumer fails here
  // rather than being noticed several commits later.
  const libDir = fileURLToPath(new URL("../src/lib/property-intelligence/", import.meta.url));
  const uiRoots = [
    fileURLToPath(new URL("../src/components/", import.meta.url)),
    fileURLToPath(new URL("../src/routes/", import.meta.url)),
  ];
  const surfaces = readdirSync(libDir).filter((name) => name.endsWith(".functions.ts"));
  assert.ok(surfaces.length >= 8, "expected the known server-function surfaces");

  const ui: string[] = [];
  for (const root of uiRoots) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}${entry.name}`;
        if (entry.isDirectory()) walk(`${full}/`);
        else if (/\.tsx?$/.test(entry.name)) ui.push(readFileSync(full, "utf8"));
      }
    };
    walk(root);
  }
  const blob = ui.join("\n");

  const unconsumed = surfaces
    .map((name) => name.replace(/\.ts$/, ""))
    .filter((name) => !blob.includes(name));
  assert.deepEqual(unconsumed, [], "these server-function surfaces are unreachable from the UI");
});

test("every property-intelligence component is reachable from a route", () => {
  // The layer above the server-function sweep: a component nobody renders is
  // as unreachable as a server function nobody calls. This session hit that
  // gap at three successive layers (module, server function, component), so
  // both sweeps are pinned rather than repeated by hand.
  const componentDir = fileURLToPath(
    new URL("../src/components/property-intelligence/", import.meta.url),
  );
  const components = readdirSync(componentDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => name.replace(/\.tsx$/, ""));
  assert.ok(components.length >= 12, "expected the known property-intelligence components");

  const sources: Array<{ name: string; text: string }> = [];
  for (const root of [
    fileURLToPath(new URL("../src/components/", import.meta.url)),
    fileURLToPath(new URL("../src/routes/", import.meta.url)),
  ]) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}${entry.name}`;
        if (entry.isDirectory()) walk(`${full}/`);
        else if (/\.tsx?$/.test(entry.name)) {
          sources.push({
            name: entry.name.replace(/\.tsx?$/, ""),
            text: readFileSync(full, "utf8"),
          });
        }
      }
    };
    walk(root);
  }

  const unrendered = components.filter((component) =>
    sources.every(
      (source) =>
        source.name === component ||
        !source.text.includes(`components/property-intelligence/${component}"`),
    ),
  );
  assert.deepEqual(unrendered, [], "these components are never rendered by anything");
});
