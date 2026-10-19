// Slice 4 of the nationwide multi-state ingestion port. Exercises the
// dispatch lifecycle (claim -> complete/fail -> retry) against a
// hand-written, in-memory fake PostgresTransactionHost modeling
// property_ingest.ingestion_dispatches and source_definitions. Never a
// network connection, never a real or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  claimNextNationwideDispatch,
  completeNationwideDispatch,
  failNationwideDispatch,
  retryFailedNationwideDispatch,
} from "../src/lib/property-intelligence/nationwide-postgres-dispatch-store.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

type DispatchRow = {
  id: string;
  source_definition_id: string;
  scheduled_for: string;
  attempt: number;
  status: "queued" | "claimed" | "succeeded" | "failed" | "cancelled";
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

const SOURCE_DEFINITION_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_KEY = "ms_rankin_county_tax_sale_report_v1";
const CONTRACT_VERSION = 1;

class FakeDispatchDatabase implements PostgresTransactionHost {
  dispatches: DispatchRow[] = [];

  seed(overrides: Partial<DispatchRow> = {}) {
    const row: DispatchRow = {
      id: randomUUID(),
      source_definition_id: SOURCE_DEFINITION_ID,
      scheduled_for: "2026-09-24T00:00:00.000Z",
      attempt: 1,
      status: "queued",
      available_at: "2026-09-24T00:00:00.000Z",
      enqueued_at: "2026-09-24T00:00:00.000Z",
      claim_count: 0,
      lease_owner: null,
      lease_acquired_at: null,
      lease_expires_at: null,
      completed_at: null,
      ingestion_run_id: null,
      retry_of_dispatch_id: null,
      error_summary: null,
      ...overrides,
    };
    this.dispatches.push(row);
    return row;
  }

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const normalized = sql.replace(/\s+/g, " ").trim();
        const columns = (row: DispatchRow) => ({
          dispatch_id: row.id,
          source_definition_id: row.source_definition_id,
          source_key: SOURCE_KEY,
          contract_version: CONTRACT_VERSION,
          scheduled_for: row.scheduled_for,
          attempt: row.attempt,
          status: row.status,
          available_at: row.available_at,
          enqueued_at: row.enqueued_at,
          claim_count: row.claim_count,
          lease_owner: row.lease_owner,
          lease_acquired_at: row.lease_acquired_at,
          lease_expires_at: row.lease_expires_at,
          completed_at: row.completed_at,
          ingestion_run_id: row.ingestion_run_id,
          retry_of_dispatch_id: row.retry_of_dispatch_id,
          error_summary: row.error_summary,
        });

        if (normalized.startsWith("with candidate as (")) {
          const [workerId, acquiredAt, expiresAt] = params as [string, string, string];
          const candidate = this.dispatches
            .filter(
              (row) =>
                (row.status === "queued" && row.available_at <= acquiredAt) ||
                (row.status === "claimed" &&
                  row.lease_expires_at !== null &&
                  row.lease_expires_at <= acquiredAt),
            )
            .sort(
              (left, right) =>
                left.scheduled_for.localeCompare(right.scheduled_for) ||
                left.attempt - right.attempt,
            )[0];
          if (!candidate) return { rows: [] } as PostgresQueryResult<Row>;
          candidate.status = "claimed";
          candidate.claim_count += 1;
          candidate.lease_owner = workerId;
          candidate.lease_acquired_at = acquiredAt;
          candidate.lease_expires_at = expiresAt;
          return { rows: [columns(candidate)] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "update property_ingest.ingestion_dispatches dispatch set status = 'succeeded'",
          )
        ) {
          const [dispatchId, workerId, completedAt, ingestionRunId] = params as [
            string,
            string,
            string,
            string,
          ];
          const row = this.dispatches.find(
            (candidate) =>
              candidate.id === dispatchId &&
              candidate.status === "claimed" &&
              candidate.lease_owner === workerId,
          );
          if (!row) return { rows: [] } as PostgresQueryResult<Row>;
          row.status = "succeeded";
          row.completed_at = completedAt;
          row.ingestion_run_id = ingestionRunId;
          row.lease_owner = null;
          row.lease_acquired_at = null;
          row.lease_expires_at = null;
          return { rows: [columns(row)] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "update property_ingest.ingestion_dispatches dispatch set status = 'failed'",
          )
        ) {
          const [dispatchId, workerId, completedAt, errorSummary] = params as [
            string,
            string,
            string,
            string,
          ];
          const row = this.dispatches.find(
            (candidate) =>
              candidate.id === dispatchId &&
              candidate.status === "claimed" &&
              candidate.lease_owner === workerId,
          );
          if (!row) return { rows: [] } as PostgresQueryResult<Row>;
          row.status = "failed";
          row.completed_at = completedAt;
          row.error_summary = errorSummary;
          row.lease_owner = null;
          row.lease_acquired_at = null;
          row.lease_expires_at = null;
          return { rows: [columns(row)] } as unknown as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith("select") &&
          normalized.includes("from property_ingest.ingestion_dispatches dispatch") &&
          normalized.includes("where dispatch.id = $1 and dispatch.status = 'failed'")
        ) {
          const [dispatchId] = params as [string];
          const row = this.dispatches.find(
            (candidate) => candidate.id === dispatchId && candidate.status === "failed",
          );
          if (!row) return { rows: [] } as PostgresQueryResult<Row>;
          return { rows: [columns(row)] } as unknown as PostgresQueryResult<Row>;
        }

        if (normalized.startsWith("insert into property_ingest.ingestion_dispatches")) {
          const [
            sourceDefinitionId,
            scheduledFor,
            attempt,
            availableAt,
            enqueuedAt,
            retryOfDispatchId,
            sourceKey,
            contractVersion,
          ] = params as [string, string, number, string, string, string, string, number];
          const row = this.seed({
            source_definition_id: sourceDefinitionId,
            scheduled_for: scheduledFor,
            attempt,
            status: "queued",
            available_at: availableAt,
            enqueued_at: enqueuedAt,
            retry_of_dispatch_id: retryOfDispatchId,
          });
          return {
            rows: [{ ...columns(row), source_key: sourceKey, contract_version: contractVersion }],
          } as unknown as PostgresQueryResult<Row>;
        }

        throw new Error(`FakeDispatchDatabase: unmodeled query: ${normalized.slice(0, 100)}`);
      },
    });
  }
}

test("Slice 4: dispatch claiming is atomic and idempotent -- a second claim finds nothing left", async () => {
  const database = new FakeDispatchDatabase();
  database.seed();

  const first = await claimNextNationwideDispatch(database, {
    workerId: "worker-a",
    acquiredAt: "2026-09-24T00:01:00.000Z",
    leaseSeconds: 300,
  });
  assert.ok(first);
  assert.equal(first?.status, "claimed");

  const second = await claimNextNationwideDispatch(database, {
    workerId: "worker-b",
    acquiredAt: "2026-09-24T00:01:00.000Z",
    leaseSeconds: 300,
  });
  assert.equal(second, null);
});

test("Slice 4: claiming picks the earliest scheduled_for, then the lowest attempt", async () => {
  const database = new FakeDispatchDatabase();
  database.seed({ scheduled_for: "2026-09-24T02:00:00.000Z" });
  const earliest = database.seed({ scheduled_for: "2026-09-24T00:00:00.000Z" });
  database.seed({ scheduled_for: "2026-09-24T01:00:00.000Z" });

  const claimed = await claimNextNationwideDispatch(database, {
    workerId: "worker-a",
    acquiredAt: "2026-09-24T03:00:00.000Z",
    leaseSeconds: 300,
  });
  assert.equal(claimed?.dispatchId, earliest.id);
});

test("Slice 4: complete/fail transitions require the current lease owner and are terminal", async () => {
  const database = new FakeDispatchDatabase();
  database.seed();
  const claimed = await claimNextNationwideDispatch(database, {
    workerId: "worker-a",
    acquiredAt: "2026-09-24T00:01:00.000Z",
    leaseSeconds: 300,
  });
  assert.ok(claimed);

  await assert.rejects(
    completeNationwideDispatch(database, {
      dispatchId: claimed!.dispatchId,
      workerId: "someone-else",
      ingestionRunId: randomUUID(),
      completedAt: "2026-09-24T00:02:00.000Z",
    }),
    /missing, not claimed, or owned by another worker/,
  );

  const completed = await completeNationwideDispatch(database, {
    dispatchId: claimed!.dispatchId,
    workerId: "worker-a",
    ingestionRunId: randomUUID(),
    completedAt: "2026-09-24T00:02:00.000Z",
  });
  assert.equal(completed.status, "succeeded");
});

test("Slice 4: a failed dispatch can be retried exactly once into a new bounded attempt", async () => {
  const database = new FakeDispatchDatabase();
  database.seed();
  const claimed = await claimNextNationwideDispatch(database, {
    workerId: "worker-a",
    acquiredAt: "2026-09-24T00:01:00.000Z",
    leaseSeconds: 300,
  });
  await failNationwideDispatch(database, {
    dispatchId: claimed!.dispatchId,
    workerId: "worker-a",
    completedAt: "2026-09-24T00:02:00.000Z",
    errorSummary: "upstream timed out",
  });

  const retry = await retryFailedNationwideDispatch(database, {
    dispatchId: claimed!.dispatchId,
    availableAt: "2026-09-24T00:10:00.000Z",
    enqueuedAt: "2026-09-24T00:10:00.000Z",
  });
  assert.equal(retry.attempt, 2);
  assert.equal(retry.retryOfDispatchId, claimed!.dispatchId);
  assert.equal(retry.status, "queued");
});
