// Slice 2 of the nationwide multi-state ingestion port. Ported behavioral
// contracts from the source's tests/nationwide-ingestion-run.test.mjs
// (batch planning + snapshot coverage evaluation), against this repo's pure
// port in nationwide-ingestion-orchestrator.ts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSnapshotCoverage,
  normalizeUniqueSourceObjectIds,
  planConfirmedWithdrawals,
  planSourceObjectIdBatches,
} from "../src/lib/property-intelligence/nationwide-ingestion-orchestrator.ts";

test("planSourceObjectIdBatches sorts, dedupes, and chunks IDs by batchSize", () => {
  const batches = planSourceObjectIdBatches(["3", "1", "2", 4], 2, 10);
  assert.deepEqual(batches, [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("planSourceObjectIdBatches rejects a batchSize above serviceMaximum", () => {
  assert.throws(
    () => planSourceObjectIdBatches(["1"], 5, 2),
    /cannot exceed the source service maximum/,
  );
});

test("normalizeUniqueSourceObjectIds rejects duplicates and blank IDs", () => {
  assert.throws(() => normalizeUniqueSourceObjectIds(["1", "1"], "objectIds"), /duplicate/);
  assert.throws(() => normalizeUniqueSourceObjectIds(["  "], "objectIds"), /cannot be blank/);
});

test("a fully matched, single-succeeded-batch snapshot is complete and can publish withdrawals", () => {
  const coverage = evaluateSnapshotCoverage({
    expectedIds: ["1", "2", "3"],
    reportedCount: 3,
    serviceMaximum: 100,
    batches: [
      {
        batchNumber: 1,
        requestedIds: ["1", "2", "3"],
        returnedIds: ["1", "2", "3"],
        status: "succeeded",
        error: null,
      },
    ],
  });
  assert.equal(coverage.status, "complete");
  assert.equal(coverage.canPublishWithdrawals, true);
  assert.deepEqual(coverage.missingIds, []);
  assert.deepEqual(coverage.warnings, []);
});

test("a failed batch marks coverage failed and suppresses withdrawals", () => {
  const coverage = evaluateSnapshotCoverage({
    expectedIds: ["1", "2"],
    reportedCount: 2,
    serviceMaximum: 100,
    batches: [
      {
        batchNumber: 1,
        requestedIds: ["1", "2"],
        returnedIds: [],
        status: "failed",
        error: "timeout",
      },
    ],
  });
  assert.equal(coverage.status, "failed");
  assert.equal(coverage.canPublishWithdrawals, false);
  assert.match(coverage.warnings[0]!, /Batch 1 failed: timeout/);
});

test("a partially-returned snapshot with an unexpected ID is partial, not complete", () => {
  const coverage = evaluateSnapshotCoverage({
    expectedIds: ["1", "2"],
    reportedCount: 2,
    serviceMaximum: 100,
    batches: [
      {
        batchNumber: 1,
        requestedIds: ["1", "2"],
        returnedIds: ["1", "9"],
        status: "succeeded",
        error: null,
      },
    ],
  });
  assert.equal(coverage.status, "partial");
  assert.equal(coverage.canPublishWithdrawals, false);
  assert.deepEqual(coverage.missingIds, ["2"]);
  assert.deepEqual(coverage.unexpectedIds, ["9"]);
});

// Ported from property-intelligence-app's withdrawal-planning contract.
// A record missing from a PARTIAL snapshot is far more likely to mean the
// fetch was short than that the agency retired the record, so withdrawals are
// only ever published from a complete snapshot.
test("withdrawals are suppressed unless the snapshot is complete", () => {
  const incomplete = { canPublishWithdrawals: false } as Parameters<
    typeof planConfirmedWithdrawals
  >[2];
  const suppressed = planConfirmedWithdrawals(["a", "b"], ["a"], incomplete);
  assert.deepEqual(suppressed.withdrawalRecordKeys, []);
  assert.equal(suppressed.suppressed, true);
  assert.match(suppressed.reason, /not complete/i);
});

test("a complete snapshot withdraws exactly the records that disappeared", () => {
  const complete = { canPublishWithdrawals: true } as Parameters<
    typeof planConfirmedWithdrawals
  >[2];
  const planned = planConfirmedWithdrawals(["a", "b", "c"], ["a", "c"], complete);
  assert.deepEqual(planned.withdrawalRecordKeys, ["b"]);
  assert.equal(planned.suppressed, false);

  const unchanged = planConfirmedWithdrawals(["a"], ["a"], complete);
  assert.deepEqual(unchanged.withdrawalRecordKeys, [], "nothing absent, nothing withdrawn");

  const brandNew = planConfirmedWithdrawals([], ["a", "b"], complete);
  assert.deepEqual(brandNew.withdrawalRecordKeys, [], "new records are not withdrawals");
});
