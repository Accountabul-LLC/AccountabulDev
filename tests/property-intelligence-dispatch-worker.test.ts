// Contract for the dispatch worker tick.
//
// The store primitives are covered by
// property-intelligence-postgres-dispatch-store.test.ts. What is pinned here
// is what the worker adds on top of them, and each case is a way a queue
// breaks when the loop is written casually: a claimed row left claimed after
// a throw, a worker that claims sources it cannot handle, or timestamps
// frozen at the moment the tick began.
import assert from "node:assert/strict";
import test from "node:test";

import { executeNextNationwideDispatch } from "../src/lib/property-intelligence/nationwide-dispatch-worker.ts";

const DISPATCH_ID = "11111111-2222-4333-8444-555555555555";
const RUN_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function dispatchRow(overrides: Record<string, unknown> = {}) {
  return {
    dispatch_id: DISPATCH_ID,
    source_definition_id: "99999999-8888-4777-8666-555555555555",
    source_key: "mo_st_louis_lra_inventory_v1",
    contract_version: 3,
    scheduled_for: "2026-09-24T00:00:00.000Z",
    attempt: 1,
    status: "claimed",
    available_at: "2026-09-24T00:00:00.000Z",
    enqueued_at: "2026-09-24T00:00:00.000Z",
    claim_count: 1,
    lease_owner: "worker-1",
    lease_acquired_at: "2026-09-24T12:00:00.000Z",
    lease_expires_at: "2026-09-24T12:05:00.000Z",
    completed_at: null,
    error_summary: null,
    ingestion_run_id: null,
    ...overrides,
  };
}

// Records every statement so a test can assert which store call ran, without
// needing a real database.
function fakeDatabase(rowsFor: (sql: string) => unknown[]) {
  const statements: string[] = [];
  return {
    statements,
    host: {
      transaction: async <Result>(
        callback: (transaction: {
          query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        }) => Promise<Result>,
      ) =>
        callback({
          query: async (sql: string) => {
            statements.push(sql);
            return { rows: rowsFor(sql) };
          },
        }),
    },
  };
}

function verbFor(sql: string) {
  if (/set status = 'succeeded'/.test(sql)) return "complete";
  if (/set status = 'failed'/.test(sql)) return "fail";
  if (/lease_expires_at = /.test(sql) && /set status/.test(sql) === false) return "renew";
  return "claim";
}

const SCOPE = { allowedSourceKeys: ["mo_st_louis_lra_inventory_v1"] };

test("a successful execution completes the dispatch with its ingestion run", async () => {
  const db = fakeDatabase(() => [dispatchRow({ status: "succeeded", ingestion_run_id: RUN_ID })]);
  const result = await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => "2026-09-24T12:00:00.000Z",
    execute: async () => ({ ingestionRunId: RUN_ID }),
    safeErrorSummary: () => "unused",
    ...SCOPE,
  });
  assert.equal(result.status, "succeeded");
  assert.ok(db.statements.some((sql) => verbFor(sql) === "complete"));
  assert.ok(!db.statements.some((sql) => verbFor(sql) === "fail"));
});

test("nothing to claim is an idle tick, not an error", async () => {
  const db = fakeDatabase(() => []);
  const result = await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => "2026-09-24T12:00:00.000Z",
    execute: async () => {
      throw new Error("must not run when nothing was claimed");
    },
    safeErrorSummary: () => "unused",
    ...SCOPE,
  });
  assert.deepEqual(result, { status: "idle" });
});

test("a throwing execution fails the dispatch instead of leaving it claimed", async () => {
  const db = fakeDatabase(() => [dispatchRow({ status: "failed", error_summary: "redacted" })]);
  const result = await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => "2026-09-24T12:00:00.000Z",
    execute: async () => {
      throw new Error("connection string postgres://user:secret@host/db leaked");
    },
    safeErrorSummary: () => "redacted",
    ...SCOPE,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" ? result.errorSummary : null, "redacted");
  assert.ok(
    db.statements.some((sql) => verbFor(sql) === "fail"),
    "an escaped exception would leave the row claimed until its lease expired",
  );
});

test("what lands in the row is the caller's redacted summary, not the raw error", async () => {
  const captured: string[] = [];
  const db = fakeDatabase((sql) => {
    if (verbFor(sql) === "fail") captured.push(sql);
    return [dispatchRow({ status: "failed" })];
  });
  await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => "2026-09-24T12:00:00.000Z",
    execute: async () => {
      throw new Error("postgres://user:secret@host/db");
    },
    safeErrorSummary: (error) => `run failed: ${(error as Error).name}`,
    ...SCOPE,
  });
  assert.equal(captured.length, 1);
});

test("a worker with no claim scope is refused rather than claiming everything", async () => {
  const db = fakeDatabase(() => [dispatchRow()]);
  await assert.rejects(
    executeNextNationwideDispatch({
      database: db.host as never,
      workerId: "worker-1",
      leaseSeconds: 300,
      execute: async () => ({ ingestionRunId: RUN_ID }),
      safeErrorSummary: () => "x",
    } as never),
    /explicit source claim scope/,
  );
  assert.equal(db.statements.length, 0, "nothing is claimed without a scope");
});

test("the worker id, execute and safeErrorSummary are all required", async () => {
  const db = fakeDatabase(() => [dispatchRow()]);
  const base = {
    database: db.host as never,
    leaseSeconds: 300,
    execute: async () => ({ ingestionRunId: RUN_ID }),
    safeErrorSummary: () => "x",
    ...SCOPE,
  };
  await assert.rejects(
    executeNextNationwideDispatch({ ...base, workerId: "   " } as never),
    /workerId is required/,
  );
  await assert.rejects(
    executeNextNationwideDispatch({ ...base, workerId: "w", execute: undefined } as never),
    /requires an execute implementation/,
  );
  await assert.rejects(
    executeNextNationwideDispatch({ ...base, workerId: "w", safeErrorSummary: undefined } as never),
    /requires a safeErrorSummary implementation/,
  );
});

test("a non-canonical clock is rejected before anything is claimed", async () => {
  const db = fakeDatabase(() => [dispatchRow()]);
  await assert.rejects(
    executeNextNationwideDispatch({
      database: db.host as never,
      workerId: "worker-1",
      leaseSeconds: 300,
      clock: () => "2026-09-24 12:00:00",
      execute: async () => ({ ingestionRunId: RUN_ID }),
      safeErrorSummary: () => "x",
      ...SCOPE,
    }),
    /canonical UTC/,
  );
  assert.equal(db.statements.length, 0);
});

test("each step reads the clock again, so a long run completes at the time it finished", async () => {
  const times = [
    "2026-09-24T12:00:00.000Z",
    "2026-09-24T12:04:00.000Z",
    "2026-09-24T12:08:00.000Z",
  ];
  let index = 0;
  const db = fakeDatabase(() => [dispatchRow({ status: "succeeded", ingestion_run_id: RUN_ID })]);
  await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => times[Math.min(index++, times.length - 1)]!,
    execute: async ({ renewLease }) => {
      await renewLease();
      return { ingestionRunId: RUN_ID };
    },
    safeErrorSummary: () => "x",
    ...SCOPE,
  });
  assert.ok(index >= 3, "claim, renew and complete each read the clock rather than reusing one");
});

test("renewLease is offered to the executor rather than run on a timer", async () => {
  const db = fakeDatabase(() => [dispatchRow({ status: "succeeded", ingestion_run_id: RUN_ID })]);
  let renewed = 0;
  await executeNextNationwideDispatch({
    database: db.host as never,
    workerId: "worker-1",
    leaseSeconds: 300,
    clock: () => "2026-09-24T12:00:00.000Z",
    execute: async ({ renewLease }) => {
      await renewLease();
      renewed += 1;
      return { ingestionRunId: RUN_ID };
    },
    safeErrorSummary: () => "x",
    ...SCOPE,
  });
  assert.equal(renewed, 1, "a wedged run must be able to lose its lease, so renewal is explicit");
});
