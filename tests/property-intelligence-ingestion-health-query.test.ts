// Contract for the database-reading half of nationwide ingestion health.
//
// The alert thresholds themselves belong to `deriveNationwideSourceHealth`
// and are covered by property-intelligence-ingestion-health.test.ts. What is
// pinned here is the reader's own job: turning a database row into the input
// that function expects, and refusing a row it cannot trust. The row-shape
// judgements the reader makes -- "did the latest run fail", "was it partial"
// -- are tested directly, because getting either backwards would silently
// invert a source's health.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getNationwideIngestionHealth,
  healthInputFromRow,
  queryNationwideIngestionHealth,
} from "../src/lib/property-intelligence/nationwide-ingestion-health-query.ts";

const SOURCE_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";
const AS_OF = "2026-09-24T12:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    source_definition_id: SOURCE_ID,
    source_key: "mo_st_louis_lra_inventory_v1",
    contract_version: 3,
    active: true,
    state_code: "MO",
    county_fips: "29510",
    schedule_policy: {
      mode: "interval",
      anchorUtc: "2026-09-01T00:00:00.000Z",
      intervalMinutes: 1_440,
      catchUpLimit: 3,
    },
    latest_run_id: "8a7b6c5d-4e3f-4a2b-9c8d-7e6f5a4b3c2d",
    latest_run_scheduled_for: "2026-09-23T00:00:00.000Z",
    latest_run_withdrawal_mode: "complete_snapshot",
    latest_run_discovery_status: "succeeded",
    latest_run_retrieval_status: "succeeded",
    latest_run_parsing_status: "succeeded",
    latest_run_normalization_status: "succeeded",
    latest_run_resolution_status: "succeeded",
    latest_run_coverage_status: "complete",
    latest_run_withdrawals_allowed: true,
    latest_run_rows_rejected: 0,
    latest_run_warning_count: 0,
    latest_run_has_error: false,
    latest_success_scheduled_for: "2026-09-23T00:00:00.000Z",
    queued_dispatches: 0,
    failed_dispatches: 0,
    expired_dispatch_leases: 0,
    oldest_queued_at: null,
    expired_run_leases: 0,
    stale_open_runs: 0,
    ...overrides,
  } as never;
}

function hostReturning(rows: unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    host: {
      transaction: async <Result>(
        callback: (transaction: {
          query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        }) => Promise<Result>,
      ) =>
        callback({
          query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });
            return { rows };
          },
        }),
    },
  };
}

test("a clean row becomes a healthy source and is counted as active", async () => {
  const { host } = hostReturning([row()]);
  const snapshot = await getNationwideIngestionHealth(host as never, { asOf: AS_OF });
  assert.equal(snapshot.sourceCount, 1);
  assert.equal(snapshot.activeSourceCount, 1);
  assert.equal(snapshot.healthySourceCount, 1);
  assert.equal(snapshot.sources[0]?.state, "healthy");
  assert.deepEqual(snapshot.sources[0]?.alerts, []);
});

test("a failed phase makes the run failed; a partial phase does not", () => {
  assert.equal(
    healthInputFromRow(row({ latest_run_parsing_status: "failed" })).latestRunFailed,
    true,
  );
  const partial = healthInputFromRow(row({ latest_run_parsing_status: "partial" }));
  assert.equal(partial.latestRunFailed, false, "partial is not failure");
  assert.equal(partial.latestRunPartial, true);
});

test("an error summary fails the run even when every phase reports success", () => {
  assert.equal(healthInputFromRow(row({ latest_run_has_error: true })).latestRunFailed, true);
});

test("warnings on an otherwise clean run count as partial", () => {
  assert.equal(healthInputFromRow(row({ latest_run_warning_count: 2 })).latestRunPartial, true);
});

test("a source with no latest run is neither failed nor partial", () => {
  const none = healthInputFromRow(
    row({
      latest_run_id: null,
      latest_run_scheduled_for: null,
      latest_run_has_error: null,
      latest_run_warning_count: 0,
      latest_run_coverage_status: null,
      latest_run_withdrawal_mode: null,
      latest_run_withdrawals_allowed: null,
      latest_success_scheduled_for: null,
    }),
  );
  assert.equal(none.latestRunFailed, false);
  assert.equal(none.latestRunPartial, false);
  assert.equal(none.latestSuccessfulScheduledFor, null);
});

test("a manual source is reported inactive and never counted as active", async () => {
  const { host } = hostReturning([row({ schedule_policy: { mode: "manual" } })]);
  const snapshot = await getNationwideIngestionHealth(host as never, {
    asOf: AS_OF,
    includeInactive: true,
  });
  assert.equal(snapshot.sources[0]?.state, "inactive");
  assert.equal(snapshot.activeSourceCount, 0, "a manual source is never overdue");
  assert.equal(snapshot.inactiveSourceCount, 1);
});

test("includeInactive and the stale-run window are passed to the query, not applied in memory", async () => {
  const { queries, host } = hostReturning([row()]);
  await getNationwideIngestionHealth(host as never, {
    asOf: AS_OF,
    includeInactive: true,
    staleOpenRunMinutes: 45,
  });
  assert.deepEqual(queries[0]?.params, [true, AS_OF, 45]);
  assert.match(queries[0]?.sql ?? "", /distinct on \(candidate\.scheduled_for\)/);
});

test("freshness is measured against the last operationally valid run, not the last attempt", async () => {
  // The latest attempt is recent but failed; the last good run is 9 days old
  // on a daily schedule. A reader that measured against the attempt would
  // call this fresh.
  const { host } = hostReturning([
    row({
      latest_run_scheduled_for: "2026-09-24T00:00:00.000Z",
      latest_run_discovery_status: "failed",
      latest_success_scheduled_for: "2026-09-15T00:00:00.000Z",
    }),
  ]);
  const snapshot = await getNationwideIngestionHealth(host as never, { asOf: AS_OF });
  const source = snapshot.sources[0];
  assert.equal(source?.state, "critical");
  assert.ok(
    source?.alerts.some((item) => item.code === "source_overdue"),
    "a stale source must still be reported overdue while its retries keep failing",
  );
});

test("a row the reader cannot trust fails instead of being reported as healthy", () => {
  assert.throws(
    () => healthInputFromRow(row({ source_definition_id: "nope" })),
    /source definition ID/,
  );
  assert.throws(
    () => healthInputFromRow(row({ schedule_policy: null })),
    /invalid source schedule policy/,
  );
  assert.throws(
    () => healthInputFromRow(row({ schedule_policy: { mode: "cron" } })),
    /unsupported source schedule policy/,
  );
  assert.throws(
    () =>
      healthInputFromRow(
        row({
          schedule_policy: {
            mode: "interval",
            anchorUtc: "2026-09-01T00:00:00.000Z",
            intervalMinutes: 1,
            catchUpLimit: 3,
          },
        }),
      ),
    /out-of-range source schedule policy/,
  );
  assert.throws(() => healthInputFromRow(row({ latest_run_rows_rejected: -1 })), /rows rejected/);
  assert.throws(
    () => healthInputFromRow(row({ latest_run_coverage_status: "weird" })),
    /unsupported run coverage status/,
  );
});

test("the asOf timestamp and the bounds are validated before any query runs", async () => {
  const { queries, host } = hostReturning([row()]);
  await assert.rejects(
    getNationwideIngestionHealth(host as never, { asOf: "2026-09-24" }),
    /canonical UTC/,
  );
  await assert.rejects(
    getNationwideIngestionHealth(host as never, { asOf: AS_OF, overdueAfterIntervals: 0 }),
    /overdueAfterIntervals must be an integer/,
  );
  await assert.rejects(
    getNationwideIngestionHealth(host as never, { asOf: AS_OF, staleOpenRunMinutes: 99_999 }),
    /staleOpenRunMinutes must be an integer/,
  );
  assert.equal(queries.length, 0, "nothing is queried on invalid input");
});

test("queryNationwideIngestionHealth works against a transaction directly", async () => {
  const snapshot = await queryNationwideIngestionHealth(
    { query: async () => ({ rows: [row()] }) } as never,
    { asOf: AS_OF },
  );
  assert.equal(snapshot.asOf, AS_OF);
  assert.equal(snapshot.sources.length, 1);
});
