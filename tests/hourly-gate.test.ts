import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

// Regression for ACC-20260918-001: the REFS gate's extension alternation
// matched "ts" before "tsx" was tried, so a cited "site-header.tsx" was
// truncated to "site-header.ts" and falsely reported as a missing file.
test("gateReferencedArtifacts' PATH regex does not truncate .tsx to .ts", () => {
  const source = readFileSync(resolve(ROOT, "scripts/hourly-gate.mjs"), "utf8");
  const match = source.match(/const PATH = (\/.*?\/g);/);
  assert.ok(match, "could not locate the PATH regex in scripts/hourly-gate.mjs");

  const PATH: RegExp = eval(match![1]);

  const hit = "src/components/site-header.tsx".match(PATH);
  assert.deepEqual(hit, ["src/components/site-header.tsx"]);
});
