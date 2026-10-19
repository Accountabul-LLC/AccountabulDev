// Slice 4 of the nationwide multi-state ingestion port. Exercises
// nationwide-postgres-run-store.ts against a hand-written, in-memory fake
// PostgresTransactionHost modeling the run/dispatch-evidence tables it
// actually queries. Never a network connection, never a real or embedded
// Postgres, matching this repo's established fake-DB test style.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  finalizeSnapshotIngestionRun,
  persistSnapshotBatchResult,
  startSnapshotIngestionRun,
} from "../src/lib/property-intelligence/nationwide-postgres-run-store.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

const SOURCE_DEFINITION_ID = "11111111-1111-4111-8111-111111111111";

type RunRow = {
  id: string;
  source_definition_id: string;
  run_key: string;
  scheduled_for: string;
  attempt: number;
  mapping_version: number;
  service_maximum: number;
  expected_set_fingerprint: string;
  run_contract_fingerprint: string;
  withdrawal_mode: string;
  discovery_status: string;
  source_reported_count: number;
  expected_unique_count: number;
  completed_at: string | null;
  withdrawals_allowed: boolean;
};

type SnapshotMemberRow = {
  ingestion_run_id: string;
  source_object_key: string;
  expected: boolean;
  returned_occurrences: number;
};
type BatchRow = {
  id: string;
  ingestion_run_id: string;
  batch_number: number;
  status: string;
  error_summary: string | null;
  request_fingerprint: string;
  result_fingerprint: string;
};
type BatchMemberRow = {
  ingestion_batch_id: string;
  source_object_key: string;
  requested: boolean;
  returned_occurrences: number;
};
type SourceRecordStateRow = {
  id: string;
  source_definition_id: string;
  source_record_key: string;
  current_source_record_id: string;
  withdrawn_at: string | null;
  withdrawal_run_id: string | null;
};
type PropertyRecordSearchRow = {
  source_definition_id: string;
  source_record_key: string;
  property_id: string | null;
  lifecycle_state: string;
  withdrawn_at: string | null;
};

class FakeRunStoreDatabase implements PostgresTransactionHost {
  runs: RunRow[] = [];
  snapshotMembers: SnapshotMemberRow[] = [];
  batches: BatchRow[] = [];
  batchMembers: BatchMemberRow[] = [];
  sourceRecordStates: SourceRecordStateRow[] = [];
  sourceRecordOccurrences: Array<{
    ingestion_run_id: string;
    source_record_key: string;
    created_new_version: boolean;
    parsing_status: string;
    resolution_status: string;
  }> = [];
  propertyRecordSearch: PropertyRecordSearchRow[] = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("select id from property_ingest.source_definitions where id = $1")) {
          return { rows: [{ id: params[0] }] } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("insert into property_ingest.ingestion_runs")) {
          const [
            sourceDefinitionId,
            runKey,
            scheduledFor,
            attempt,
            mappingVersion,
            ,
            serviceMaximum,
            expectedSetFingerprint,
            runContractFingerprint,
            withdrawalMode,
            discoveryStatus,
            ,
            ,
            ,
            ,
            ,
            reportedCount,
            expectedUniqueCount,
          ] = params as [
            string,
            string,
            string,
            number,
            number,
            string,
            number,
            string,
            string,
            string,
            string,
            unknown,
            unknown,
            unknown,
            unknown,
            string,
            number,
            number,
            string,
          ];
          const conflict = this.runs.find(
            (row) => row.source_definition_id === sourceDefinitionId && row.run_key === runKey,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const row: RunRow = {
            id: randomUUID(),
            source_definition_id: sourceDefinitionId,
            run_key: runKey,
            scheduled_for: scheduledFor,
            attempt,
            mapping_version: mappingVersion,
            service_maximum: serviceMaximum,
            expected_set_fingerprint: expectedSetFingerprint,
            run_contract_fingerprint: runContractFingerprint,
            withdrawal_mode: withdrawalMode,
            discovery_status: discoveryStatus,
            source_reported_count: reportedCount,
            expected_unique_count: expectedUniqueCount,
            completed_at: null,
            withdrawals_allowed: false,
          };
          this.runs.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith("insert into property_ingest.snapshot_members (") &&
          n.includes("true, 0")
        ) {
          const [runId, sourceObjectKey] = params as [string, string];
          this.snapshotMembers.push({
            ingestion_run_id: runId,
            source_object_key: sourceObjectKey,
            expected: true,
            returned_occurrences: 0,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select id, mapping_version, service_maximum, expected_set_fingerprint")) {
          const [sourceDefinitionId, runKey] = params as [string, string];
          const row = this.runs.find(
            (candidate) =>
              candidate.source_definition_id === sourceDefinitionId && candidate.run_key === runKey,
          );
          if (!row) throw new Error("run replay lookup failed");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith("select completed_at, service_maximum from property_ingest.ingestion_runs")
        ) {
          const [runId] = params as [string];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("runId does not identify an ingestion run");
          return {
            rows: [{ completed_at: row.completed_at, service_maximum: row.service_maximum }],
          } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("insert into property_ingest.ingestion_batches")) {
          const [
            runId,
            batchNumber,
            ,
            ,
            status,
            requestFingerprint,
            resultFingerprint,
            ,
            ,
            ,
            ,
            ,
            ,
            errorSummary,
          ] = params as [
            string,
            number,
            number,
            number,
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            number | null,
            string,
            string,
            string | null,
          ];
          const conflict = this.batches.find(
            (row) => row.ingestion_run_id === runId && row.batch_number === batchNumber,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const row: BatchRow = {
            id: randomUUID(),
            ingestion_run_id: runId,
            batch_number: batchNumber,
            status,
            error_summary: errorSummary,
            request_fingerprint: requestFingerprint,
            result_fingerprint: resultFingerprint,
          };
          this.batches.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select id, request_fingerprint, result_fingerprint from property_ingest.ingestion_batches",
          )
        ) {
          const [runId, batchNumber] = params as [string, number];
          const row = this.batches.find(
            (candidate) =>
              candidate.ingestion_run_id === runId && candidate.batch_number === batchNumber,
          );
          if (!row) throw new Error("batch replay lookup failed");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("insert into property_ingest.ingestion_batch_members")) {
          const [batchId, sourceObjectKey, requested, returnedOccurrences] = params as [
            string,
            string,
            boolean,
            number,
          ];
          this.batchMembers.push({
            ingestion_batch_id: batchId,
            source_object_key: sourceObjectKey,
            requested,
            returned_occurrences: returnedOccurrences,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith("insert into property_ingest.snapshot_members (") &&
          n.includes("false, $3")
        ) {
          const [runId, sourceObjectKey, returnedOccurrences] = params as [string, string, number];
          const existing = this.snapshotMembers.find(
            (row) => row.ingestion_run_id === runId && row.source_object_key === sourceObjectKey,
          );
          if (existing) existing.returned_occurrences += returnedOccurrences;
          else
            this.snapshotMembers.push({
              ingestion_run_id: runId,
              source_object_key: sourceObjectKey,
              expected: false,
              returned_occurrences: returnedOccurrences,
            });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select id, source_definition_id, source_reported_count, service_maximum, withdrawal_mode",
          )
        ) {
          const [runId] = params as [string];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("runId does not identify an ingestion run");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select source_object_key from property_ingest.snapshot_members")) {
          const [runId] = params as [string];
          const rows = this.snapshotMembers
            .filter((row) => row.ingestion_run_id === runId && row.expected)
            .map((row) => ({ source_object_key: row.source_object_key }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select id, batch_number, status, error_summary from property_ingest.ingestion_batches",
          )
        ) {
          const [runId] = params as [string];
          const rows = this.batches.filter((row) => row.ingestion_run_id === runId);
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select member.ingestion_batch_id, member.source_object_key")) {
          const [runId] = params as [string];
          const batchIds = new Set(
            this.batches.filter((row) => row.ingestion_run_id === runId).map((row) => row.id),
          );
          const rows = this.batchMembers.filter((row) => batchIds.has(row.ingestion_batch_id));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (n.includes("as accepted,")) {
          const [runId] = params as [string];
          const occurrences = this.sourceRecordOccurrences.filter(
            (row) => row.ingestion_run_id === runId,
          );
          return {
            rows: [
              {
                accepted: occurrences.length,
                unchanged: occurrences.filter((row) => !row.created_new_version).length,
                partial_parses: occurrences.filter((row) => row.parsing_status === "partial")
                  .length,
                unresolved: occurrences.filter((row) => row.resolution_status !== "resolved")
                  .length,
                linked: occurrences.filter((row) => row.resolution_status === "resolved").length,
                rejected: 0,
              },
            ],
          } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select distinct error_summary from property_ingest.ingestion_batches")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select source_record_key from property_ingest.source_record_states where withdrawal_run_id",
          )
        ) {
          const [runId] = params as [string];
          const rows = this.sourceRecordStates
            .filter((row) => row.withdrawal_run_id === runId)
            .map((row) => ({ source_record_key: row.source_record_key }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select distinct record.source_record_key")) {
          const [runId] = params as [string];
          const rows = this.sourceRecordOccurrences
            .filter((row) => row.ingestion_run_id === runId)
            .map((row) => ({ source_record_key: row.source_record_key }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select id, source_record_key, current_source_record_id from property_ingest.source_record_states",
          )
        ) {
          const [sourceDefinitionId] = params as [string];
          const rows = this.sourceRecordStates.filter(
            (row) => row.source_definition_id === sourceDefinitionId && row.withdrawn_at === null,
          );
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (n.startsWith("update property_ingest.source_record_states set withdrawn_at")) {
          const [withdrawnAt, withdrawalRunId, id] = params as [string, string, string];
          const row = this.sourceRecordStates.find(
            (candidate) => candidate.id === id && candidate.withdrawn_at === null,
          );
          if (row) {
            row.withdrawn_at = withdrawnAt;
            row.withdrawal_run_id = withdrawalRunId;
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select property_id from property_api.property_record_search")) {
          const [sourceDefinitionId, sourceRecordKey] = params as [string, string];
          const rows = this.propertyRecordSearch
            .filter(
              (row) =>
                row.source_definition_id === sourceDefinitionId &&
                row.source_record_key === sourceRecordKey,
            )
            .map((row) => ({ property_id: row.property_id }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "update property_api.property_record_search set lifecycle_state = 'withdrawn'",
          )
        ) {
          const [sourceDefinitionId, sourceRecordKey, withdrawnAt] = params as [
            string,
            string,
            string,
          ];
          const row = this.propertyRecordSearch.find(
            (candidate) =>
              candidate.source_definition_id === sourceDefinitionId &&
              candidate.source_record_key === sourceRecordKey,
          );
          if (row) {
            row.lifecycle_state = "withdrawn";
            row.withdrawn_at = withdrawnAt;
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select id from property_core.auction_lots where source_record_id")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("update property_ingest.ingestion_runs set")) {
          const [runId, completedAt, , , , , , , , , , , , coverageStatus, withdrawalsAllowed] =
            params as [
              string,
              string,
              string,
              string,
              string,
              string,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              string,
              boolean,
              string,
              string | null,
            ];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("run finalization update failed");
          row.completed_at = completedAt;
          row.withdrawals_allowed = withdrawalsAllowed;
          void coverageStatus;
          return { rows: [{ id: runId }] } as unknown as PostgresQueryResult<Row>;
        }

        throw new Error(`FakeRunStoreDatabase: unmodeled query: ${n.slice(0, 100)}`);
      },
    });
  }
}

function startInput(overrides: Partial<Parameters<typeof startSnapshotIngestionRun>[1]> = {}) {
  return {
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    runKey: "run-2026-09-24",
    scheduledFor: "2026-09-24T00:00:00.000Z",
    attempt: 1,
    mappingVersion: 1,
    initiatedBy: "test-suite",
    serviceMaximum: 500,
    reportedCount: 0,
    expectedIds: [] as string[],
    withdrawalMode: "complete_snapshot" as const,
    discoveryStatus: "succeeded" as const,
    discoveryArtifact: {
      sha256: "a".repeat(64),
      objectStorageKey: "runs/discovery.json",
      mimeType: "application/json",
      byteSize: 2,
    },
    startedAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

test("Slice 4: starting the same run twice replays the same runId (replay-safe)", async () => {
  const database = new FakeRunStoreDatabase();
  const first = await startSnapshotIngestionRun(database, startInput());
  const second = await startSnapshotIngestionRun(database, startInput());
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.runId, first.runId);
  assert.equal(database.runs.length, 1);
});

test("Slice 4: starting the same runKey with a different immutable contract is rejected", async () => {
  const database = new FakeRunStoreDatabase();
  await startSnapshotIngestionRun(database, startInput());
  await assert.rejects(
    startSnapshotIngestionRun(
      database,
      startInput({ reportedCount: 5, expectedIds: ["a", "b", "c", "d", "e"] }),
    ),
    /different immutable snapshot contract/,
  );
});

test("Slice 4: a complete run persists replay-safe batch evidence and final counts", async () => {
  const database = new FakeRunStoreDatabase();
  const started = await startSnapshotIngestionRun(database, startInput());

  const batchInput = {
    runId: started.runId,
    batchNumber: 1,
    requestedIds: [] as string[],
    returnedIds: [] as string[],
    status: "succeeded" as const,
    error: null,
    startedAt: "2026-09-24T00:00:00.000Z",
    completedAt: "2026-09-24T00:01:00.000Z",
    artifact: {
      sha256: "b".repeat(64),
      objectStorageKey: "runs/batch-1.json",
      mimeType: "application/json",
      byteSize: 2,
    },
  };
  const firstBatch = await persistSnapshotBatchResult(database, batchInput);
  const replayedBatch = await persistSnapshotBatchResult(database, batchInput);
  assert.equal(firstBatch.replayed, false);
  assert.equal(replayedBatch.replayed, true);
  assert.equal(replayedBatch.batchId, firstBatch.batchId);

  const finalized = await finalizeSnapshotIngestionRun(database, {
    runId: started.runId,
    completedAt: "2026-09-24T00:02:00.000Z",
  });
  assert.equal(finalized.coverage.status, "complete");
  assert.equal(finalized.rowsSeen, 0);
  assert.equal(finalized.rowsAccepted, 0);

  // Finalizing an already-finalized run replays its final counts instead of
  // re-running withdrawal logic a second time.
  const replayedFinalize = await finalizeSnapshotIngestionRun(database, {
    runId: started.runId,
    completedAt: "2026-09-24T00:05:00.000Z",
  });
  assert.equal(replayedFinalize.replayed, true);
});

test("Slice 4: withdraw only on complete absence -- a complete run withdraws a record it did not see, and leaves a seen record alone", async () => {
  const database = new FakeRunStoreDatabase();
  // Seed two active source_record_states for this source: one this run will
  // see again (must stay active), one it will NOT see (must be withdrawn).
  const seenRecordId = randomUUID();
  const absentRecordId = randomUUID();
  database.sourceRecordStates.push(
    {
      id: randomUUID(),
      source_definition_id: SOURCE_DEFINITION_ID,
      source_record_key: "seen-record",
      current_source_record_id: seenRecordId,
      withdrawn_at: null,
      withdrawal_run_id: null,
    },
    {
      id: randomUUID(),
      source_definition_id: SOURCE_DEFINITION_ID,
      source_record_key: "absent-record",
      current_source_record_id: absentRecordId,
      withdrawn_at: null,
      withdrawal_run_id: null,
    },
  );
  database.propertyRecordSearch.push(
    {
      source_definition_id: SOURCE_DEFINITION_ID,
      source_record_key: "seen-record",
      property_id: null,
      lifecycle_state: "active",
      withdrawn_at: null,
    },
    {
      source_definition_id: SOURCE_DEFINITION_ID,
      source_record_key: "absent-record",
      property_id: null,
      lifecycle_state: "active",
      withdrawn_at: null,
    },
  );

  const started = await startSnapshotIngestionRun(
    database,
    startInput({ runKey: "run-2", reportedCount: 1, expectedIds: ["seen-record"] }),
  );
  // Model this run having actually returned (via a batch) the one expected
  // source object, and produced one occurrence for it.
  await persistSnapshotBatchResult(database, {
    runId: started.runId,
    batchNumber: 1,
    requestedIds: ["seen-record"],
    returnedIds: ["seen-record"],
    status: "succeeded",
    error: null,
    startedAt: "2026-09-24T00:00:00.000Z",
    completedAt: "2026-09-24T00:01:00.000Z",
    artifact: {
      sha256: "c".repeat(64),
      objectStorageKey: "runs/run-2/batch-1.json",
      mimeType: "application/json",
      byteSize: 2,
    },
  });
  database.sourceRecordOccurrences.push({
    ingestion_run_id: started.runId,
    source_record_key: "seen-record",
    created_new_version: false,
    parsing_status: "accepted",
    resolution_status: "unresolved",
  });

  const finalized = await finalizeSnapshotIngestionRun(database, {
    runId: started.runId,
    completedAt: "2026-09-24T01:00:00.000Z",
  });
  assert.equal(finalized.coverage.status, "complete");
  assert.equal(finalized.withdrawalsAllowed, true);
  assert.deepEqual(finalized.withdrawnRecordKeys, ["absent-record"]);

  const seen = database.sourceRecordStates.find((row) => row.source_record_key === "seen-record");
  const absent = database.sourceRecordStates.find(
    (row) => row.source_record_key === "absent-record",
  );
  assert.equal(seen?.withdrawn_at, null);
  assert.notEqual(absent?.withdrawn_at, null);
  assert.equal(
    database.propertyRecordSearch.find((row) => row.source_record_key === "absent-record")
      ?.lifecycle_state,
    "withdrawn",
  );
  assert.equal(
    database.propertyRecordSearch.find((row) => row.source_record_key === "seen-record")
      ?.lifecycle_state,
    "active",
  );
});
