// Slice 2 of the nationwide multi-state ingestion port. Ported behavioral
// contracts from the source's tests/nationwide-ingestion-health.test.mjs and
// tests/nationwide-ingestion-health-monitor.test.mjs (alert derivation;
// incident open/escalate/resolve dedupe), against this repo's pure ports in
// nationwide-ingestion-health.ts / nationwide-ingestion-health-monitor.ts /
// nationwide-ingestion-health-delivery.ts.
import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveNationwideSourceHealth,
  type NationwideSourceHealthInput,
} from "../src/lib/property-intelligence/nationwide-ingestion-health.ts";
import {
  reconcileNationwideIngestionIncidents,
  type NationwideActiveIncident,
} from "../src/lib/property-intelligence/nationwide-ingestion-health-monitor.ts";
import {
  deliverNextNationwideHealthNotification,
  selectNextNationwideHealthDelivery,
  type NationwideHealthOutboxEntry,
} from "../src/lib/property-intelligence/nationwide-ingestion-health-delivery.ts";

function baseInput(
  overrides: Partial<NationwideSourceHealthInput> = {},
): NationwideSourceHealthInput {
  return {
    sourceDefinitionId: "10000000-0000-4000-8000-000000000001",
    sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
    contractVersion: 3,
    active: true,
    stateCode: "MO",
    countyFips: "29510",
    schedulePolicy: {
      mode: "interval",
      anchorUtc: "2026-08-15T05:00:00.000Z",
      intervalMinutes: 1_440,
      catchUpLimit: 2,
    },
    latestSuccessfulScheduledFor: "2026-08-19T05:00:00.000Z",
    latestRunScheduledFor: "2026-08-19T05:00:00.000Z",
    latestRunFailed: false,
    latestRunPartial: false,
    rowsRejected: 0,
    latestRunWithdrawalMode: "complete_snapshot",
    latestRunCoverageStatus: "complete",
    latestRunWithdrawalsAllowed: true,
    queuedDispatches: 0,
    oldestQueuedAt: null,
    failedDispatches: 0,
    expiredDispatchLeases: 0,
    expiredRunLeases: 0,
    staleOpenRuns: 0,
    ...overrides,
  };
}

test("an inactive or manual-schedule source is always 'inactive' with no alerts", () => {
  const inactive = deriveNationwideSourceHealth(
    baseInput({ active: false }),
    "2026-08-19T05:30:00.000Z",
  );
  assert.equal(inactive.state, "inactive");
  assert.deepEqual(inactive.alerts, []);
  const manual = deriveNationwideSourceHealth(
    baseInput({ schedulePolicy: { mode: "manual" } }),
    "2026-08-19T05:30:00.000Z",
  );
  assert.equal(manual.state, "inactive");
});

test("a healthy, up-to-date source has no alerts", () => {
  const health = deriveNationwideSourceHealth(baseInput(), "2026-08-19T05:30:00.000Z");
  assert.equal(health.state, "healthy");
  assert.deepEqual(health.alerts, []);
});

test("a source that has never succeeded past its activation grace period raises source_never_succeeded", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({ latestSuccessfulScheduledFor: null, latestRunScheduledFor: null }),
    "2026-08-19T05:30:00.000Z",
  );
  assert.equal(health.state, "critical");
  assert.ok(
    health.alerts.some(
      (alert) => alert.code === "source_never_succeeded" && alert.severity === "critical",
    ),
  );
});

test("a source more than overdueAfterIntervals behind raises source_overdue", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({ latestSuccessfulScheduledFor: "2026-08-10T05:00:00.000Z" }),
    "2026-08-19T05:30:00.000Z",
  );
  assert.ok(
    health.alerts.some((alert) => alert.code === "source_overdue" && alert.severity === "warning"),
  );
  assert.equal(health.state, "attention");
});

test("dispatch/run operational failures raise their matching critical alerts", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({
      expiredDispatchLeases: 1,
      expiredRunLeases: 1,
      staleOpenRuns: 1,
      failedDispatches: 1,
      latestRunFailed: true,
    }),
    "2026-08-19T05:30:00.000Z",
  );
  const codes = health.alerts.map((alert) => alert.code).sort();
  assert.deepEqual(codes, [
    "dispatch_failed",
    "dispatch_lease_expired",
    "latest_run_failed",
    "run_lease_expired",
    "run_pending_stale",
  ]);
  assert.equal(health.state, "critical");
});

test("a suppressed complete-snapshot withdrawal raises withdrawals_suppressed", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({ latestRunWithdrawalsAllowed: false }),
    "2026-08-19T05:30:00.000Z",
  );
  assert.ok(health.alerts.some((alert) => alert.code === "withdrawals_suppressed"));
});

// --- incident reconciliation: open / dedupe / escalate / resolve ---------

test("a newly observed alert opens exactly one incident, never a duplicate for the same (source, code)", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({ rowsRejected: 3 }),
    "2026-08-19T05:30:00.000Z",
  );
  const result = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T05:30:00.000Z",
    sources: [health],
    activeIncidents: [],
  });
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]!.transition, "opened");
  assert.equal(result.transitions[0]!.alertCode, "latest_run_rejections");
  assert.equal(result.activeIncidents.length, 1);
});

test("an alert that is still observed on the next pass does not reopen or duplicate its incident", () => {
  const health = deriveNationwideSourceHealth(
    baseInput({ rowsRejected: 3 }),
    "2026-08-19T05:30:00.000Z",
  );
  const first = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T05:30:00.000Z",
    sources: [health],
    activeIncidents: [],
  });
  const second = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T06:30:00.000Z",
    sources: [health],
    activeIncidents: first.activeIncidents,
  });
  assert.equal(second.transitions.length, 0);
  assert.equal(second.activeIncidents.length, 1);
  assert.equal(second.activeIncidents[0]!.incidentId, first.activeIncidents[0]!.incidentId);
});

test("an incident escalates from warning to critical but not the reverse", () => {
  const active: NationwideActiveIncident[] = [
    {
      incidentId: "incident-1",
      sourceDefinitionId: "10000000-0000-4000-8000-000000000001",
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      stateCode: "MO",
      countyFips: "29510",
      alertCode: "source_overdue",
      severity: "warning",
      observed: 1,
      expected: "at most 2 schedule intervals behind",
    },
  ];
  const escalatedHealth = deriveNationwideSourceHealth(
    baseInput({ latestSuccessfulScheduledFor: null, latestRunScheduledFor: null }),
    "2026-08-19T05:30:00.000Z",
  );
  // Swap in the still-open source_overdue alert code isn't naturally produced
  // alongside source_never_succeeded, so exercise escalation directly against
  // a hand-built pair of same-code alerts instead of relying on derivation.
  const overdueThenCritical = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T05:30:00.000Z",
    sources: [
      {
        ...escalatedHealth,
        alerts: [
          { code: "source_overdue", severity: "critical", observed: 5, expected: "at most 2" },
        ],
      },
    ],
    activeIncidents: active,
  });
  assert.equal(overdueThenCritical.transitions.length, 1);
  assert.equal(overdueThenCritical.transitions[0]!.transition, "escalated");
  assert.equal(overdueThenCritical.activeIncidents[0]!.severity, "critical");

  const noDeescalation = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T06:30:00.000Z",
    sources: [
      {
        ...escalatedHealth,
        alerts: [
          { code: "source_overdue", severity: "warning", observed: 3, expected: "at most 2" },
        ],
      },
    ],
    activeIncidents: overdueThenCritical.activeIncidents,
  });
  assert.equal(
    noDeescalation.transitions.length,
    0,
    "severity decreasing is not itself a transition",
  );
});

test("an incident no longer observed resolves", () => {
  const active: NationwideActiveIncident[] = [
    {
      incidentId: "incident-1",
      sourceDefinitionId: "10000000-0000-4000-8000-000000000001",
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      stateCode: "MO",
      countyFips: "29510",
      alertCode: "latest_run_rejections",
      severity: "warning",
      observed: 3,
      expected: "0 rejected rows",
    },
  ];
  const healthy = deriveNationwideSourceHealth(baseInput(), "2026-08-19T05:30:00.000Z");
  const result = reconcileNationwideIngestionIncidents({
    asOf: "2026-08-19T05:30:00.000Z",
    sources: [healthy],
    activeIncidents: active,
  });
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0]!.transition, "resolved");
  assert.equal(result.activeIncidents.length, 0);
});

// --- delivery / outbox drain, injected sink -------------------------------

function outboxEntry(
  overrides: Partial<NationwideHealthOutboxEntry> = {},
): NationwideHealthOutboxEntry {
  return {
    outboxId: "outbox-1",
    idempotencyKey: "idem-1",
    transition: {
      incidentId: "incident-1",
      sourceDefinitionId: "10000000-0000-4000-8000-000000000001",
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      stateCode: "MO",
      countyFips: "29510",
      transition: "opened",
      alertCode: "latest_run_rejections",
      severity: "warning",
      observed: 3,
      expected: "0 rejected rows",
      snapshotAsOf: "2026-08-19T05:30:00.000Z",
    },
    status: "queued",
    claimCount: 0,
    enqueuedAt: "2026-08-19T05:30:00.000Z",
    availableAt: "2026-08-19T05:30:00.000Z",
    providerDeliveryId: null,
    errorSummary: null,
    ...overrides,
  };
}

test("selectNextNationwideHealthDelivery picks the earliest ready, queued entry", () => {
  const queue = [
    outboxEntry({ outboxId: "b", availableAt: "2026-08-19T05:40:00.000Z" }),
    outboxEntry({ outboxId: "a", availableAt: "2026-08-19T05:30:00.000Z" }),
    outboxEntry({ outboxId: "c", status: "succeeded" }),
  ];
  const next = selectNextNationwideHealthDelivery(queue, "2026-08-19T06:00:00.000Z");
  assert.equal(next?.outboxId, "a");
  assert.equal(selectNextNationwideHealthDelivery(queue, "2026-08-19T05:00:00.000Z"), null);
});

test("delivery never fires without an explicitly injected sink, and a successful delivery reports the provider ID", async () => {
  let delivered: unknown = null;
  const outcome = await deliverNextNationwideHealthNotification({
    queue: [outboxEntry()],
    now: "2026-08-19T06:00:00.000Z",
    sink: {
      async deliver(input) {
        delivered = input;
        return { providerDeliveryId: "provider-1" };
      },
    },
  });
  assert.deepEqual(outcome, {
    status: "succeeded",
    outboxId: "outbox-1",
    providerDeliveryId: "provider-1",
    errorSummary: null,
    availableAt: null,
  });
  assert.ok(delivered);
});

test("a failed delivery under the retry budget schedules a retry; over budget it fails permanently", async () => {
  const failingSink = {
    async deliver() {
      throw new Error("endpoint unreachable");
    },
  };
  const retry = await deliverNextNationwideHealthNotification({
    queue: [outboxEntry({ claimCount: 0 })],
    now: "2026-08-19T06:00:00.000Z",
    sink: failingSink,
    maxAttempts: 3,
    retryDelaySeconds: 60,
  });
  assert.equal(retry.status, "retry_scheduled");
  if (retry.status === "retry_scheduled")
    assert.equal(retry.availableAt, "2026-08-19T06:01:00.000Z");

  const exhausted = await deliverNextNationwideHealthNotification({
    queue: [outboxEntry({ claimCount: 2 })],
    now: "2026-08-19T06:00:00.000Z",
    sink: failingSink,
    maxAttempts: 3,
  });
  assert.equal(exhausted.status, "failed");
});

test("an idle queue returns status idle without invoking the sink", async () => {
  let called = false;
  const outcome = await deliverNextNationwideHealthNotification({
    queue: [],
    now: "2026-08-19T06:00:00.000Z",
    sink: {
      async deliver() {
        called = true;
      },
    },
  });
  assert.deepEqual(outcome, { status: "idle" });
  assert.equal(called, false);
});
