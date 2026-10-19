import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  hasActiveMembership,
  resolveEventEntitlement,
  type EventAccessMode,
  type MembershipStatus,
} from "../src/lib/conference/entitlements.ts";
import { screenDeterministically, sha256Text } from "../src/lib/conference/moderation.ts";
import { normalizeRestreamMessage, restreamDedupeKey } from "../src/lib/conference/restream.ts";
import {
  createProtectedSpeakerLink,
  decryptSpeakerLink,
} from "../src/lib/conference/speaker-links.server.ts";
import { authorizeOperationsRequest } from "../src/lib/operations/auth.ts";
import {
  getPaymentRecordOutcome,
  verifyStripeSignature,
  type PaymentRecordForReconciliation,
  type StripeEvent,
} from "../src/lib/stripe-webhook.ts";

const random = seededRandom(0xacc0_0fab);

test("fuzz: entitlement outputs preserve access and speaker invariants", () => {
  const modes: EventAccessMode[] = ["public", "subscriber", "subscriber_or_pass"];
  const statuses: MembershipStatus[] = [
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ];
  const now = new Date("2026-08-26T12:00:00.000Z");

  for (let index = 0; index < 2_000; index += 1) {
    const accessMode = pick(modes);
    const status = pick(statuses);
    const hasActivePass = random() > 0.5;
    const future = random() > 0.5;
    const membership = {
      status,
      currentPeriodEnd: future ? "2026-08-27T12:00:00.000Z" : "2026-08-25T12:00:00.000Z",
      graceExpiresAt: future ? "2026-08-29T12:00:00.000Z" : "2026-08-26T11:59:59.000Z",
    };
    const result = resolveEventEntitlement({ accessMode, membership, hasActivePass, now });

    if (result.canRequestSpeaker) {
      assert.equal(result.canWatch, true);
      assert.equal(result.canComment, true);
      assert.equal(result.canTakeStage, true);
      assert.equal(result.source, "membership");
    }
    if (result.source === "pass") {
      assert.equal(result.canWatch, true);
      assert.equal(result.canComment, true);
      assert.equal(result.canTakeStage, true);
      assert.equal(result.canRequestSpeaker, false);
      assert.equal(accessMode === "public" || accessMode === "subscriber_or_pass", true);
    }
    if (result.canComment) {
      assert.equal(result.canWatch, true);
      assert.equal(result.canTakeStage, true);
      assert.ok(result.source === "membership" || result.source === "pass");
    }
    if (result.canTakeStage) {
      assert.equal(result.canComment, true);
      assert.equal(result.canWatch, true);
    }
    if (accessMode === "public") assert.equal(result.canWatch, true);
    if (accessMode === "subscriber" && !hasActiveMembership(membership, now)) {
      assert.equal(result.canWatch, false);
    }
  }
});

test("fuzz: moderation normalization is deterministic and hashes immutable text", async () => {
  const alphabet = " abcXYZ0123\t\n!@#$%^&*()[]{}éＥＸＡＭＰＬＥ";
  for (let index = 0; index < 750; index += 1) {
    const value = randomString(alphabet, Math.floor(random() * 700));
    const first = screenDeterministically(value);
    const second = screenDeterministically(value);
    assert.deepEqual(first, second);
    assert.equal(first.allowed, first.reasons.length === 0);
    assert.equal(new Set(first.reasons).size, first.reasons.length);
    assert.equal(await sha256Text(value), await sha256Text(value.normalize("NFKC")));
  }

  assert.equal(screenDeterministically("ｈｔｔｐｓ://spam.example").allowed, false);
});

test("fuzz: operations bearer authentication never accepts an unequal secret", () => {
  const expected = "a".repeat(64);
  for (let index = 0; index < 2_000; index += 1) {
    const supplied = randomString("abcdefghijklmnopqrstuvwxyz0123456789", 1 + (index % 96));
    if (supplied === expected) continue;
    const result = authorizeOperationsRequest(
      new Request("https://accountabul.test", {
        headers: { authorization: `Bearer ${supplied}` },
      }),
      expected,
    );
    assert.equal(result.ok, false);
  }
});

test("fuzz: Stripe reconciliation rejects every mutated payment binding", () => {
  const payment: PaymentRecordForReconciliation = {
    id: "payment-1",
    amount_minor: 100,
    currency: "USD",
    checkout_session_id: "cs_accountabul",
    status: "processing",
  };
  const baseObject = {
    id: payment.checkout_session_id,
    amount_total: payment.amount_minor,
    currency: "usd",
    payment_status: "paid",
  };

  for (let index = 0; index < 750; index += 1) {
    const mutation = index % 3;
    const object = {
      ...baseObject,
      ...(mutation === 0 ? { id: `cs_wrong_${index}` } : {}),
      ...(mutation === 1 ? { amount_total: 101 + index } : {}),
      ...(mutation === 2 ? { currency: `x${index}` } : {}),
    };
    const event: StripeEvent = {
      id: `evt_${index}`,
      type: "checkout.session.completed",
      data: { object },
    };
    assert.throws(() => getPaymentRecordOutcome(event, payment), /does not match/);
  }

  const valid: StripeEvent = {
    id: "evt_valid",
    type: "checkout.session.completed",
    data: { object: baseObject },
  };
  assert.deepEqual(getPaymentRecordOutcome(valid, { ...payment, status: "paid" }), {
    status: "paid",
  });
});

test("fuzz: Stripe signature parsing rejects malformed headers and accepts one valid v1", async () => {
  const nowMs = Date.UTC(2026, 7, 26, 12, 0, 0);
  const timestamp = Math.floor(nowMs / 1_000);
  const secret = "webhook-test-secret";
  const payload = JSON.stringify({ id: "evt_fuzz", type: "test", data: { object: {} } });
  const valid = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  for (let index = 0; index < 250; index += 1) {
    const malformed = randomString("tv1=,0123456789abcdef", 1 + (index % 128));
    assert.equal(await verifyStripeSignature(payload, malformed, secret, { nowMs }), false);
  }
  assert.equal(
    await verifyStripeSignature(payload, `garbage=1,t=${timestamp},v1=bad,v1=${valid}`, secret, {
      nowMs,
    }),
    true,
  );
});

test("fuzz: Restream normalization remains stable and distinguishes external IDs", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 1_000; index += 1) {
    const message = normalizeRestreamMessage({
      id: `external-${index}`,
      eventId: `event-${index % 7}`,
      text: ` Message ${index} `,
      createdAt: new Date(1_788_220_800_000 + index).toISOString(),
      platform: pick(["YouTube", "Facebook", "LinkedIn", "Twitch", "X", "Unknown"]),
    });
    const key = restreamDedupeKey(message);
    assert.equal(seen.has(key), false);
    seen.add(key);
    assert.equal(message.body, `Message ${index}`);
  }
});

test("security: speaker links allow only HTTPS Restream hosts and reject tampering", async () => {
  const previous = process.env["SPEAKER_LINK_SECRET"];
  process.env["SPEAKER_LINK_SECRET"] = Buffer.alloc(32, 9).toString("base64");
  try {
    await assert.rejects(createProtectedSpeakerLink("https://restream.io.evil.test/guest"));
    await assert.rejects(createProtectedSpeakerLink("http://restream.io/guest"));

    const protectedLink = await createProtectedSpeakerLink("https://guest.restream.io/room/abc");
    assert.equal(
      await decryptSpeakerLink(protectedLink.ciphertext, protectedLink.iv),
      "https://guest.restream.io/room/abc",
    );
    const firstCharacter = protectedLink.ciphertext[0];
    const tampered = `${firstCharacter === "A" ? "B" : "A"}${protectedLink.ciphertext.slice(1)}`;
    await assert.rejects(decryptSpeakerLink(tampered, protectedLink.iv));
  } finally {
    if (previous === undefined) delete process.env["SPEAKER_LINK_SECRET"];
    else process.env["SPEAKER_LINK_SECRET"] = previous;
  }
});

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function randomString(alphabet: string, length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += pick(alphabet);
  return value;
}
