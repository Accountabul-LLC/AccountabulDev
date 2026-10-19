// Ported from property-intelligence-app's app/lib/nationwide-ingestion-health.ts
// (Slice 2 of the nationwide multi-state ingestion port). The source module
// computes this same alert derivation from a large aggregating SQL query
// (queryNationwideIngestionHealth) against ingestion_runs/dispatches. This
// slice ports only the PURE decision logic -- given a source's already
// -aggregated operational counters (queued/claimed/failed dispatch counts,
// latest run outcome, etc.), which of the eleven operational alert codes
// property_ingest.ingestion_health_incidents' check constraint enumerates
// apply right now, and what overall health state does that put the source
// in. It never queries a database itself; a caller (not built in this repo)
// would aggregate those counters from property_ingest and pass them in here.
export const NATIONWIDE_OPERATIONAL_HEALTH_ALERT_CODES = [
  "source_never_succeeded",
  "source_overdue",
  "dispatch_backlog",
  "dispatch_failed",
  "dispatch_lease_expired",
  "run_pending_stale",
  "run_lease_expired",
  "latest_run_failed",
  "latest_run_partial",
  "latest_run_rejections",
  "withdrawals_suppressed",
] as const;

export type NationwideOperationalHealthAlertCode =
  (typeof NATIONWIDE_OPERATIONAL_HEALTH_ALERT_CODES)[number];
export type NationwideIngestionHealthSeverity = "warning" | "critical";

export type NationwideIngestionHealthAlert = {
  code: NationwideOperationalHealthAlertCode;
  severity: NationwideIngestionHealthSeverity;
  observed: number | string;
  expected: string;
};

export type NationwideSourceHealthInput = {
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  active: boolean;
  stateCode: string | null;
  countyFips: string | null;
  schedulePolicy:
    | { mode: "manual" }
    | {
        mode: "interval";
        anchorUtc: string;
        intervalMinutes: number;
        catchUpLimit: number;
      };
  latestSuccessfulScheduledFor: string | null;
  latestRunScheduledFor: string | null;
  latestRunFailed: boolean;
  latestRunPartial: boolean;
  rowsRejected: number;
  latestRunWithdrawalMode: "append_only" | "complete_snapshot" | null;
  latestRunCoverageStatus: "pending" | "complete" | "partial" | "failed" | "not_applicable" | null;
  latestRunWithdrawalsAllowed: boolean | null;
  queuedDispatches: number;
  oldestQueuedAt: string | null;
  failedDispatches: number;
  expiredDispatchLeases: number;
  expiredRunLeases: number;
  staleOpenRuns: number;
};

export type NationwideSourceIngestionHealth = NationwideSourceHealthInput & {
  latestDueAt: string | null;
  overdueSlots: number | null;
  state: "inactive" | "healthy" | "attention" | "critical";
  alerts: NationwideIngestionHealthAlert[];
};

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function latestDueAt(policy: { anchorUtc: string; intervalMinutes: number }, asOf: string) {
  const anchor = Date.parse(policy.anchorUtc);
  const observed = Date.parse(asOf);
  if (observed < anchor) return null;
  const intervalMs = policy.intervalMinutes * 60_000;
  const slot = Math.floor((observed - anchor) / intervalMs);
  return new Date(anchor + slot * intervalMs).toISOString();
}

function alert(
  alerts: NationwideIngestionHealthAlert[],
  code: NationwideOperationalHealthAlertCode,
  severity: NationwideIngestionHealthSeverity,
  observed: number | string,
  expected: string,
) {
  alerts.push({ code, severity, observed, expected });
}

// Given one source's already-aggregated operational counters, which alerts
// currently apply and what health state does that put the source in. An
// inactive source, or one on a manual schedule, is always reported
// "inactive" with no alerts -- it is never overdue.
export function deriveNationwideSourceHealth(
  input: NationwideSourceHealthInput,
  asOf: string,
  overdueAfterIntervals = 2,
): NationwideSourceIngestionHealth {
  canonicalUtc(asOf, "asOf");
  if (
    !Number.isInteger(overdueAfterIntervals) ||
    overdueAfterIntervals < 1 ||
    overdueAfterIntervals > 100
  ) {
    throw new Error("overdueAfterIntervals must be an integer between 1 and 100");
  }
  const alerts: NationwideIngestionHealthAlert[] = [];
  const policy = input.schedulePolicy;
  if (!input.active || policy.mode === "manual") {
    return { ...input, latestDueAt: null, overdueSlots: null, state: "inactive", alerts };
  }

  const latestDue = latestDueAt(policy, asOf);
  const freshnessLagMinutes =
    latestDue && input.latestSuccessfulScheduledFor
      ? Math.max(
          0,
          (Date.parse(latestDue) - Date.parse(input.latestSuccessfulScheduledFor)) / 60_000,
        )
      : null;
  const overdueSlots =
    freshnessLagMinutes !== null ? Math.floor(freshnessLagMinutes / policy.intervalMinutes) : null;

  if (input.expiredDispatchLeases > 0) {
    alert(
      alerts,
      "dispatch_lease_expired",
      "critical",
      input.expiredDispatchLeases,
      "0 expired dispatch leases",
    );
  }
  if (input.expiredRunLeases > 0) {
    alert(alerts, "run_lease_expired", "critical", input.expiredRunLeases, "0 expired run leases");
  }
  if (input.staleOpenRuns > 0) {
    alert(alerts, "run_pending_stale", "critical", input.staleOpenRuns, "0 stale open runs");
  }
  if (input.failedDispatches > 0) {
    alert(
      alerts,
      "dispatch_failed",
      "critical",
      input.failedDispatches,
      "0 latest-attempt failed dispatches",
    );
  }
  if (input.latestRunFailed) {
    alert(
      alerts,
      "latest_run_failed",
      "critical",
      input.latestRunScheduledFor ?? "unknown",
      "latest run succeeds",
    );
  }
  if (input.latestSuccessfulScheduledFor === null) {
    const activationGraceElapsed =
      latestDue !== null &&
      Date.parse(asOf) - Date.parse(policy.anchorUtc) >=
        policy.intervalMinutes * overdueAfterIntervals * 60_000;
    if (activationGraceElapsed) {
      alert(
        alerts,
        "source_never_succeeded",
        "critical",
        "none",
        "at least one completed operationally valid run",
      );
    }
  } else if (overdueSlots !== null && overdueSlots > overdueAfterIntervals) {
    alert(
      alerts,
      "source_overdue",
      "warning",
      overdueSlots,
      `at most ${overdueAfterIntervals} schedule intervals behind`,
    );
  }
  const oldestQueueAgeMinutes =
    input.oldestQueuedAt === null
      ? 0
      : (Date.parse(asOf) - Date.parse(input.oldestQueuedAt)) / 60_000;
  if (
    input.queuedDispatches > policy.catchUpLimit ||
    oldestQueueAgeMinutes > policy.intervalMinutes * overdueAfterIntervals
  ) {
    alert(
      alerts,
      "dispatch_backlog",
      "warning",
      input.queuedDispatches,
      `at most ${policy.catchUpLimit} recent queued dispatches`,
    );
  }
  if (input.latestRunPartial) {
    alert(
      alerts,
      "latest_run_partial",
      "warning",
      input.latestRunScheduledFor ?? "unknown",
      "complete source-form processing with no warnings",
    );
  }
  if (input.rowsRejected > 0) {
    alert(alerts, "latest_run_rejections", "warning", input.rowsRejected, "0 rejected rows");
  }
  if (
    input.latestRunWithdrawalMode === "complete_snapshot" &&
    input.latestRunCoverageStatus === "complete" &&
    input.latestRunWithdrawalsAllowed === false
  ) {
    alert(
      alerts,
      "withdrawals_suppressed",
      "warning",
      "suppressed",
      "allowed only after every complete-snapshot safety gate passes",
    );
  }

  const state: NationwideSourceIngestionHealth["state"] = alerts.some(
    (item) => item.severity === "critical",
  )
    ? "critical"
    : alerts.length > 0
      ? "attention"
      : "healthy";
  return { ...input, latestDueAt: latestDue, overdueSlots, state, alerts };
}
