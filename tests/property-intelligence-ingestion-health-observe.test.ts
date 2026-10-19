// Contract for the committing half of nationwide health monitoring.
//
// The transition rules are the pure reconciler's and are tested in
// property-intelligence-ingestion-health-monitor.test.ts. What is pinned
// here is what only the committing step can get wrong: running the same
// snapshot twice, running snapshots out of order, letting the reconciler's
// placeholder incident identity escape into the outbox, or observing
// inactive sources and opening incidents nothing will resolve.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NationwideHealthObservationAlreadyCommittedError,
  observeNationwideIngestionHealth,
} from "../src/lib/property-intelligence/nationwide-ingestion-health-observe.ts";

const SOURCE_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8";
const INCIDENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NEW_INCIDENT_ID = "12121212-3434-4545-8656-767676767676";
const OUTBOX_ID = "99999999-8888-4777-8666-555555555555";
const AS_OF = "2026-09-24T12:00:00.000Z";

// A source that is overdue: its last success is 9 days back on a daily
// schedule, so the health derivation raises source_overdue.
function overdueSourceRow() {
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
    latest_run_scheduled_for: "2026-09-15T00:00:00.000Z",
    latest_run_withdrawal_mode: null,
    latest_run_discovery_status: "succeeded",
    latest_run_retrieval_status: "succeeded",
    latest_run_parsing_status: "succeeded",
    latest_run_normalization_status: "succeeded",
    latest_run_resolution_status: "succeeded",
    latest_run_coverage_status: "complete",
    latest_run_withdrawals_allowed: null,
    latest_run_rows_rejected: 0,
    latest_run_warning_count: 0,
    latest_run_has_error: false,
    latest_success_scheduled_for: "2026-09-15T00:00:00.000Z",
    queued_dispatches: 0,
    failed_dispatches: 0,
    expired_dispatch_leases: 0,
    oldest_queued_at: null,
    expired_run_leases: 0,
    stale_open_runs: 0,
  };
}

type Call = { sql: string; params: unknown[] };

function database(options: {
  checkpoint?: string | null;
  activeIncidents?: unknown[];
  healthRows?: unknown[];
}) {
  const calls: Call[] = [];
  const host = {
    transaction: async <Result>(
      callback: (transaction: {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<Result>,
    ) =>
      callback({
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          if (/ingestion_health_monitor_state/.test(sql) && /select/.test(sql)) {
            return {
              rows:
                options.checkpoint === undefined || options.checkpoint === null
                  ? []
                  : [{ last_snapshot_as_of: options.checkpoint }],
            };
          }
          if (/from property_ingest\.source_definitions source/.test(sql)) {
            return { rows: options.healthRows ?? [overdueSourceRow()] };
          }
          if (/from property_ingest\.ingestion_health_incidents incident/.test(sql)) {
            return { rows: options.activeIncidents ?? [] };
          }
          if (/insert into property_ingest\.ingestion_health_incidents/.test(sql)) {
            return { rows: [{ id: NEW_INCIDENT_ID }] };
          }
          if (/insert into property_ingest\.ingestion_health_outbox/.test(sql)) {
            return { rows: [{ id: OUTBOX_ID, idempotency_key: OUTBOX_ID }] };
          }
          return { rows: [] };
        },
      }),
  };
  return { calls, host };
}

function outboxCalls(calls: Call[]) {
  return calls.filter((call) =>
    /insert into property_ingest\.ingestion_health_outbox/.test(call.sql),
  );
}

test("a newly observed alert opens an incident and enqueues one outbox row", async () => {
  const db = database({});
  const result = await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });

  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]?.transition, "opened");
  assert.equal(result.transitions[0]?.alertCode, "source_overdue");
  assert.equal(outboxCalls(db.calls).length, 1);
});

test("the outbox carries the inserted incident id, never the reconciler's placeholder", async () => {
  const db = database({});
  const result = await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });

  assert.equal(result.transitions[0]?.incidentId, NEW_INCIDENT_ID);
  const enqueued = outboxCalls(db.calls)[0];
  assert.equal(enqueued?.params[0], NEW_INCIDENT_ID);
  assert.ok(
    !String(enqueued?.params[0]).startsWith("new:"),
    "a placeholder identity in the outbox would be undeliverable",
  );
});

test("re-running the same asOf is refused instead of re-enqueueing every transition", async () => {
  const db = database({ checkpoint: AS_OF });
  await assert.rejects(
    observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF }),
    (error: unknown) => {
      assert.ok(error instanceof NationwideHealthObservationAlreadyCommittedError);
      assert.equal(error.asOf, AS_OF);
      return true;
    },
  );
  assert.equal(outboxCalls(db.calls).length, 0, "nothing is enqueued twice for one snapshot");
});

test("an out-of-order snapshot is refused rather than resolving still-true incidents", async () => {
  const db = database({ checkpoint: "2026-09-25T12:00:00.000Z" });
  await assert.rejects(
    observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF }),
    /later than the last committed health observation/,
  );
  assert.equal(outboxCalls(db.calls).length, 0);
});

test("the observation is serialized and the checkpoint row is locked", async () => {
  const db = database({});
  await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });
  assert.ok(
    db.calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)),
    "two concurrent monitors would both open the same incident",
  );
  assert.ok(
    db.calls.some(
      (call) => /ingestion_health_monitor_state/.test(call.sql) && /for update/.test(call.sql),
    ),
  );
  assert.ok(
    db.calls.some((call) => /for update of incident/.test(call.sql)),
    "a concurrent resolver must not close an incident between the read and the write",
  );
});

test("inactive sources are excluded, so no incident is opened that nothing resolves", async () => {
  const db = database({});
  await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });
  const healthQuery = db.calls.find((call) =>
    /from property_ingest\.source_definitions source/.test(call.sql),
  );
  assert.equal(healthQuery?.params[0], false, "includeInactive must be false when committing");
});

test("an alert that is no longer observed resolves its incident and enqueues the resolution", async () => {
  // The source is healthy now, but a dispatch_failed incident is still open.
  const healthy = {
    ...overdueSourceRow(),
    latest_success_scheduled_for: "2026-09-24T00:00:00.000Z",
  };
  const db = database({
    healthRows: [healthy],
    activeIncidents: [
      {
        id: INCIDENT_ID,
        source_definition_id: SOURCE_ID,
        source_key: "mo_st_louis_lra_inventory_v1",
        contract_version: 3,
        state_code: "MO",
        county_fips: "29510",
        alert_code: "dispatch_failed",
        severity: "critical",
        observed: 2,
        expected: "0 latest-attempt failed dispatches",
      },
    ],
  });
  const result = await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });

  const resolved = result.transitions.filter((item) => item.transition === "resolved");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.incidentId, INCIDENT_ID);
  assert.ok(
    db.calls.some((call) => /set resolved_at = \$2/.test(call.sql)),
    "the incident row itself must be closed, not only announced",
  );
});

test("the checkpoint advances to the committed snapshot", async () => {
  const db = database({});
  await observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF });
  const checkpoint = db.calls.find((call) =>
    /insert into property_ingest\.ingestion_health_monitor_state/.test(call.sql),
  );
  assert.deepEqual(checkpoint?.params, [AS_OF]);
});

test("a non-canonical asOf is refused before the transaction does any work", async () => {
  const db = database({});
  await assert.rejects(
    observeNationwideIngestionHealth(db.host as never, { asOf: "2026-09-24 12:00:00" }),
    /canonical UTC/,
  );
  assert.equal(db.calls.length, 0);
});

test("an unsupported alert code from the database fails rather than being queued", async () => {
  const db = database({
    activeIncidents: [
      {
        id: INCIDENT_ID,
        source_definition_id: SOURCE_ID,
        source_key: "mo_st_louis_lra_inventory_v1",
        contract_version: 3,
        state_code: "MO",
        county_fips: "29510",
        alert_code: "not_a_real_code",
        severity: "critical",
        observed: 1,
        expected: "x",
      },
    ],
  });
  await assert.rejects(
    observeNationwideIngestionHealth(db.host as never, { asOf: AS_OF }),
    /unsupported active health alert code/,
  );
});
