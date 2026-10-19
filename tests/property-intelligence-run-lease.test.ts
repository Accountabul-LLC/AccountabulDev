// Contract for the ingestion-run lease and state accessors, ported from
// property-intelligence-app's app/lib/nationwide-postgres-run-store.ts.
//
// The lease is the concurrency control for the ingestion workers. What matters
// is that two workers racing the same run cannot both win: the UPDATE only
// matches an unfinalized run that is unleased, already held by the same owner
// (so a retry is idempotent), or whose lease has expired. The loser is told
// who holds it rather than proceeding in parallel and double-writing batches.
//
// Exercised against an in-memory fake modeling property_ingest.ingestion_runs,
// matching this repo's convention for database-backed nationwide modules.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  claimSnapshotIngestionRunLease,
  getSnapshotIngestionRunState,
} from "../src/lib/property-intelligence/nationwide-postgres-run-store.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

type RunRow = {
  id: string;
  completed_at: string | null;
  coverage_status: string;
  lease_owner: string | null;
  lease_acquired_at: string | null;
  lease_expires_at: string | null;
};

class FakeRunStore implements PostgresTransactionHost {
  run: RunRow;

  constructor(run: RunRow) {
    this.run = run;
  }

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();
        const rows = (value: unknown[]) => ({ rows: value as Row[] });

        if (n.startsWith("update property_ingest.ingestion_runs")) {
          const [runId, owner, acquiredAt, expiresAt] = params as [string, string, string, string];
          const run = this.run;
          const claimable =
            run.id === runId &&
            run.completed_at === null &&
            (run.lease_owner === null ||
              run.lease_owner === owner ||
              (run.lease_expires_at !== null && run.lease_expires_at <= acquiredAt));
          if (!claimable) return rows([]);
          run.lease_owner = owner;
          run.lease_acquired_at = acquiredAt;
          run.lease_expires_at = expiresAt;
          return rows([
            {
              id: run.id,
              lease_owner: owner,
              lease_acquired_at: acquiredAt,
              lease_expires_at: expiresAt,
            },
          ]);
        }

        if (n.startsWith("select completed_at, lease_owner, lease_expires_at")) {
          const [runId] = params as [string];
          if (runId !== this.run.id) return rows([]);
          return rows([
            {
              completed_at: this.run.completed_at,
              lease_owner: this.run.lease_owner,
              lease_expires_at: this.run.lease_expires_at,
            },
          ]);
        }

        if (n.startsWith("select id, completed_at, coverage_status")) {
          const [runId] = params as [string];
          if (runId !== this.run.id) return rows([]);
          return rows([
            {
              id: this.run.id,
              completed_at: this.run.completed_at,
              coverage_status: this.run.coverage_status,
            },
          ]);
        }

        throw new Error(`unexpected SQL in fake run store: ${n.slice(0, 100)}`);
      },
    });
  }
}

const RUN_ID = randomUUID();
const ACQUIRED = "2026-09-24T12:00:00.000Z";
const EXPIRES = "2026-09-24T12:15:00.000Z";

function openRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    completed_at: null,
    coverage_status: "pending",
    lease_owner: null,
    lease_acquired_at: null,
    lease_expires_at: null,
    ...overrides,
  };
}

test("an unleased run can be claimed", async () => {
  const database = new FakeRunStore(openRun());
  const lease = await claimSnapshotIngestionRunLease(database, {
    runId: RUN_ID,
    leaseOwner: "worker-a",
    acquiredAt: ACQUIRED,
    expiresAt: EXPIRES,
  });
  assert.equal(lease.runId, RUN_ID);
  assert.equal(lease.leaseOwner, "worker-a");
  assert.equal(lease.leaseExpiresAt, EXPIRES);
});

test("a second worker cannot steal a live lease and is told who holds it", async () => {
  const database = new FakeRunStore(openRun());
  await claimSnapshotIngestionRunLease(database, {
    runId: RUN_ID,
    leaseOwner: "worker-a",
    acquiredAt: ACQUIRED,
    expiresAt: EXPIRES,
  });

  await assert.rejects(
    claimSnapshotIngestionRunLease(database, {
      runId: RUN_ID,
      leaseOwner: "worker-b",
      acquiredAt: "2026-09-24T12:05:00.000Z",
      expiresAt: "2026-09-24T12:20:00.000Z",
    }),
    /leased by worker-a until/i,
  );
  assert.equal(database.run.lease_owner, "worker-a", "the live lease is untouched");
});

test("the same worker re-claiming is idempotent, so a retry is safe", async () => {
  const database = new FakeRunStore(openRun());
  await claimSnapshotIngestionRunLease(database, {
    runId: RUN_ID,
    leaseOwner: "worker-a",
    acquiredAt: ACQUIRED,
    expiresAt: EXPIRES,
  });
  const renewed = await claimSnapshotIngestionRunLease(database, {
    runId: RUN_ID,
    leaseOwner: "worker-a",
    acquiredAt: "2026-09-24T12:10:00.000Z",
    expiresAt: "2026-09-24T12:25:00.000Z",
  });
  assert.equal(renewed.leaseExpiresAt, "2026-09-24T12:25:00.000Z");
});

test("an expired lease may be taken over", async () => {
  const database = new FakeRunStore(
    openRun({
      lease_owner: "worker-a",
      lease_acquired_at: "2026-09-24T11:00:00.000Z",
      lease_expires_at: "2026-09-24T11:15:00.000Z",
    }),
  );
  const lease = await claimSnapshotIngestionRunLease(database, {
    runId: RUN_ID,
    leaseOwner: "worker-b",
    acquiredAt: ACQUIRED,
    expiresAt: EXPIRES,
  });
  assert.equal(lease.leaseOwner, "worker-b");
});

test("a finalized run can never be leased again", async () => {
  const database = new FakeRunStore(
    openRun({ completed_at: "2026-09-24T11:30:00.000Z", coverage_status: "complete" }),
  );
  await assert.rejects(
    claimSnapshotIngestionRunLease(database, {
      runId: RUN_ID,
      leaseOwner: "worker-a",
      acquiredAt: ACQUIRED,
      expiresAt: EXPIRES,
    }),
    /finalized ingestion run cannot be leased/i,
  );
});

test("a lease must actually span time", async () => {
  const database = new FakeRunStore(openRun());
  await assert.rejects(
    claimSnapshotIngestionRunLease(database, {
      runId: RUN_ID,
      leaseOwner: "worker-a",
      acquiredAt: ACQUIRED,
      expiresAt: ACQUIRED,
    }),
    /expiresAt must follow acquiredAt/i,
  );
});

test("run state reports completion and coverage", async () => {
  const pending = new FakeRunStore(openRun());
  assert.deepEqual(await getSnapshotIngestionRunState(pending, RUN_ID), {
    runId: RUN_ID,
    completedAt: null,
    coverageStatus: "pending",
  });

  const finished = new FakeRunStore(
    openRun({ completed_at: "2026-09-24T11:30:00.000Z", coverage_status: "complete" }),
  );
  const state = await getSnapshotIngestionRunState(finished, RUN_ID);
  assert.equal(state.completedAt, "2026-09-24T11:30:00.000Z");
  assert.equal(state.coverageStatus, "complete");
});

test("an unknown run id is rejected rather than silently reported as pending", async () => {
  const database = new FakeRunStore(openRun());
  await assert.rejects(
    getSnapshotIngestionRunState(database, randomUUID()),
    /does not identify an ingestion run/i,
  );
});
