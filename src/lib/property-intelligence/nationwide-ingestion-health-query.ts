// The database-reading half of nationwide ingestion health, ported from the
// source app's `queryNationwideIngestionHealth` /
// `getNationwideIngestionHealth` (app/lib/nationwide-ingestion-health.ts).
//
// nationwide-ingestion-health.ts already carries the other half, but it was
// unreachable: `deriveNationwideSourceHealth` is pure and fully tested, and
// nothing in this repository ever fed it, so health monitoring existed as a
// function nobody could call. This module is what calls it.
//
// The split is deliberate and is the one structural difference from the
// source. There, `sourceHealth` reads a row AND decides every alert in the
// same function, so the alert rules can only be tested through a database.
// Here the reader's whole job is to turn a row into a
// `NationwideSourceHealthInput` -- the per-run "failed"/"partial" predicates
// included, since those are row-shape questions -- and the rules stay in the
// pure function that already owns them. Nothing about the alert thresholds
// is restated here; restating them is how two copies drift.
//
// The query is the source's, unchanged in substance:
//
//   * `latest_run` is the most recent attempt, whatever its outcome, and
//     `latest_success` is the most recent OPERATIONALLY valid run -- the one
//     whose every phase succeeded (or partially succeeded where that is
//     allowed), whose coverage is complete or not applicable, and which
//     recorded no error. Freshness is measured against that second one, so a
//     source that keeps failing does not look fresh merely because it keeps
//     running.
//   * dispatch counters use `distinct on (scheduled_for) ... order by attempt
//     desc`, so a slot that was retried counts once, by its latest attempt,
//     rather than counting every attempt as its own backlog item.
//   * `$1::boolean or (...)` is the includeInactive switch: by default only
//     active interval sources are returned, because a manual or disabled
//     source is never overdue and would otherwise be permanent noise.
//
// This module performs no I/O of its own: the caller supplies the
// `PostgresTransactionHost`, exactly as nationwide-geography-catalog.ts does.
import {
  deriveNationwideSourceHealth,
  type NationwideSourceHealthInput,
  type NationwideSourceIngestionHealth,
} from "./nationwide-ingestion-health.ts";
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import { UUID_V1_TO_V5 as UUID_PATTERN } from "../validation/patterns.ts";

export type GetNationwideIngestionHealthInput = {
  asOf: string;
  includeInactive?: boolean;
  overdueAfterIntervals?: number;
  staleOpenRunMinutes?: number;
};

export type NationwideIngestionHealthSnapshot = {
  asOf: string;
  sourceCount: number;
  activeSourceCount: number;
  healthySourceCount: number;
  attentionSourceCount: number;
  criticalSourceCount: number;
  inactiveSourceCount: number;
  sources: NationwideSourceIngestionHealth[];
};

type HealthRow = {
  source_definition_id: string;
  source_key: string;
  contract_version: number | string;
  active: boolean;
  state_code: string | null;
  county_fips: string | null;
  schedule_policy: unknown;
  latest_run_id: string | null;
  latest_run_scheduled_for: string | Date | null;
  latest_run_withdrawal_mode: "append_only" | "complete_snapshot" | null;
  latest_run_discovery_status: string | null;
  latest_run_retrieval_status: string | null;
  latest_run_parsing_status: string | null;
  latest_run_normalization_status: string | null;
  latest_run_resolution_status: string | null;
  latest_run_coverage_status: string | null;
  latest_run_withdrawals_allowed: boolean | null;
  latest_run_rows_rejected: number | string | null;
  latest_run_warning_count: number | string | null;
  latest_run_has_error: boolean | null;
  latest_success_scheduled_for: string | Date | null;
  queued_dispatches: number | string | null;
  failed_dispatches: number | string | null;
  expired_dispatch_leases: number | string | null;
  oldest_queued_at: string | Date | null;
  expired_run_leases: number | string | null;
  stale_open_runs: number | string | null;
};

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function count(value: number | string | null | undefined, field: string) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`database returned an invalid ${field}`);
  }
  return parsed;
}

function positiveCount(value: number | string, field: string) {
  const parsed = count(value, field);
  if (parsed < 1) throw new Error(`database returned an invalid ${field}`);
  return parsed;
}

function iso(value: string | Date | null) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error("database returned an invalid timestamp");
  }
  return parsed.toISOString();
}

function schedule(value: unknown): NationwideSourceHealthInput["schedulePolicy"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("database returned an invalid source schedule policy");
  }
  const policy = value as Record<string, unknown>;
  if (policy["mode"] === "manual" && Object.keys(policy).length === 1) return { mode: "manual" };
  if (policy["mode"] !== "interval") {
    throw new Error("database returned an unsupported source schedule policy");
  }
  const anchorUtc = canonicalUtc(String(policy["anchorUtc"]), "schedulePolicy.anchorUtc");
  const intervalMinutes = count(policy["intervalMinutes"] as number | string, "schedule interval");
  const catchUpLimit = count(policy["catchUpLimit"] as number | string, "schedule catch-up limit");
  if (intervalMinutes < 15 || intervalMinutes > 525_600 || catchUpLimit < 1 || catchUpLimit > 100) {
    throw new Error("database returned an out-of-range source schedule policy");
  }
  return { mode: "interval", anchorUtc, intervalMinutes, catchUpLimit };
}

// A run has failed if ANY phase failed or it recorded an error summary. A
// phase that merely reports "partial" is not a failure -- it is the partial
// signal below.
function latestRunFailed(row: HealthRow) {
  return (
    row.latest_run_id !== null &&
    (row.latest_run_discovery_status === "failed" ||
      row.latest_run_retrieval_status === "failed" ||
      row.latest_run_parsing_status === "failed" ||
      row.latest_run_normalization_status === "failed" ||
      row.latest_run_resolution_status === "failed" ||
      row.latest_run_coverage_status === "failed" ||
      row.latest_run_has_error === true)
  );
}

// Warnings count as partial: a run that completed every phase but recorded
// warnings did not cleanly process the source form.
function latestRunPartial(row: HealthRow) {
  return (
    row.latest_run_id !== null &&
    (row.latest_run_retrieval_status === "partial" ||
      row.latest_run_parsing_status === "partial" ||
      row.latest_run_normalization_status === "partial" ||
      row.latest_run_coverage_status === "partial" ||
      count(row.latest_run_warning_count, "latest run warning count") > 0)
  );
}

function coverageStatus(
  value: string | null,
): NationwideSourceHealthInput["latestRunCoverageStatus"] {
  if (value === null) return null;
  if (
    value === "pending" ||
    value === "complete" ||
    value === "partial" ||
    value === "failed" ||
    value === "not_applicable"
  ) {
    return value;
  }
  throw new Error("database returned an unsupported run coverage status");
}

export function healthInputFromRow(row: HealthRow): NationwideSourceHealthInput {
  if (!UUID_PATTERN.test(row.source_definition_id)) {
    throw new Error("database returned an invalid source definition ID");
  }
  return {
    sourceDefinitionId: row.source_definition_id,
    sourceKey: row.source_key,
    contractVersion: positiveCount(row.contract_version, "contract version"),
    active: row.active,
    stateCode: row.state_code,
    countyFips: row.county_fips,
    schedulePolicy: schedule(row.schedule_policy),
    latestSuccessfulScheduledFor: iso(row.latest_success_scheduled_for),
    latestRunScheduledFor: iso(row.latest_run_scheduled_for),
    latestRunFailed: latestRunFailed(row),
    latestRunPartial: latestRunPartial(row),
    rowsRejected: count(row.latest_run_rows_rejected, "latest run rows rejected"),
    latestRunWithdrawalMode: row.latest_run_withdrawal_mode,
    latestRunCoverageStatus: coverageStatus(row.latest_run_coverage_status),
    latestRunWithdrawalsAllowed: row.latest_run_withdrawals_allowed,
    queuedDispatches: count(row.queued_dispatches, "queued dispatch count"),
    oldestQueuedAt: iso(row.oldest_queued_at),
    failedDispatches: count(row.failed_dispatches, "failed dispatch count"),
    expiredDispatchLeases: count(row.expired_dispatch_leases, "expired dispatch lease count"),
    expiredRunLeases: count(row.expired_run_leases, "expired run lease count"),
    staleOpenRuns: count(row.stale_open_runs, "stale open run count"),
  };
}

const HEALTH_SQL = `
    select
      source.id::text as source_definition_id,
      source.source_key,
      source.contract_version,
      source.active,
      jurisdiction.state_code,
      jurisdiction.county_fips,
      source.schedule_policy,
      latest_run.id::text as latest_run_id,
      latest_run.scheduled_for as latest_run_scheduled_for,
      latest_run.withdrawal_mode as latest_run_withdrawal_mode,
      latest_run.discovery_status as latest_run_discovery_status,
      latest_run.retrieval_status as latest_run_retrieval_status,
      latest_run.parsing_status as latest_run_parsing_status,
      latest_run.normalization_status as latest_run_normalization_status,
      latest_run.resolution_status as latest_run_resolution_status,
      latest_run.coverage_status as latest_run_coverage_status,
      latest_run.withdrawals_allowed as latest_run_withdrawals_allowed,
      latest_run.rows_rejected as latest_run_rows_rejected,
      case when latest_run.id is null then 0 else jsonb_array_length(latest_run.warnings) end
        as latest_run_warning_count,
      latest_run.error_summary is not null as latest_run_has_error,
      latest_success.scheduled_for as latest_success_scheduled_for,
      coalesce(dispatches.queued, 0)::int as queued_dispatches,
      coalesce(dispatches.failed, 0)::int as failed_dispatches,
      coalesce(dispatches.expired_leases, 0)::int as expired_dispatch_leases,
      dispatches.oldest_queued_at,
      coalesce(open_runs.expired_leases, 0)::int as expired_run_leases,
      coalesce(open_runs.stale_count, 0)::int as stale_open_runs
    from property_ingest.source_definitions source
    join property_core.jurisdictions jurisdiction on jurisdiction.id = source.jurisdiction_id
    left join lateral (
      select run.*
      from property_ingest.ingestion_runs run
      where run.source_definition_id = source.id
      order by run.scheduled_for desc, run.attempt desc, run.started_at desc
      limit 1
    ) latest_run on true
    left join lateral (
      select run.scheduled_for
      from property_ingest.ingestion_runs run
      where run.source_definition_id = source.id
        and run.completed_at is not null
        and run.discovery_status = 'succeeded'
        and run.retrieval_status = 'succeeded'
        and run.parsing_status in ('succeeded', 'partial')
        and run.normalization_status in ('succeeded', 'partial')
        and run.resolution_status in ('succeeded', 'partial', 'skipped')
        and run.coverage_status in ('complete', 'not_applicable')
        and run.error_summary is null
      order by run.scheduled_for desc, run.attempt desc, run.completed_at desc
      limit 1
    ) latest_success on true
    left join lateral (
      select
        count(*) filter (where dispatch.status = 'queued') as queued,
        count(*) filter (where dispatch.status = 'failed') as failed,
        count(*) filter (
          where dispatch.status = 'claimed' and dispatch.lease_expires_at <= $2::timestamptz
        ) as expired_leases,
        min(dispatch.enqueued_at) filter (where dispatch.status = 'queued') as oldest_queued_at
      from (
        select distinct on (candidate.scheduled_for) candidate.*
        from property_ingest.ingestion_dispatches candidate
        where candidate.source_definition_id = source.id
        order by candidate.scheduled_for, candidate.attempt desc
      ) dispatch
    ) dispatches on true
    left join lateral (
      select
        count(*) filter (
          where run.lease_owner is not null and run.lease_expires_at <= $2::timestamptz
        ) as expired_leases,
        count(*) filter (
          where run.started_at <= $2::timestamptz - make_interval(mins => $3::integer)
        ) as stale_count
      from property_ingest.ingestion_runs run
      where run.source_definition_id = source.id and run.completed_at is null
    ) open_runs on true
    where $1::boolean or (source.active and source.schedule_policy->>'mode' = 'interval')
    order by jurisdiction.state_code nulls last, jurisdiction.county_fips nulls last,
             source.source_key, source.contract_version
`;

export async function queryNationwideIngestionHealth(
  transaction: PostgresTransaction,
  input: GetNationwideIngestionHealthInput,
): Promise<NationwideIngestionHealthSnapshot> {
  const asOf = canonicalUtc(input.asOf, "asOf");
  const overdueAfterIntervals = boundedPositiveInteger(
    input.overdueAfterIntervals,
    2,
    "overdueAfterIntervals",
    100,
  );
  const staleOpenRunMinutes = boundedPositiveInteger(
    input.staleOpenRunMinutes,
    120,
    "staleOpenRunMinutes",
    10_080,
  );
  const result = await transaction.query<HealthRow>(HEALTH_SQL, [
    input.includeInactive === true,
    asOf,
    staleOpenRunMinutes,
  ]);
  const sources = result.rows.map((row) =>
    deriveNationwideSourceHealth(healthInputFromRow(row), asOf, overdueAfterIntervals),
  );
  return {
    asOf,
    sourceCount: sources.length,
    // "Active" means a source the schedule actually drives. A disabled source
    // and a manual one are both excluded, because neither can be overdue.
    activeSourceCount: sources.filter(
      (source) => source.active && source.schedulePolicy.mode === "interval",
    ).length,
    healthySourceCount: sources.filter((source) => source.state === "healthy").length,
    attentionSourceCount: sources.filter((source) => source.state === "attention").length,
    criticalSourceCount: sources.filter((source) => source.state === "critical").length,
    inactiveSourceCount: sources.filter((source) => source.state === "inactive").length,
    sources,
  };
}

export async function getNationwideIngestionHealth(
  database: PostgresTransactionHost,
  input: GetNationwideIngestionHealthInput,
): Promise<NationwideIngestionHealthSnapshot> {
  canonicalUtc(input.asOf, "asOf");
  boundedPositiveInteger(input.overdueAfterIntervals, 2, "overdueAfterIntervals", 100);
  boundedPositiveInteger(input.staleOpenRunMinutes, 120, "staleOpenRunMinutes", 10_080);
  return database.transaction((transaction) => queryNationwideIngestionHealth(transaction, input));
}
