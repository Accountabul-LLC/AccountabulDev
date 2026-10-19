// Contract for the production composition root and the scheduled tick.
//
// These two modules are the layer that decides WHAT a deployment runs, so
// the tests are about configuration boundaries rather than ingestion: which
// contracts get advertised, what happens to an unconfigured source, and what
// is allowed to reach ingestion_dispatches.error_summary.
import assert from "node:assert/strict";
import test from "node:test";

import { createNationwideProductionSourceRegistry } from "../src/lib/property-intelligence/nationwide-production-source-registry.ts";
import {
  executeNationwideProductionWorkerTick,
  productionSafeErrorSummary,
} from "../src/lib/property-intelligence/nationwide-production-worker.ts";

const LRA_ROWS = {
  sourceDefinitionId: "11111111-2222-4333-8444-555555555555",
  jurisdictionId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
};
const LANDROLL_ROWS = {
  sourceDefinitionId: "22222222-3333-4444-8555-666666666666",
  jurisdictionId: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
};

const artifactStore = {
  putCanonicalJson: async () => {},
  putBytes: async () => {},
};

const database = {
  transaction: async <R>(cb: (t: unknown) => Promise<R>) =>
    cb({ query: async () => ({ rows: [] }) }),
};

function registryWith(sources: Record<string, unknown>) {
  return createNationwideProductionSourceRegistry({
    database: database as never,
    artifactStore: artifactStore as never,
    sources: sources as never,
  });
}

test("only the configured sources are advertised as claimable contracts", () => {
  const registry = registryWith({ officialStLouisLra: LRA_ROWS });
  assert.deepEqual(
    registry.allowedSourceContracts.map((contract) => contract.sourceKey),
    ["mo_st_louis_lra_inventory_v1"],
    "advertising an unconfigured source would let a worker claim work it cannot run",
  );
});

test("configuring two sources advertises both, at their registered contract versions", () => {
  const registry = registryWith({
    officialStLouisLra: LRA_ROWS,
    desotoCountyLandroll: LANDROLL_ROWS,
  });
  const advertised = registry.allowedSourceContracts
    .map((contract) => `${contract.sourceKey}:c${contract.contractVersion}`)
    .sort();
  assert.deepEqual(advertised, [
    "mo_st_louis_lra_inventory_v1:c3",
    "ms_desoto_county_landroll_2026_prelim_v1:c1",
  ]);
});

test("a registry with no configured source is refused rather than silently idle", () => {
  assert.throws(() => registryWith({}), /at least one configured source/);
});

test("a configured source must name real row IDs, not placeholders", () => {
  assert.throws(
    () => registryWith({ officialStLouisLra: { ...LRA_ROWS, sourceDefinitionId: "not-a-uuid" } }),
    /sourceDefinitionId must be a UUID/,
  );
  assert.throws(
    () => registryWith({ officialStLouisLra: { ...LRA_ROWS, jurisdictionId: "" } }),
    /jurisdictionId must be a UUID/,
  );
});

test("the registry requires its injected database and artifact store", () => {
  assert.throws(
    () =>
      createNationwideProductionSourceRegistry({
        artifactStore: artifactStore as never,
        sources: { officialStLouisLra: LRA_ROWS } as never,
      } as never),
    /requires an injected PostgresTransactionHost/,
  );
  assert.throws(
    () =>
      createNationwideProductionSourceRegistry({
        database: database as never,
        sources: { officialStLouisLra: LRA_ROWS } as never,
      } as never),
    /requires an injected artifactStore/,
  );
});

test("a misspelled source key fails the tick instead of configuring nothing", async () => {
  await assert.rejects(
    executeNationwideProductionWorkerTick({
      database: database as never,
      artifactStore: artifactStore as never,
      workerId: "worker-1",
      sources: { officialStLouisLRA: LRA_ROWS } as never,
    }),
    /unknown keys: officialStLouisLRA/,
  );
});

test("an empty queue stops the tick immediately and claims nothing", async () => {
  const result = await executeNationwideProductionWorkerTick({
    database: database as never,
    artifactStore: artifactStore as never,
    workerId: "worker-1",
    sources: { officialStLouisLra: LRA_ROWS },
    maxDispatchesPerTick: 5,
  });
  assert.equal(result.stoppedBecause, "idle");
  assert.equal(result.claimed, 0, "the idle probe is not claimed work");
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 0);
});

test("the tick's bounds are validated", async () => {
  const base = {
    database: database as never,
    artifactStore: artifactStore as never,
    workerId: "worker-1",
    sources: { officialStLouisLra: LRA_ROWS },
  };
  await assert.rejects(
    executeNationwideProductionWorkerTick({ ...base, leaseSeconds: 30 }),
    /leaseSeconds must be an integer between 60 and 3600/,
  );
  await assert.rejects(
    executeNationwideProductionWorkerTick({ ...base, maxDispatchesPerTick: 50 }),
    /maxDispatchesPerTick must be an integer between 1 and 20/,
  );
  await assert.rejects(
    executeNationwideProductionWorkerTick({ ...base, workerId: "  " }),
    /workerId is required/,
  );
});

test("an error summary that could carry a secret is replaced, not persisted", () => {
  const redact = productionSafeErrorSummary;
  const fallback = "nationwide source execution failed";
  assert.equal(redact(() => "postgres://user:pass@host/db")(new Error("x")), fallback);
  assert.equal(redact(() => "failed calling https://api.example.com")(new Error("x")), fallback);
  assert.equal(redact(() => "bad api_key supplied")(new Error("x")), fallback);
  assert.equal(redact(() => "Bearer abc123")(new Error("x")), fallback);
  assert.equal(redact(() => "leaked password")(new Error("x")), fallback);
  assert.equal(redact(() => "?token=abc")(new Error("x")), fallback);
});

test("an unusable summary falls back rather than writing junk to the dispatch row", () => {
  const fallback = "nationwide source execution failed";
  assert.equal(productionSafeErrorSummary(() => "")(new Error("x")), fallback);
  assert.equal(productionSafeErrorSummary(() => "a".repeat(241))(new Error("x")), fallback);
  assert.equal(productionSafeErrorSummary(() => "two\nlines")(new Error("x")), fallback);
  assert.equal(
    productionSafeErrorSummary(() => {
      throw new Error("summariser exploded");
    })(new Error("x")),
    fallback,
    "a throwing summariser must not take the tick down or leave the dispatch unrecorded",
  );
  assert.equal(productionSafeErrorSummary()(new Error("x")), fallback);
});

test("a clean summary is kept as written", () => {
  assert.equal(
    productionSafeErrorSummary(() => "parse failed on page 4")(new Error("x")),
    "parse failed on page 4",
  );
});
