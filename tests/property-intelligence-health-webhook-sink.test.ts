// Contract for the health-alert webhook sink, ported from
// property-intelligence-app's app/lib/nationwide-health-webhook-sink.ts.
//
// This sink is the one place nationwide health incidents leave the system, so
// what the tests pin is the egress discipline: a configured HTTPS endpoint, a
// bearer token, a durable idempotency key on every delivery, a bounded
// timeout, no redirect following, and a non-2xx treated as a failure so the
// outbox retries rather than marking the alert delivered.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createNationwideHealthWebhookSink } from "../src/lib/property-intelligence/nationwide-health-webhook-sink.ts";
import type { NationwideHealthNotification } from "../src/lib/property-intelligence/nationwide-ingestion-health-delivery.ts";

const notification = {
  incidentId: randomUUID(),
  sourceDefinitionId: randomUUID(),
  sourceKey: "mo_st_louis_lra_inventory_v1",
  contractVersion: 3,
  stateCode: "MO",
  countyFips: "29510",
  transition: "opened",
  alertCode: "source_overdue",
  severity: "warning",
  observed: "no successful run in 9 days",
  expected: "a successful run every 7 days",
  snapshotAsOf: "2026-09-24T12:00:00.000Z",
  claimCount: 1,
  enqueuedAt: "2026-09-24T12:00:00.000Z",
} as unknown as NationwideHealthNotification;

const ENDPOINT = "https://alerts.example.com/nationwide";
const TOKEN = "a".repeat(40);

function capturingFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("a delivery carries the bearer token, the idempotency key, and the event body", async () => {
  const { calls, impl } = capturingFetch(new Response("{}", { status: 200 }));
  const sink = createNationwideHealthWebhookSink({
    endpoint: ENDPOINT,
    bearerToken: TOKEN,
    fetchImpl: impl,
  });
  const idempotencyKey = randomUUID();
  await sink.deliver({ notification, idempotencyKey });

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, ENDPOINT);
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["authorization"], `Bearer ${TOKEN}`);
  assert.equal(headers["idempotency-key"], idempotencyKey);
  assert.equal(
    call.init.redirect,
    "error",
    "a redirect could send the alert and its bearer token to another host",
  );

  const body = JSON.parse(String(call.init.body));
  assert.equal(body.eventType, "accountabul.nationwide_ingestion_health");
  assert.equal(body.idempotencyKey, idempotencyKey, "the outbox row identity travels in the body");
  assert.equal(body.incidentId, notification.incidentId);
  assert.equal(body.alertCode, "source_overdue");
  assert.equal(body.severity, "warning");
});

test("a delivery without a durable idempotency key is refused before any request", async () => {
  const { calls, impl } = capturingFetch(new Response("{}", { status: 200 }));
  const sink = createNationwideHealthWebhookSink({
    endpoint: ENDPOINT,
    bearerToken: TOKEN,
    fetchImpl: impl,
  });
  await assert.rejects(
    sink.deliver({ notification, idempotencyKey: "not-a-uuid" }),
    /durable outbox idempotency key/i,
  );
  assert.equal(calls.length, 0, "nothing is sent without a valid key");
});

test("a non-2xx response fails the delivery so the outbox retries", async () => {
  const { impl } = capturingFetch(new Response("nope", { status: 500 }));
  const sink = createNationwideHealthWebhookSink({
    endpoint: ENDPOINT,
    bearerToken: TOKEN,
    fetchImpl: impl,
  });
  await assert.rejects(sink.deliver({ notification, idempotencyKey: randomUUID() }), /HTTP 500/);
});

test("the endpoint and token are validated when the sink is built", () => {
  const { impl } = capturingFetch(new Response("{}", { status: 200 }));
  assert.throws(
    () =>
      createNationwideHealthWebhookSink({
        endpoint: "http://alerts.example.com/nationwide",
        bearerToken: TOKEN,
        fetchImpl: impl,
      }),
    /https/i,
    "an alert carrying a bearer token may not be sent over plaintext",
  );
  assert.throws(
    () =>
      createNationwideHealthWebhookSink({ endpoint: ENDPOINT, bearerToken: "  ", fetchImpl: impl }),
    /token/i,
  );
});

test("the timeout is bounded to a sane range", () => {
  const { impl } = capturingFetch(new Response("{}", { status: 200 }));
  assert.throws(
    () =>
      createNationwideHealthWebhookSink({
        endpoint: ENDPOINT,
        bearerToken: TOKEN,
        timeoutMillis: 1,
        fetchImpl: impl,
      }),
    /between 1000 and 60000/,
  );
});
