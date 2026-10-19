import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  getStripeTipId,
  parseStripeEvent,
  planTipTransition,
  verifyStripeSignature,
  type StripeEvent,
  type TipForReconciliation,
} from "../src/lib/stripe-webhook.ts";

test("does not mistake non-tip Checkout references for tip IDs", () => {
  assert.equal(
    getStripeTipId({
      id: "evt_membership",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user-or-payment-id",
          metadata: { accountabul_kind: "membership" },
        },
      },
    }),
    null,
  );
});

const nowMs = Date.UTC(2026, 7, 8, 12, 0, 0);
const timestamp = Math.floor(nowMs / 1000);
const secret = "whsec_test";
const payload = JSON.stringify({ id: "evt_1", type: "test.event", data: { object: {} } });

test("accepts any valid v1 signature inside the tolerance", async () => {
  const valid = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const header = `t=${timestamp},v1=${"0".repeat(64)},v1=${valid}`;

  assert.equal(await verifyStripeSignature(payload, header, secret, { nowMs }), true);
});

test("rejects a signature whose length does not match the digest", async () => {
  const valid = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  assert.equal(
    await verifyStripeSignature(payload, `t=${timestamp},v1=${valid.slice(0, 32)}`, secret, {
      nowMs,
    }),
    false,
  );
  assert.equal(
    await verifyStripeSignature(payload, `t=${timestamp},v1=${valid}aa`, secret, { nowMs }),
    false,
  );
});

test("rejects a valid but stale signature", async () => {
  const staleTimestamp = timestamp - 301;
  const valid = createHmac("sha256", secret).update(`${staleTimestamp}.${payload}`).digest("hex");

  assert.equal(
    await verifyStripeSignature(payload, `t=${staleTimestamp},v1=${valid}`, secret, {
      nowMs,
    }),
    false,
  );
});

test("rejects malformed Stripe event envelopes", () => {
  assert.throws(() => parseStripeEvent("{}"), /envelope/);
  assert.throws(() => parseStripeEvent("not json"), /JSON/);
});

test("plans a paid transition only for a matching paid Checkout Session", () => {
  const tip = buildTip();
  const event = buildCheckoutEvent();

  assert.deepEqual(planTipTransition(event, tip), {
    status: "paid",
    allowedCurrentStatuses: ["created", "processing", "failed"],
  });

  assert.throws(
    () =>
      planTipTransition(
        { ...event, data: { object: { ...event.data.object, amount_total: 999 } } },
        tip,
      ),
    /does not match/,
  );
});

test("never lets a late paid event overwrite a refunded tip", () => {
  assert.equal(planTipTransition(buildCheckoutEvent(), buildTip({ status: "refunded" })), null);
});

test("waits for an async event when Checkout completes unpaid", () => {
  const event = buildCheckoutEvent({ payment_status: "unpaid" });
  assert.equal(planTipTransition(event, buildTip()), null);
});

function buildTip(overrides: Partial<TipForReconciliation> = {}): TipForReconciliation {
  return {
    id: "tip_1",
    amount_minor: 2500,
    currency: "USD",
    provider_record_id: "cs_1",
    status: "processing",
    ...overrides,
  };
}

function buildCheckoutEvent(object: Record<string, unknown> = {}): StripeEvent {
  return {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        amount_total: 2500,
        currency: "usd",
        payment_status: "paid",
        client_reference_id: "tip_1",
        ...object,
      },
    },
  };
}
