// The snapshot ingestion failure path.
//
// This covers a defect the per-stage tests could not see, because it lives in
// the ORDER the stages run rather than in any one of them. `runSnapshotIngestion`
// recorded batch 1 as "succeeded" before normalizing, resolving or writing a
// single row, and had no error handling at all. So a row that failed to write
// left behind a succeeded batch and an ingestion_runs row with no completed_at:
// finalize never ran, and if it had, it would have rolled that batch up as
// complete coverage with withdrawals allowed -- a partial ingest published as a
// whole snapshot.
//
// Two kinds of assertion here, and the difference matters:
//
//   * `safeIngestionErrorSummary` is exercised for real -- it is a pure
//     function and its output is written to a column other operators read.
//   * The ordering and failure handling are asserted against the module
//     SOURCE. Executing that path would need an in-memory Postgres covering
//     the run store, the writer and the resolver; this repository already has
//     two separate hand-built fakes for two of those, and merging them would
//     produce a large artifact that mostly tests its own fidelity. Structural
//     assertions are this repo's existing style for wiring (see the ops-route
//     and UI wiring tests) and they pin exactly what regressed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { safeIngestionErrorSummary } from "../src/lib/property-intelligence/nationwide-source-adapter-bindings.ts";

const SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../src/lib/property-intelligence/nationwide-source-adapter-bindings.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("a batch is recorded only after the rows it covers have been written", () => {
  const loop = SOURCE.indexOf("for (const row of rows)");
  const persist = SOURCE.indexOf("await persistSnapshotBatchResult(");
  assert.ok(loop > 0 && persist > 0);
  assert.ok(
    loop < persist,
    "recording the batch first means a failed write still leaves a succeeded batch",
  );
});

test("a failure marks the batch failed and claims nothing was returned", () => {
  assert.match(SOURCE, /status: failure === null \? "succeeded" : "failed"/);
  assert.match(SOURCE, /returnedIds: failure === null \? sourceObjectIds : \[\]/);
  assert.match(
    SOURCE,
    /artifact:\s*\n\s*failure === null/,
    "a failed batch has no response artifact to archive",
  );
});

test("a failure finalizes the run before rethrowing, so no run is left open", () => {
  const failureBlock = SOURCE.slice(SOURCE.indexOf("if (failure !== null) {"));
  const finalize = failureBlock.indexOf("finalizeSnapshotIngestionRun(");
  const rethrow = failureBlock.indexOf("throw failure;");
  assert.ok(finalize > 0, "the run must be finalized on the failure path");
  assert.ok(
    finalize < rethrow,
    "an escaped throw leaves ingestion_runs open while the dispatch is marked failed",
  );
});

test("the failure still propagates, so the dispatch is marked failed too", () => {
  assert.match(SOURCE, /throw failure;/);
});

test("an error summary that could carry a secret is replaced", () => {
  const fallback = "nationwide snapshot ingestion failed";
  for (const message of [
    "connect failed postgres://user:pass@host/db",
    "GET https://api.example.gov/layer/query returned 500",
    "bad api_key",
    "Bearer abc123 rejected",
    "invalid password",
    "fetch of ?token=abc failed",
  ]) {
    assert.equal(safeIngestionErrorSummary(new Error(message)), fallback, message);
  }
});

test("an ordinary error message survives, bounded and single-line", () => {
  assert.equal(
    safeIngestionErrorSummary(new Error("row 41 is missing a parcel identifier")),
    "row 41 is missing a parcel identifier",
  );
  assert.equal(
    safeIngestionErrorSummary(new Error("line one\nline two")),
    "line one line two",
    "a multi-line message is flattened rather than written across rows",
  );
  assert.equal(safeIngestionErrorSummary(new Error("x".repeat(400))).length, 240);
});

test("a non-Error throw still produces a usable summary", () => {
  const fallback = "nationwide snapshot ingestion failed";
  assert.equal(safeIngestionErrorSummary("just a string"), fallback);
  assert.equal(safeIngestionErrorSummary(null), fallback);
  assert.equal(safeIngestionErrorSummary(new Error("   ")), fallback);
});
