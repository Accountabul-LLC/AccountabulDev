import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateOpenWorkspaceInput } from "../src/lib/property-intelligence/workspace-validation.ts";
import {
  resetMemoryRateLimits,
  throwIfRateLimited,
} from "../src/lib/security/rate-limit.server.ts";

const functionsSource = await readFile(
  new URL("../src/lib/property-intelligence/property-workspace.functions.ts", import.meta.url),
  "utf8",
);

test("ACC-20260923-006: openPropertyWorkspace drops every client-supplied field but the parcel id", () => {
  const forged = {
    parcel: {
      parcelId: "50289230000",
      address: "5253 MAFFITT AV",
      ownerName: "ANYONE I WANT",
      assessedTotalValue: 1,
      taxBalance: 999999,
      legalDescription: "FORGED LOT DESCRIPTION",
      sourceUrl: "https://attacker.example/not-the-city",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const result = validateOpenWorkspaceInput(forged);
  assert.deepEqual(result, { parcelId: "50289230000" });
  // No trace of the forged fields survives the boundary.
  assert.equal(Object.keys(result).length, 1);
});

test("ACC-20260923-006: rejects a parcel id that is not exactly 11 digits", () => {
  assert.throws(() => validateOpenWorkspaceInput({ parcel: { parcelId: "123" } }), /Assessor/);
  assert.throws(
    () => validateOpenWorkspaceInput({ parcel: { parcelId: "1234567890a" } }),
    /Assessor/,
  );
  assert.throws(() => validateOpenWorkspaceInput({ parcel: {} }), /Assessor/);
  assert.throws(() => validateOpenWorkspaceInput({ parcel: null }), /Assessor/);
});

test("ACC-20260923-006: address alone (no parcelId) is not accepted", () => {
  // The old validator accepted any non-empty address; the fix requires a
  // real parcel id regardless of what else is in the payload.
  assert.throws(() => validateOpenWorkspaceInput({ parcel: { address: "1 MAIN ST" } }), /Assessor/);
});

test("ACC-20260923-006: the server re-verifies against the live Assessor service before writing", () => {
  // searchParcels/openPropertyWorkspace's handler must call searchAssessorParcels
  // itself and use its result, not data.parcel, when writing the canonical record.
  assert.match(
    functionsSource,
    /const \[verified\] = await searchAssessorParcels\(data\.parcelId\)/,
  );
  assert.match(functionsSource, /resolveOrCreateWorkspace\(context\.userId, verified\)/);
  assert.doesNotMatch(functionsSource, /resolveOrCreateWorkspace\(context\.userId, data\.parcel\)/);
});

test("ACC-20260923-007: both the search and open-workspace paths are rate limited", () => {
  assert.match(functionsSource, /searchParcels = createServerFn/);
  assert.match(functionsSource, /openPropertyWorkspace = createServerFn/);
  const occurrences = functionsSource.match(/throwIfRateLimited\(/g) ?? [];
  assert.equal(occurrences.length, 2);
});

test("ACC-20260923-007: the shared rate limiter denies past its configured limit", async () => {
  resetMemoryRateLimits();
  const key = "property-workspace-open:test-user";
  for (let i = 0; i < 20; i += 1) {
    await throwIfRateLimited(key, 20, 60_000);
  }
  await assert.rejects(() => throwIfRateLimited(key, 20, 60_000), /Too many requests/);
});
