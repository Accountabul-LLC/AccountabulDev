// Slice 4 of the nationwide multi-state ingestion port. Ported (condensed)
// from property-intelligence-app's app/lib/nationwide-postgres-run-store.ts:
// persists one ingestion run replay-safely (starting it is idempotent by
// `runKey`, re-starting with the same immutable contract replays the same
// `runId` instead of erroring) and finalizes it with final row counts and
// coverage evidence. Reuses Slice 4's already-ported pure coverage logic
// (`evaluateSnapshotCoverage`, `normalizeUniqueSourceObjectIds`) from
// nationwide-ingestion-orchestrator.ts instead of re-deriving it.
//
// Scope note: this port covers `startSnapshotIngestionRun`,
// `persistSnapshotBatchResult`, `recordIngestionRejection`, and
// `finalizeSnapshotIngestionRun` -- the replay-safe run lifecycle the task
// asks for -- plus a thin `getLatestScheduledIngestionSlot` lookup. It does
// not port the source's optional `mappingReleaseId` column (Slice 2's
// `ingestion_runs` table, already committed, has no such column) or its
// lease-owner check on finalize (this port's `finalizeSnapshotIngestionRun`
// does not require a lease, matching how a binding in
// nationwide-source-adapter-bindings.ts drives a run start-to-finish inside
// one call rather than across separately dispatched worker leases).
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import {
  evaluateSnapshotCoverage,
  normalizeUniqueSourceObjectIds,
  type SnapshotBatchResult,
  type SnapshotCoverage,
  type SourceObjectId,
} from "./nationwide-ingestion-orchestrator.ts";
import { refreshCanonicalPropertySearch } from "./nationwide-postgres-run-store-search.ts";
import { SHA256_HEX_ANY_CASE } from "../validation/patterns.ts";

export type SnapshotWithdrawalMode = "append_only" | "complete_snapshot";

export type SnapshotArtifactEvidence = {
  sha256: string;
  objectStorageKey: string;
  mimeType: string;
  byteSize: number;
};

export type StartSnapshotRunInput = {
  sourceDefinitionId: string;
  runKey: string;
  scheduledFor: string;
  attempt: number;
  mappingVersion: number;
  initiatedBy: string;
  serviceMaximum: number;
  reportedCount: number;
  expectedIds: SourceObjectId[];
  withdrawalMode: SnapshotWithdrawalMode;
  discoveryStatus: "succeeded" | "failed";
  discoveryArtifact: SnapshotArtifactEvidence | null;
  runParameters?: Record<string, unknown>;
  startedAt: string;
};

export type StartedSnapshotRun = {
  runId: string;
  replayed: boolean;
  expectedUniqueCount: number;
  expectedSetFingerprint: string;
  runContractFingerprint: string;
};

export type PersistSnapshotBatchInput = SnapshotBatchResult & {
  runId: string;
  startedAt: string;
  completedAt: string;
  artifact: SnapshotArtifactEvidence | null;
};

export type PersistedSnapshotBatch = {
  batchId: string;
  replayed: boolean;
  requestFingerprint: string;
  resultFingerprint: string;
};

export type RecordIngestionRejectionInput = {
  runId: string;
  batchNumber: number | null;
  sourceObjectKey: string | null;
  recordLocator: string | null;
  rawJson: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
  observedAt: string;
};

export type RecordedIngestionRejection = {
  rejectionId: string;
  replayed: boolean;
  rejectionFingerprint: string;
};

export type FinalizedSnapshotRun = {
  runId: string;
  replayed: boolean;
  coverage: SnapshotCoverage;
  rowsSeen: number;
  rowsAccepted: number;
  rowsUnchanged: number;
  rowsRejected: number;
  rowsUnresolved: number;
  rowsLinked: number;
  withdrawalsAllowed: boolean;
  withdrawnRecordKeys: string[];
};

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

function requiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function iso(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function integer(value: number, field: string, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(`${field} must be an integer >= ${minimum}`);
  return value;
}

function numberValue(value: unknown) {
  return Number(value);
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function artifactEvidence(
  value: SnapshotArtifactEvidence | null,
  field: string,
): SnapshotArtifactEvidence | null {
  if (value === null) return null;
  if (!SHA256_HEX_ANY_CASE.test(value.sha256))
    throw new Error(`${field}.sha256 must be a SHA-256 hex digest`);
  requiredText(value.objectStorageKey, `${field}.objectStorageKey`);
  requiredText(value.mimeType, `${field}.mimeType`);
  integer(value.byteSize, `${field}.byteSize`, 0);
  return value;
}

async function one<Row extends Record<string, unknown>>(
  transaction: PostgresTransaction,
  sql: string,
  params: unknown[],
  failure: string,
): Promise<Row> {
  const result = await transaction.query<Row>(sql, params);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) throw new Error(failure);
  return row;
}

export async function getLatestScheduledIngestionSlot(
  database: PostgresTransactionHost,
  sourceDefinitionId: string,
): Promise<string | null> {
  assertUuid(sourceDefinitionId, "sourceDefinitionId");
  return database.transaction(async (transaction) => {
    const result = await transaction.query<{ scheduled_for: string }>(
      `select scheduled_for from property_ingest.ingestion_runs
       where source_definition_id = $1 order by scheduled_for desc, attempt desc limit 1`,
      [sourceDefinitionId],
    );
    const row = result.rows[0];
    return result.rows.length === 1 && row !== undefined
      ? new Date(row.scheduled_for).toISOString()
      : null;
  });
}

export async function startSnapshotIngestionRun(
  database: PostgresTransactionHost,
  input: StartSnapshotRunInput,
): Promise<StartedSnapshotRun> {
  assertUuid(input.sourceDefinitionId, "sourceDefinitionId");
  const runKey = requiredText(input.runKey, "runKey");
  const scheduledFor = iso(input.scheduledFor, "scheduledFor");
  const attempt = integer(input.attempt, "attempt", 1);
  const initiatedBy = requiredText(input.initiatedBy, "initiatedBy");
  const mappingVersion = integer(input.mappingVersion, "mappingVersion", 1);
  const serviceMaximum = integer(input.serviceMaximum, "serviceMaximum", 1);
  const reportedCount = integer(input.reportedCount, "reportedCount");
  const startedAt = iso(input.startedAt, "startedAt");
  const expectedIds = normalizeUniqueSourceObjectIds(input.expectedIds, "expectedIds");
  const discoveryArtifact = artifactEvidence(input.discoveryArtifact, "discoveryArtifact");
  if (input.discoveryStatus === "succeeded" && discoveryArtifact === null) {
    throw new Error("successful snapshot discovery requires an immutable discovery artifact");
  }
  const expectedSetFingerprint = await stableSha256(expectedIds);
  const runContractFingerprint = await stableSha256({
    mappingVersion,
    scheduledFor,
    attempt,
    serviceMaximum,
    reportedCount,
    expectedSetFingerprint,
    withdrawalMode: input.withdrawalMode,
    discoveryStatus: input.discoveryStatus,
    discoveryArtifact,
    runParameters: input.runParameters ?? {},
  });
  const runParameters = {
    ...(input.runParameters ?? {}),
    expectedSetFingerprint,
    serviceMaximum,
    withdrawalMode: input.withdrawalMode,
  };

  return database.transaction(async (transaction) => {
    await one(
      transaction,
      "select id from property_ingest.source_definitions where id = $1",
      [input.sourceDefinitionId],
      "sourceDefinitionId does not identify a registered source definition",
    );
    const inserted = await transaction.query<{ id: string }>(
      `insert into property_ingest.ingestion_runs (
         source_definition_id, run_key, scheduled_for, attempt, mapping_version, initiated_by,
         service_maximum, expected_set_fingerprint, run_contract_fingerprint, withdrawal_mode,
         discovery_status, discovery_artifact_sha256, discovery_object_storage_key,
         discovery_mime_type, discovery_byte_size, started_at, source_reported_count,
         expected_unique_count, run_parameters, coverage_status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, 'pending')
       on conflict (source_definition_id, run_key) do nothing
       returning id`,
      [
        input.sourceDefinitionId,
        runKey,
        scheduledFor,
        attempt,
        mappingVersion,
        initiatedBy,
        serviceMaximum,
        expectedSetFingerprint,
        runContractFingerprint,
        input.withdrawalMode,
        input.discoveryStatus,
        discoveryArtifact?.sha256 ?? null,
        discoveryArtifact?.objectStorageKey ?? null,
        discoveryArtifact?.mimeType ?? null,
        discoveryArtifact?.byteSize ?? null,
        startedAt,
        reportedCount,
        expectedIds.length,
        json(runParameters),
      ],
    );

    let runId: string;
    let replayed: boolean;
    if (inserted.rows.length === 1) {
      runId = (inserted.rows[0] as { id: string }).id;
      replayed = false;
      for (const sourceObjectKey of expectedIds) {
        await transaction.query(
          `insert into property_ingest.snapshot_members (ingestion_run_id, source_object_key, expected, returned_occurrences)
           values ($1, $2, true, 0)`,
          [runId, sourceObjectKey],
        );
      }
    } else {
      const existing = await one<{
        id: string;
        mapping_version: number;
        service_maximum: number;
        expected_set_fingerprint: string;
        run_contract_fingerprint: string;
        withdrawal_mode: SnapshotWithdrawalMode;
        discovery_status: "succeeded" | "failed";
        source_reported_count: number;
        expected_unique_count: number;
      }>(
        transaction,
        `select id, mapping_version, service_maximum, expected_set_fingerprint, run_contract_fingerprint,
                withdrawal_mode, discovery_status, source_reported_count, expected_unique_count
         from property_ingest.ingestion_runs where source_definition_id = $1 and run_key = $2 for update`,
        [input.sourceDefinitionId, runKey],
        "run replay lookup failed",
      );
      if (
        numberValue(existing.mapping_version) !== mappingVersion ||
        numberValue(existing.service_maximum) !== serviceMaximum ||
        existing.expected_set_fingerprint !== expectedSetFingerprint ||
        existing.run_contract_fingerprint !== runContractFingerprint ||
        existing.withdrawal_mode !== input.withdrawalMode ||
        existing.discovery_status !== input.discoveryStatus ||
        numberValue(existing.source_reported_count) !== reportedCount ||
        numberValue(existing.expected_unique_count) !== expectedIds.length
      ) {
        throw new Error("runKey already exists with a different immutable snapshot contract");
      }
      runId = existing.id;
      replayed = true;
    }

    return {
      runId,
      replayed,
      expectedUniqueCount: expectedIds.length,
      expectedSetFingerprint,
      runContractFingerprint,
    };
  });
}

function normalizeReturnedIds(values: SourceObjectId[]) {
  return values.map((value) => {
    const result = String(value).trim();
    if (!result) throw new Error("returnedIds cannot be blank");
    return result;
  });
}

export async function persistSnapshotBatchResult(
  database: PostgresTransactionHost,
  input: PersistSnapshotBatchInput,
): Promise<PersistedSnapshotBatch> {
  assertUuid(input.runId, "runId");
  const batchNumber = integer(input.batchNumber, "batchNumber", 1);
  const requestedIds = normalizeUniqueSourceObjectIds(input.requestedIds, "requestedIds");
  const returnedIds = normalizeReturnedIds(input.returnedIds);
  const startedAt = iso(input.startedAt, "startedAt");
  const completedAt = iso(input.completedAt, "completedAt");
  if (completedAt < startedAt) throw new Error("completedAt cannot precede startedAt");
  const error = input.error?.trim() || null;
  const artifact = artifactEvidence(input.artifact, "artifact");
  if (input.status !== "failed" && artifact === null) {
    throw new Error("a non-failed batch requires an immutable response artifact");
  }
  const requestFingerprint = await stableSha256(requestedIds);
  const resultFingerprint = await stableSha256({
    batchNumber,
    requestedIds,
    returnedIds,
    status: input.status,
    error,
    artifact,
  });

  return database.transaction(async (transaction) => {
    const run = await one<{ completed_at: string | null; service_maximum: number }>(
      transaction,
      "select completed_at, service_maximum from property_ingest.ingestion_runs where id = $1 for update",
      [input.runId],
      "runId does not identify an ingestion run",
    );
    if (run.completed_at) throw new Error("a finalized ingestion run cannot accept another batch");
    if (requestedIds.length > numberValue(run.service_maximum)) {
      throw new Error("requestedIds exceed the source service maximum registered for this run");
    }

    const inserted = await transaction.query<{ id: string }>(
      `insert into property_ingest.ingestion_batches (
         ingestion_run_id, batch_number, requested_count, returned_count, status, request_fingerprint,
         result_fingerprint, response_artifact_sha256, response_object_storage_key, response_mime_type,
         response_byte_size, started_at, completed_at, error_summary
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (ingestion_run_id, batch_number) do nothing
       returning id`,
      [
        input.runId,
        batchNumber,
        requestedIds.length,
        returnedIds.length,
        input.status,
        requestFingerprint,
        resultFingerprint,
        artifact?.sha256 ?? null,
        artifact?.objectStorageKey ?? null,
        artifact?.mimeType ?? null,
        artifact?.byteSize ?? null,
        startedAt,
        completedAt,
        error,
      ],
    );
    if (inserted.rows.length === 0) {
      const existing = await one<{
        id: string;
        request_fingerprint: string;
        result_fingerprint: string;
      }>(
        transaction,
        `select id, request_fingerprint, result_fingerprint from property_ingest.ingestion_batches
         where ingestion_run_id = $1 and batch_number = $2`,
        [input.runId, batchNumber],
        "batch replay lookup failed",
      );
      if (
        existing.request_fingerprint !== requestFingerprint ||
        existing.result_fingerprint !== resultFingerprint
      ) {
        throw new Error(
          "batchNumber already exists with different immutable request or result evidence",
        );
      }
      return { batchId: existing.id, replayed: true, requestFingerprint, resultFingerprint };
    }

    const batchId = (inserted.rows[0] as { id: string }).id;
    const members = new Map<string, { requested: boolean; returnedOccurrences: number }>();
    requestedIds.forEach((sourceObjectKey) =>
      members.set(sourceObjectKey, { requested: true, returnedOccurrences: 0 }),
    );
    returnedIds.forEach((sourceObjectKey) => {
      const member = members.get(sourceObjectKey) ?? { requested: false, returnedOccurrences: 0 };
      member.returnedOccurrences += 1;
      members.set(sourceObjectKey, member);
    });
    for (const [sourceObjectKey, member] of members) {
      await transaction.query(
        `insert into property_ingest.ingestion_batch_members (ingestion_batch_id, source_object_key, requested, returned_occurrences)
         values ($1, $2, $3, $4)`,
        [batchId, sourceObjectKey, member.requested, member.returnedOccurrences],
      );
      await transaction.query(
        `insert into property_ingest.snapshot_members (ingestion_run_id, source_object_key, expected, returned_occurrences)
         values ($1, $2, false, $3)
         on conflict (ingestion_run_id, source_object_key) do update set
           returned_occurrences = property_ingest.snapshot_members.returned_occurrences + excluded.returned_occurrences`,
        [input.runId, sourceObjectKey, member.returnedOccurrences],
      );
    }
    return { batchId, replayed: false, requestFingerprint, resultFingerprint };
  });
}

export async function recordIngestionRejection(
  database: PostgresTransactionHost,
  input: RecordIngestionRejectionInput,
): Promise<RecordedIngestionRejection> {
  assertUuid(input.runId, "runId");
  const sourceObjectKey =
    input.sourceObjectKey === null ? null : requiredText(input.sourceObjectKey, "sourceObjectKey");
  const errorCode = requiredText(input.errorCode, "errorCode");
  const errorMessage = requiredText(input.errorMessage, "errorMessage");
  const observedAt = iso(input.observedAt, "observedAt");
  const rejectionFingerprint = await stableSha256({
    sourceObjectKey,
    recordLocator: input.recordLocator,
    rawJson: input.rawJson,
    errorCode,
    errorMessage,
  });

  return database.transaction(async (transaction) => {
    const run = await one<{ completed_at: string | null }>(
      transaction,
      "select completed_at from property_ingest.ingestion_runs where id = $1 for update",
      [input.runId],
      "runId does not identify an ingestion run",
    );
    if (run.completed_at) throw new Error("a finalized ingestion run cannot accept a rejection");
    let batchId: string | null = null;
    if (input.batchNumber !== null) {
      const batch = await one<{ id: string }>(
        transaction,
        "select id from property_ingest.ingestion_batches where ingestion_run_id = $1 and batch_number = $2",
        [input.runId, integer(input.batchNumber, "batchNumber", 1)],
        "batchNumber does not belong to this ingestion run",
      );
      batchId = batch.id;
    }
    const inserted = await transaction.query<{ id: string }>(
      `insert into property_ingest.ingestion_rejections (
         ingestion_run_id, ingestion_batch_id, source_object_key, record_locator, raw_json,
         error_code, error_message, rejection_fingerprint, observed_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       on conflict (ingestion_run_id, rejection_fingerprint) do nothing
       returning id`,
      [
        input.runId,
        batchId,
        sourceObjectKey,
        input.recordLocator,
        json(input.rawJson),
        errorCode,
        errorMessage,
        rejectionFingerprint,
        observedAt,
      ],
    );
    if (inserted.rows.length === 1)
      return {
        rejectionId: (inserted.rows[0] as { id: string }).id,
        replayed: false,
        rejectionFingerprint,
      };
    const existing = await one<{ id: string }>(
      transaction,
      "select id from property_ingest.ingestion_rejections where ingestion_run_id = $1 and rejection_fingerprint = $2",
      [input.runId, rejectionFingerprint],
      "rejection replay lookup failed",
    );
    return { rejectionId: existing.id, replayed: true, rejectionFingerprint };
  });
}

async function loadCoverageEvidence(
  transaction: PostgresTransaction,
  runId: string,
  run: { source_reported_count: unknown; service_maximum: unknown },
) {
  const expected = await transaction.query<{ source_object_key: string }>(
    "select source_object_key from property_ingest.snapshot_members where ingestion_run_id = $1 and expected order by source_object_key",
    [runId],
  );
  const batches = await transaction.query<{
    id: string;
    batch_number: number;
    status: SnapshotBatchResult["status"];
    error_summary: string | null;
  }>(
    "select id, batch_number, status, error_summary from property_ingest.ingestion_batches where ingestion_run_id = $1 order by batch_number",
    [runId],
  );
  const members = await transaction.query<{
    ingestion_batch_id: string;
    source_object_key: string;
    requested: boolean;
    returned_occurrences: number;
  }>(
    `select member.ingestion_batch_id, member.source_object_key, member.requested, member.returned_occurrences
     from property_ingest.ingestion_batch_members member
     join property_ingest.ingestion_batches batch on batch.id = member.ingestion_batch_id
     where batch.ingestion_run_id = $1
     order by batch.batch_number, member.source_object_key`,
    [runId],
  );
  const membersByBatch = new Map<string, typeof members.rows>();
  members.rows.forEach((member) => {
    const group = membersByBatch.get(member.ingestion_batch_id) ?? [];
    group.push(member);
    membersByBatch.set(member.ingestion_batch_id, group);
  });
  const batchResults: SnapshotBatchResult[] = batches.rows.map((batch) => {
    const batchMembers = membersByBatch.get(batch.id) ?? [];
    const returnedIds = batchMembers.flatMap((member) =>
      Array.from({ length: Number(member.returned_occurrences) }, () => member.source_object_key),
    );
    return {
      batchNumber: Number(batch.batch_number),
      requestedIds: batchMembers
        .filter((member) => member.requested)
        .map((member) => member.source_object_key),
      returnedIds,
      status: batch.status,
      error: batch.error_summary,
    };
  });
  return evaluateSnapshotCoverage({
    expectedIds: expected.rows.map((row) => row.source_object_key),
    reportedCount: Number(run.source_reported_count),
    serviceMaximum: Number(run.service_maximum),
    batches: batchResults,
  });
}

// "Withdraw only on complete absence": a source_record_state is only marked
// withdrawn when (a) this run's coverage is `complete` (every expected
// source object was requested exactly once and returned exactly once, with
// no failed/partial batches -- see nationwide-ingestion-orchestrator.ts's
// `evaluateSnapshotCoverage`), (b) the source is registered `complete_snapshot`
// not `append_only`, (c) nothing in this run was rejected or only partially
// parsed, AND (d) the record's source_record_key was not among the keys this
// complete run actually saw. A partial/failed run, an append-only source, or
// any rejection/partial-parse in the run leaves every prior record alone.
export async function finalizeSnapshotIngestionRun(
  database: PostgresTransactionHost,
  input: { runId: string; completedAt: string },
): Promise<FinalizedSnapshotRun> {
  assertUuid(input.runId, "runId");
  const completedAt = iso(input.completedAt, "completedAt");
  return database.transaction(async (transaction) => {
    const run = await one<{
      id: string;
      source_definition_id: string;
      source_reported_count: number;
      service_maximum: number;
      withdrawal_mode: SnapshotWithdrawalMode;
      completed_at: string | null;
      withdrawals_allowed: boolean;
    }>(
      transaction,
      `select id, source_definition_id, source_reported_count, service_maximum, withdrawal_mode, completed_at, withdrawals_allowed
       from property_ingest.ingestion_runs where id = $1 for update`,
      [input.runId],
      "runId does not identify an ingestion run",
    );
    const coverage = await loadCoverageEvidence(transaction, input.runId, run);
    const metrics = await one<{
      accepted: number;
      unchanged: number;
      partial_parses: number;
      unresolved: number;
      linked: number;
      rejected: number;
    }>(
      transaction,
      `select
         (select count(*) from property_ingest.source_record_occurrences where ingestion_run_id = $1)::int as accepted,
         (select count(*) from property_ingest.source_record_occurrences where ingestion_run_id = $1 and not created_new_version)::int as unchanged,
         (select count(*) from property_ingest.source_record_occurrences where ingestion_run_id = $1 and parsing_status = 'partial')::int as partial_parses,
         (select count(*) from property_ingest.source_record_occurrences where ingestion_run_id = $1 and resolution_status <> 'resolved')::int as unresolved,
         (select count(*) from property_ingest.source_record_occurrences where ingestion_run_id = $1 and resolution_status = 'resolved')::int as linked,
         (select count(*) from property_ingest.ingestion_rejections where ingestion_run_id = $1)::int as rejected`,
      [input.runId],
      "run metrics query failed",
    );
    const rowsSeen = coverage.returnedUniqueCount;
    const rowsAccepted = numberValue(metrics.accepted);
    const rowsUnchanged = numberValue(metrics.unchanged);
    const rowsRejected = numberValue(metrics.rejected);
    const rowsUnresolved = numberValue(metrics.unresolved);
    const rowsLinked = numberValue(metrics.linked);
    const partialParses = numberValue(metrics.partial_parses);
    if (rowsAccepted + rowsRejected > rowsSeen) {
      throw new Error(
        "accepted and rejected record counts exceed the unique returned source-object count",
      );
    }
    const withdrawalsAllowed =
      coverage.canPublishWithdrawals &&
      run.withdrawal_mode === "complete_snapshot" &&
      rowsRejected === 0 &&
      partialParses === 0;
    const warnings = [...coverage.warnings];
    if (coverage.canPublishWithdrawals && run.withdrawal_mode === "append_only") {
      warnings.push("Withdrawals are disabled because this source is registered as append-only.");
    }
    if (coverage.canPublishWithdrawals && rowsRejected > 0) {
      warnings.push(
        "Withdrawals are suppressed because at least one returned record was rejected.",
      );
    }
    if (coverage.canPublishWithdrawals && partialParses > 0) {
      warnings.push(
        "Withdrawals are suppressed because at least one returned record was only partially parsed.",
      );
    }
    const parsingStatus = rowsRejected > 0 || partialParses > 0 ? "partial" : "succeeded";
    const normalizationStatus = rowsRejected > 0 ? "partial" : "succeeded";
    const resolutionStatus =
      rowsAccepted === 0 ? "skipped" : rowsUnresolved > 0 ? "partial" : "succeeded";
    const retrievalStatus = coverage.status === "complete" ? "succeeded" : coverage.status;
    const failedBatchErrors = await transaction.query<{ error_summary: string }>(
      "select distinct error_summary from property_ingest.ingestion_batches where ingestion_run_id = $1 and error_summary is not null order by error_summary",
      [input.runId],
    );
    const errorSummary =
      failedBatchErrors.rows
        .map((row) => row.error_summary)
        .join(" | ")
        .slice(0, 1_000) || null;

    const withdrawnRecordKeys: string[] = [];
    if (run.completed_at) {
      const priorWithdrawals = await transaction.query<{ source_record_key: string }>(
        "select source_record_key from property_ingest.source_record_states where withdrawal_run_id = $1 order by source_record_key",
        [input.runId],
      );
      withdrawnRecordKeys.push(...priorWithdrawals.rows.map((row) => row.source_record_key));
    } else if (withdrawalsAllowed) {
      const currentKeys = await transaction.query<{ source_record_key: string }>(
        `select distinct record.source_record_key
         from property_ingest.source_record_occurrences occurrence
         join property_ingest.source_records record on record.id = occurrence.source_record_id
         where occurrence.ingestion_run_id = $1`,
        [input.runId],
      );
      const current = new Set(currentKeys.rows.map((row) => row.source_record_key));
      const activeStates = await transaction.query<{
        id: string;
        source_record_key: string;
        current_source_record_id: string;
      }>(
        "select id, source_record_key, current_source_record_id from property_ingest.source_record_states where source_definition_id = $1 and withdrawn_at is null for update",
        [run.source_definition_id],
      );
      for (const state of activeStates.rows) {
        if (current.has(state.source_record_key)) continue;
        await transaction.query(
          "update property_ingest.source_record_states set withdrawn_at = $1, withdrawal_run_id = $2, updated_at = now() where id = $3 and withdrawn_at is null",
          [completedAt, input.runId, state.id],
        );
        withdrawnRecordKeys.push(state.source_record_key);
        const propertyRecords = await transaction.query<{ property_id: string | null }>(
          "select property_id from property_api.property_record_search where source_definition_id = $1 and source_record_key = $2",
          [run.source_definition_id, state.source_record_key],
        );
        await transaction.query(
          "update property_api.property_record_search set lifecycle_state = 'withdrawn', withdrawn_at = $3, updated_at = now() where source_definition_id = $1 and source_record_key = $2",
          [run.source_definition_id, state.source_record_key, completedAt],
        );
        for (const propertyRecord of propertyRecords.rows) {
          if (propertyRecord.property_id)
            await refreshCanonicalPropertySearch(transaction, propertyRecord.property_id);
        }
        const lots = await transaction.query<{ id: string }>(
          "select id from property_core.auction_lots where source_record_id = $1",
          [state.current_source_record_id],
        );
        for (const lot of lots.rows) {
          const eventFingerprint = await stableSha256({
            eventType: "removed",
            withdrawalRunId: input.runId,
            sourceRecordStateId: state.id,
            auctionLotId: lot.id,
          });
          await transaction.query(
            `insert into property_core.auction_lifecycle_events (
               auction_lot_id, source_record_id, event_type, effective_at, observed_at, published_status_text, event_fingerprint
             ) values ($1, $2, 'removed', $3, $3, $4, $5)
             on conflict (auction_lot_id, event_fingerprint) do nothing`,
            [
              lot.id,
              state.current_source_record_id,
              completedAt,
              "Absent from a complete source snapshot",
              eventFingerprint,
            ],
          );
          await transaction.query(
            "update property_core.auction_lots set lifecycle_state = 'removed', updated_at = now() where id = $1",
            [lot.id],
          );
          await transaction.query(
            "update property_api.auction_lot_search set lifecycle_state = 'removed', updated_at = now() where auction_lot_id = $1",
            [lot.id],
          );
          const linkedProperties = await transaction.query<{ property_id: string }>(
            "select property_id from property_core.auction_lot_properties where auction_lot_id = $1 and active order by property_id",
            [lot.id],
          );
          for (const linkedProperty of linkedProperties.rows)
            await refreshCanonicalPropertySearch(transaction, linkedProperty.property_id);
        }
      }
      withdrawnRecordKeys.sort((left, right) => left.localeCompare(right));
    }

    if (!run.completed_at) {
      await one(
        transaction,
        `update property_ingest.ingestion_runs set
           completed_at = $2, retrieval_status = $3, parsing_status = $4, normalization_status = $5,
           resolution_status = $6, rows_seen = $7, rows_accepted = $8, rows_unchanged = $9,
           rows_rejected = $10, rows_unresolved = $11, rows_linked = $12, returned_unique_count = $13,
           coverage_status = $14, withdrawals_allowed = $15, warnings = $16::jsonb, error_summary = $17,
           lease_owner = null, lease_acquired_at = null, lease_expires_at = null
         where id = $1
         returning id`,
        [
          input.runId,
          completedAt,
          retrievalStatus,
          parsingStatus,
          normalizationStatus,
          resolutionStatus,
          rowsSeen,
          rowsAccepted,
          rowsUnchanged,
          rowsRejected,
          rowsUnresolved,
          rowsLinked,
          coverage.returnedUniqueCount,
          coverage.status,
          withdrawalsAllowed,
          json(warnings),
          errorSummary,
        ],
        "run finalization update failed",
      );
    }

    return {
      runId: input.runId,
      replayed: Boolean(run.completed_at),
      coverage,
      rowsSeen,
      rowsAccepted,
      rowsUnchanged,
      rowsRejected,
      rowsUnresolved,
      rowsLinked,
      withdrawalsAllowed: run.completed_at ? run.withdrawals_allowed : withdrawalsAllowed,
      withdrawnRecordKeys,
    };
  });
}

export type SnapshotIngestionRunState = {
  runId: string;
  completedAt: string | null;
  coverageStatus: "pending" | "complete" | "partial" | "failed" | "not_applicable";
};

export type SnapshotIngestionRunLease = {
  runId: string;
  leaseOwner: string;
  leaseAcquiredAt: string;
  leaseExpiresAt: string;
};

/**
 * Ported from property-intelligence-app's app/lib/nationwide-postgres-run-store.ts.
 */
export async function getSnapshotIngestionRunState(
  database: PostgresTransactionHost,
  runId: string,
): Promise<SnapshotIngestionRunState> {
  assertUuid(runId, "runId");
  return database.transaction(async (transaction) => {
    const row = await one<{
      id: string;
      completed_at: string | null;
      coverage_status: SnapshotIngestionRunState["coverageStatus"];
    }>(
      transaction,
      `
      select id, completed_at, coverage_status
      from property_ingest.ingestion_runs
      where id = $1
    `,
      [runId],
      "runId does not identify an ingestion run",
    );
    return {
      runId: row.id,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      coverageStatus: row.coverage_status,
    };
  });
}

/**
 * Claims the worker lease on an in-flight ingestion run.
 *
 * The UPDATE is the concurrency control: it only matches a run that is not
 * finalized AND is either unleased, already held by this same owner (so a
 * retry is idempotent), or whose lease has expired. Two workers racing the
 * same run therefore cannot both win -- the loser matches zero rows and is
 * told who holds the lease and until when, rather than proceeding in parallel
 * and double-writing the run's batches.
 */
export async function claimSnapshotIngestionRunLease(
  database: PostgresTransactionHost,
  input: {
    runId: string;
    leaseOwner: string;
    acquiredAt: string;
    expiresAt: string;
  },
): Promise<SnapshotIngestionRunLease> {
  assertUuid(input.runId, "runId");
  const leaseOwner = requiredText(input.leaseOwner, "leaseOwner");
  const acquiredAt = iso(input.acquiredAt, "acquiredAt");
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (expiresAt <= acquiredAt) throw new Error("expiresAt must follow acquiredAt");
  return database.transaction(async (transaction) => {
    const claimed = await transaction.query<{
      id: string;
      lease_owner: string;
      lease_acquired_at: string;
      lease_expires_at: string;
    }>(
      `
      update property_ingest.ingestion_runs
      set lease_owner = $2,
          lease_acquired_at = $3,
          lease_expires_at = $4
      where id = $1
        and completed_at is null
        and (
          lease_owner is null
          or lease_owner = $2
          or lease_expires_at <= $3
        )
      returning id, lease_owner, lease_acquired_at, lease_expires_at
    `,
      [input.runId, leaseOwner, acquiredAt, expiresAt],
    );
    const row = claimed.rows[0];
    if (claimed.rows.length !== 1 || row === undefined) {
      const state = await one<{
        completed_at: string | null;
        lease_owner: string | null;
        lease_expires_at: string | null;
      }>(
        transaction,
        `
        select completed_at, lease_owner, lease_expires_at
        from property_ingest.ingestion_runs
        where id = $1
      `,
        [input.runId],
        "runId does not identify an ingestion run",
      );
      if (state.completed_at) throw new Error("a finalized ingestion run cannot be leased");
      throw new Error(
        `ingestion run is leased by ${state.lease_owner ?? "another worker"} until ${state.lease_expires_at ?? "an unknown time"}`,
      );
    }
    return {
      runId: row.id,
      leaseOwner: row.lease_owner,
      leaseAcquiredAt: new Date(row.lease_acquired_at).toISOString(),
      leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
    };
  });
}
