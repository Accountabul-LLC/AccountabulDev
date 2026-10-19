// Slice 4 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-postgres-dispatch-store.ts:
// DB-backed dispatch scheduling and worker leasing against Slice 2's
// `property_ingest.ingestion_dispatches` and its
// `enqueue_due_ingestion_dispatches` SQL function -- idempotent enqueue
// (that function's own `on conflict ... do nothing`), atomic
// claim-one-with-`skip locked`, bounded lease renewal, and
// complete/fail/retry transitions. Nothing here schedules
// `enqueue_due_ingestion_dispatches` itself (no pg_cron wiring, matching
// Slice 2's migration header) -- these are ordinary functions a caller must
// invoke with an injected `PostgresTransactionHost`.
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";

export type NationwideDispatchStatus = "queued" | "claimed" | "succeeded" | "failed" | "cancelled";

export type NationwideIngestionDispatch = {
  dispatchId: string;
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  scheduledFor: string;
  attempt: number;
  status: NationwideDispatchStatus;
  availableAt: string;
  enqueuedAt: string;
  claimCount: number;
  leaseOwner: string | null;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  ingestionRunId: string | null;
  retryOfDispatchId: string | null;
  errorSummary: string | null;
};

export type NationwideAllowedSourceContract = { sourceKey: string; contractVersion: number };

type DispatchRow = {
  dispatch_id: string;
  source_definition_id: string;
  source_key: string;
  contract_version: number;
  scheduled_for: string;
  attempt: number;
  status: NationwideDispatchStatus;
  available_at: string;
  enqueued_at: string;
  claim_count: number;
  lease_owner: string | null;
  lease_acquired_at: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  ingestion_run_id: string | null;
  retry_of_dispatch_id: string | null;
  error_summary: string | null;
};

const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

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

function canonicalUtc(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function numberValue(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0)
    throw new Error(`database returned an invalid ${field}`);
  return number;
}

function optionalUtc(value: string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function dispatchFromRow(row: DispatchRow): NationwideIngestionDispatch {
  return {
    dispatchId: row.dispatch_id,
    sourceDefinitionId: row.source_definition_id,
    sourceKey: row.source_key,
    contractVersion: numberValue(row.contract_version, "contract version"),
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    attempt: numberValue(row.attempt, "attempt"),
    status: row.status,
    availableAt: new Date(row.available_at).toISOString(),
    enqueuedAt: new Date(row.enqueued_at).toISOString(),
    claimCount: numberValue(row.claim_count, "claim count"),
    leaseOwner: row.lease_owner,
    leaseAcquiredAt: optionalUtc(row.lease_acquired_at),
    leaseExpiresAt: optionalUtc(row.lease_expires_at),
    completedAt: optionalUtc(row.completed_at),
    ingestionRunId: row.ingestion_run_id,
    retryOfDispatchId: row.retry_of_dispatch_id,
    errorSummary: row.error_summary,
  };
}

const DISPATCH_COLUMNS = `
  dispatch.id as dispatch_id,
  dispatch.source_definition_id,
  source.source_key,
  source.contract_version,
  dispatch.scheduled_for,
  dispatch.attempt,
  dispatch.status,
  dispatch.available_at,
  dispatch.enqueued_at,
  dispatch.claim_count,
  dispatch.lease_owner,
  dispatch.lease_acquired_at,
  dispatch.lease_expires_at,
  dispatch.completed_at,
  dispatch.ingestion_run_id,
  dispatch.retry_of_dispatch_id,
  dispatch.error_summary
`;

async function exactlyOne(
  transaction: PostgresTransaction,
  sql: string,
  params: unknown[],
  failure: string,
) {
  const result = await transaction.query<DispatchRow>(sql, params);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) throw new Error(failure);
  return dispatchFromRow(row);
}

// Idempotent enqueue: delegates entirely to Slice 2's
// `property_ingest.enqueue_due_ingestion_dispatches`, whose own
// `on conflict (source_definition_id, scheduled_for, attempt) do nothing`
// makes calling this twice for the same `now` a no-op the second time.
// Bounded catch-up: that function's own `catch_up_limit` clamp (from each
// source's `schedule_policy`) caps how many overdue slots one call enqueues.
export async function enqueueDueNationwideDispatches(
  database: PostgresTransactionHost,
  now: string,
) {
  const scheduledAt = canonicalUtc(now, "now");
  return database.transaction(async (transaction) => {
    const result = await transaction.query<{
      dispatch_id: string;
      source_definition_id: string;
      source_key: string;
      scheduled_for: string;
      attempt: number;
    }>(
      "select dispatch_id, source_definition_id, source_key, scheduled_for, attempt from property_ingest.enqueue_due_ingestion_dispatches($1)",
      [scheduledAt],
    );
    return result.rows.map((row) => ({
      dispatchId: row.dispatch_id,
      sourceDefinitionId: row.source_definition_id,
      sourceKey: row.source_key,
      scheduledFor: new Date(row.scheduled_for).toISOString(),
      attempt: numberValue(row.attempt, "attempt"),
    }));
  });
}

export async function claimNextNationwideDispatch(
  database: PostgresTransactionHost,
  input: {
    workerId: string;
    acquiredAt: string;
    leaseSeconds: number;
    allowedSourceKeys?: string[];
    allowedSourceContracts?: NationwideAllowedSourceContract[];
  },
): Promise<NationwideIngestionDispatch | null> {
  const workerId = requiredText(input.workerId, "workerId");
  const acquiredAt = canonicalUtc(input.acquiredAt, "acquiredAt");
  const leaseSeconds = positiveInteger(input.leaseSeconds, "leaseSeconds");
  if (leaseSeconds < 60 || leaseSeconds > 3_600)
    throw new Error("leaseSeconds must be between 60 and 3600 seconds");
  if (input.allowedSourceKeys !== undefined && input.allowedSourceContracts !== undefined) {
    throw new Error(
      "claim scope must use allowedSourceContracts or legacy allowedSourceKeys, not both",
    );
  }
  const sourceKeys = input.allowedSourceKeys
    ? [
        ...new Set(
          input.allowedSourceKeys.map((value) => requiredText(value, "allowedSourceKeys")),
        ),
      ].sort()
    : null;
  if (sourceKeys?.some((value) => !SOURCE_KEY_PATTERN.test(value)))
    throw new Error("allowedSourceKeys must contain valid source keys");
  if (sourceKeys?.length === 0) return null;
  const sourceContracts = input.allowedSourceContracts
    ? [
        ...new Map(
          input.allowedSourceContracts.map((contract) => {
            const sourceKey = requiredText(contract.sourceKey, "allowedSourceContracts.sourceKey");
            if (!SOURCE_KEY_PATTERN.test(sourceKey))
              throw new Error("allowedSourceContracts must contain valid source keys");
            const contractVersion = positiveInteger(
              contract.contractVersion,
              "allowedSourceContracts.contractVersion",
            );
            return [`${sourceKey}:c${contractVersion}`, { sourceKey, contractVersion }];
          }),
        ).values(),
      ].sort(
        (left, right) =>
          left.sourceKey.localeCompare(right.sourceKey) ||
          left.contractVersion - right.contractVersion,
      )
    : null;
  if (sourceContracts?.length === 0) return null;
  const contractSourceKeys = sourceContracts?.map((contract) => contract.sourceKey) ?? null;
  const contractVersions = sourceContracts?.map((contract) => contract.contractVersion) ?? null;
  const expiresAt = new Date(new Date(acquiredAt).valueOf() + leaseSeconds * 1_000).toISOString();

  return database.transaction(async (transaction) => {
    const result = await transaction.query<DispatchRow>(
      `with candidate as (
         select dispatch.id
         from property_ingest.ingestion_dispatches dispatch
         join property_ingest.source_definitions source on source.id = dispatch.source_definition_id
         where (
             (dispatch.status = 'queued' and dispatch.available_at <= $2)
             or (dispatch.status = 'claimed' and dispatch.lease_expires_at <= $2)
           )
           and ($4::text[] is null or source.source_key = any($4::text[]))
           and (
             $5::text[] is null
             or exists (
               select 1 from unnest($5::text[], $6::integer[]) as allowed(source_key, contract_version)
               where allowed.source_key = source.source_key and allowed.contract_version = source.contract_version
             )
           )
         order by dispatch.scheduled_for, dispatch.attempt, dispatch.enqueued_at, dispatch.id
         limit 1
         for update of dispatch skip locked
       )
       update property_ingest.ingestion_dispatches dispatch
       set status = 'claimed', claim_count = dispatch.claim_count + 1, lease_owner = $1,
           lease_acquired_at = $2, lease_expires_at = $3, updated_at = $2
       from candidate, property_ingest.source_definitions source
       where dispatch.id = candidate.id and source.id = dispatch.source_definition_id
       returning ${DISPATCH_COLUMNS}`,
      [workerId, acquiredAt, expiresAt, sourceKeys, contractSourceKeys, contractVersions],
    );
    const row = result.rows[0];
    return row === undefined ? null : dispatchFromRow(row);
  });
}

export async function renewNationwideDispatchLease(
  database: PostgresTransactionHost,
  input: { dispatchId: string; workerId: string; renewedAt: string; leaseSeconds: number },
) {
  assertUuid(input.dispatchId, "dispatchId");
  const workerId = requiredText(input.workerId, "workerId");
  const renewedAt = canonicalUtc(input.renewedAt, "renewedAt");
  const leaseSeconds = positiveInteger(input.leaseSeconds, "leaseSeconds");
  if (leaseSeconds < 60 || leaseSeconds > 3_600)
    throw new Error("leaseSeconds must be between 60 and 3600 seconds");
  const expiresAt = new Date(new Date(renewedAt).valueOf() + leaseSeconds * 1_000).toISOString();
  return database.transaction((transaction) =>
    exactlyOne(
      transaction,
      `update property_ingest.ingestion_dispatches dispatch
       set lease_acquired_at = $3, lease_expires_at = $4, updated_at = $3
       from property_ingest.source_definitions source
       where dispatch.id = $1 and dispatch.status = 'claimed' and dispatch.lease_owner = $2
         and dispatch.lease_expires_at > $3 and source.id = dispatch.source_definition_id
       returning ${DISPATCH_COLUMNS}`,
      [input.dispatchId, workerId, renewedAt, expiresAt],
      "dispatch lease is missing, expired, or owned by another worker",
    ),
  );
}

export async function completeNationwideDispatch(
  database: PostgresTransactionHost,
  input: { dispatchId: string; workerId: string; ingestionRunId: string; completedAt: string },
) {
  assertUuid(input.dispatchId, "dispatchId");
  assertUuid(input.ingestionRunId, "ingestionRunId");
  const workerId = requiredText(input.workerId, "workerId");
  const completedAt = canonicalUtc(input.completedAt, "completedAt");
  return database.transaction((transaction) =>
    exactlyOne(
      transaction,
      `update property_ingest.ingestion_dispatches dispatch
       set status = 'succeeded', completed_at = $3, ingestion_run_id = $4,
           lease_owner = null, lease_acquired_at = null, lease_expires_at = null, updated_at = $3
       from property_ingest.source_definitions source
       where dispatch.id = $1 and dispatch.status = 'claimed' and dispatch.lease_owner = $2
         and source.id = dispatch.source_definition_id
       returning ${DISPATCH_COLUMNS}`,
      [input.dispatchId, workerId, completedAt, input.ingestionRunId],
      "dispatch is missing, not claimed, or owned by another worker",
    ),
  );
}

export async function failNationwideDispatch(
  database: PostgresTransactionHost,
  input: { dispatchId: string; workerId: string; completedAt: string; errorSummary: string },
) {
  assertUuid(input.dispatchId, "dispatchId");
  const workerId = requiredText(input.workerId, "workerId");
  const completedAt = canonicalUtc(input.completedAt, "completedAt");
  const errorSummary = requiredText(input.errorSummary, "errorSummary").slice(0, 1_000);
  return database.transaction((transaction) =>
    exactlyOne(
      transaction,
      `update property_ingest.ingestion_dispatches dispatch
       set status = 'failed', completed_at = $3, error_summary = $4,
           lease_owner = null, lease_acquired_at = null, lease_expires_at = null, updated_at = $3
       from property_ingest.source_definitions source
       where dispatch.id = $1 and dispatch.status = 'claimed' and dispatch.lease_owner = $2
         and source.id = dispatch.source_definition_id
       returning ${DISPATCH_COLUMNS}`,
      [input.dispatchId, workerId, completedAt, errorSummary],
      "dispatch is missing, not claimed, or owned by another worker",
    ),
  );
}

// Bounded retry: attempt increases by exactly one, chained to the failed
// dispatch it replays (`retry_of_dispatch_id`), and the (source_definition_id,
// scheduled_for, attempt) unique constraint from Slice 2's migration makes
// retrying the same failed dispatch twice fail the second insert rather than
// silently creating a duplicate retry.
export async function retryFailedNationwideDispatch(
  database: PostgresTransactionHost,
  input: { dispatchId: string; availableAt: string; enqueuedAt: string },
) {
  assertUuid(input.dispatchId, "dispatchId");
  const availableAt = canonicalUtc(input.availableAt, "availableAt");
  const enqueuedAt = canonicalUtc(input.enqueuedAt, "enqueuedAt");
  if (availableAt < enqueuedAt) throw new Error("availableAt cannot precede enqueuedAt");
  return database.transaction(async (transaction) => {
    const failed = await exactlyOne(
      transaction,
      `select ${DISPATCH_COLUMNS} from property_ingest.ingestion_dispatches dispatch
       join property_ingest.source_definitions source on source.id = dispatch.source_definition_id
       where dispatch.id = $1 and dispatch.status = 'failed'`,
      [input.dispatchId],
      "dispatchId does not identify a failed dispatch",
    );
    return exactlyOne(
      transaction,
      `insert into property_ingest.ingestion_dispatches (
         source_definition_id, scheduled_for, attempt, status, available_at, enqueued_at, retry_of_dispatch_id
       ) values ($1, $2, $3, 'queued', $4, $5, $6)
       returning id as dispatch_id, source_definition_id, $7::text as source_key, $8::integer as contract_version,
                 scheduled_for, attempt, status, available_at, enqueued_at, claim_count, lease_owner,
                 lease_acquired_at, lease_expires_at, completed_at, ingestion_run_id, retry_of_dispatch_id, error_summary`,
      [
        failed.sourceDefinitionId,
        failed.scheduledFor,
        failed.attempt + 1,
        availableAt,
        enqueuedAt,
        failed.dispatchId,
        failed.sourceKey,
        failed.contractVersion,
      ],
      "retry dispatch insert failed",
    );
  });
}
