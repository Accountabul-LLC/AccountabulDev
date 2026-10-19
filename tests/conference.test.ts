import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import {
  EVENT_PASS_TTL_MS,
  eventPassExpiresAt,
  eventPassIsActive,
  hasActiveMembership,
  highestPassAccessType,
  resolveEventEntitlement,
} from "../src/lib/conference/entitlements.ts";
import {
  canHostLiveStudio,
  eventIsPublicLive,
  greenRoomIsReady,
  hostStudioPath,
  hostStudioUrl,
} from "../src/lib/conference/studio.ts";
import {
  LIVE_COUNTDOWN_MS,
  canBeginCountdown,
  canEndStream,
  canGoLive,
  countdownIsComplete,
  countdownRemainingMs,
  countdownSecondsLeft,
  countdownTargetFrom,
  commenterIsInvitable,
  isRemovedFromEvent,
  livePhase,
  opsStatusChangeAllowed,
  participantIdentity,
  viewerMayJoinMedia,
} from "../src/lib/conference/live-session.ts";
import {
  alertDedupeKey,
  buildAlertMessage,
  buildHopOnMessage,
  buildScheduledMessage,
  channelsFor,
  isAlertEligible,
  liveEventUrl,
  normalizeAlertPreferences,
  selectAlertRecipients,
  smsChannelOpen,
  type AlertCandidate,
} from "../src/lib/live/alerts.ts";
import {
  ASSISTANT_MAX_QUESTION,
  ASSISTANT_MAX_TURNS,
  assistantIsConfigured,
  buildSystemPrompt,
  normalizeQuestion,
  trimHistory,
  type AssistantTurn,
} from "../src/lib/live/assistant.ts";
import { DEAL_DEFAULTS, calculateDeal, monthlyPayment } from "../src/lib/tools/deal-calculator.ts";
import {
  canCreatePaidCommentCheckout,
  isApprovedPaidCommentPrice,
  screenDeterministically,
  sha256Text,
} from "../src/lib/conference/moderation.ts";
import { speakerJoinPath } from "../src/lib/conference/speaker-join.ts";
import { normalizeRestreamMessage, restreamDedupeKey } from "../src/lib/conference/restream.ts";
import { authorizeOperationsRequest } from "../src/lib/operations/auth.ts";
import {
  hashOperationsPassword,
  verifyOperationsOperator,
} from "../src/lib/operations/operator-auth.server.ts";
import {
  parsePalisadeWebhook,
  verifyPalisadeWebhook,
} from "../src/lib/crypto/palisade-webhook.server.ts";
import {
  getPaymentRecordOutcome,
  planPaymentRecordTransition,
  type PaymentRecordForReconciliation,
  type StripeEvent,
} from "../src/lib/stripe-webhook.ts";
import {
  normalizeHistoryMessage,
  normalizeWebSocketAction,
  platformForEventSource,
} from "../workers/restream-chat-bridge/src/index.ts";

const now = new Date("2026-08-26T12:00:00.000Z");

test("public, subscriber, pass, and denied event access resolve independently", () => {
  const unsigned = resolveEventEntitlement({
    accessMode: "subscriber_or_pass",
    passAccessType: null,
    now,
  });
  assert.equal(unsigned.canWatch, false);
  assert.equal(unsigned.canComment, false);
  assert.equal(unsigned.canTakeStage, false);
  assert.equal(unsigned.canRequestSpeaker, false);
  assert.equal(unsigned.source, "none");

  const member = resolveEventEntitlement({
    accessMode: "subscriber_or_pass",
    passAccessType: null,
    membership: { status: "active", currentPeriodEnd: "2026-09-01T00:00:00Z" },
    now,
  });
  assert.equal(member.source, "membership");
  assert.equal(member.canWatch, true);
  assert.equal(member.canComment, true);
  assert.equal(member.canTakeStage, true);
  assert.equal(member.canRequestSpeaker, true);

  const pass = resolveEventEntitlement({
    accessMode: "subscriber_or_pass",
    passAccessType: "watch_and_chat",
    now,
  });
  assert.equal(pass.source, "pass");
  assert.equal(pass.canWatch, true);
  assert.equal(pass.canComment, true);
  assert.equal(pass.canTakeStage, true);
  assert.equal(pass.canRequestSpeaker, false);

  // A watch-only pass unlocks the video, not the room.
  const watchOnly = resolveEventEntitlement({
    accessMode: "subscriber_or_pass",
    passAccessType: "watch",
    now,
  });
  assert.equal(watchOnly.source, "pass");
  assert.equal(watchOnly.canWatch, true);
  assert.equal(watchOnly.canComment, false);
  assert.equal(watchOnly.canTakeStage, false);

  const publicGuest = resolveEventEntitlement({
    accessMode: "public",
    passAccessType: null,
    now,
  });
  assert.equal(publicGuest.canWatch, true);
  assert.equal(publicGuest.canComment, false);
  assert.equal(publicGuest.canTakeStage, false);

  const publicPass = resolveEventEntitlement({
    accessMode: "public",
    passAccessType: "watch_and_chat",
    now,
  });
  assert.equal(publicPass.canComment, true);
  assert.equal(publicPass.canTakeStage, true);
  assert.equal(publicPass.canRequestSpeaker, false);

  assert.equal(
    resolveEventEntitlement({
      accessMode: "subscriber",
      passAccessType: null,
      membership: { status: "active", currentPeriodEnd: "2026-09-01T00:00:00Z" },
      now,
    }).source,
    "membership",
  );
  assert.equal(
    resolveEventEntitlement({
      accessMode: "subscriber",
      passAccessType: "watch_and_chat",
      now,
    }).canWatch,
    false,
  );
});

test("the highest active pass wins, and a watch_and_chat pass never regresses to watch", () => {
  assert.equal(highestPassAccessType([]), null);
  assert.equal(highestPassAccessType(["watch"]), "watch");
  assert.equal(highestPassAccessType(["watch", "watch_and_chat"]), "watch_and_chat");
  assert.equal(highestPassAccessType(["watch_and_chat", "watch"]), "watch_and_chat");
});

test("failed-renewal grace is active for three days and then expires", () => {
  const subscription = { status: "past_due" as const, graceExpiresAt: "2026-08-29T11:59:59Z" };
  assert.equal(hasActiveMembership(subscription, now), true);
  assert.equal(hasActiveMembership(subscription, new Date("2026-08-29T12:00:00Z")), false);
  assert.equal(hasActiveMembership({ status: "canceled" }, now), false);
});

test("active membership without a period end is not entitled", () => {
  assert.equal(hasActiveMembership({ status: "active" }, now), false);
  assert.equal(hasActiveMembership({ status: "trialing", currentPeriodEnd: null }, now), false);
  assert.equal(
    hasActiveMembership({ status: "active", currentPeriodEnd: "2026-08-26T11:59:59Z" }, now),
    false,
  );
  assert.equal(
    hasActiveMembership({ status: "active", currentPeriodEnd: "2026-08-26T12:00:01Z" }, now),
    true,
  );
});

test("event pass without a future expiry is not entitled", () => {
  assert.equal(eventPassIsActive(null, now), false);
  assert.equal(eventPassIsActive(undefined, now), false);
  assert.equal(eventPassIsActive("2026-08-26T11:59:59Z", now), false);
  assert.equal(eventPassIsActive("2026-08-26T12:00:01Z", now), true);
  assert.equal(EVENT_PASS_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(new Date(eventPassExpiresAt(now)).getTime() - now.getTime(), EVENT_PASS_TTL_MS);
});

test("deterministic screening catches spam, links, threats, and length", () => {
  assert.equal(screenDeterministically("A useful comment").allowed, true);
  assert.deepEqual(screenDeterministically("Buy now at https://spam.example").reasons.sort(), [
    "links",
    "spam",
  ]);
  assert.equal(screenDeterministically("I will kill you").allowed, false);
  assert.equal(screenDeterministically("x".repeat(501)).allowed, false);
});

test("paid comment checkout requires approved immutable text and a live approval", async () => {
  const hash = await sha256Text("Exact comment");
  assert.equal(
    canCreatePaidCommentCheckout({
      status: "approved",
      bodySha256: hash,
      approvedBodySha256: hash,
      expiresAt: "2026-08-26T12:30:00Z",
      now,
    }),
    true,
  );
  assert.equal(
    canCreatePaidCommentCheckout({
      status: "approved",
      bodySha256: hash,
      approvedBodySha256: await sha256Text("Edited comment"),
      expiresAt: "2026-08-26T12:30:00Z",
      now,
    }),
    false,
  );
  assert.equal(
    canCreatePaidCommentCheckout({
      status: "approved",
      bodySha256: hash,
      approvedBodySha256: hash,
      expiresAt: "2026-08-26T11:59:59Z",
      now,
    }),
    false,
  );
  assert.equal(
    canCreatePaidCommentCheckout({
      status: "payment_failed",
      bodySha256: hash,
      approvedBodySha256: hash,
      expiresAt: "2026-08-26T11:59:59Z",
      now,
    }),
    false,
  );
  assert.equal(
    canCreatePaidCommentCheckout({
      status: "payment_failed",
      bodySha256: hash,
      approvedBodySha256: hash,
      expiresAt: "2026-08-26T12:30:00Z",
      now,
    }),
    true,
  );
});

test("paid comments are fixed at exactly one US dollar", () => {
  assert.equal(isApprovedPaidCommentPrice(100, "USD"), true);
  assert.equal(isApprovedPaidCommentPrice(100, "usd"), true);
  assert.equal(isApprovedPaidCommentPrice(100, "EUR"), false);
  assert.equal(isApprovedPaidCommentPrice(99, "USD"), false);
});

test("host studio is operator-only, private until live, and ready only after device checks", () => {
  assert.equal(canHostLiveStudio(["member"]), false);
  assert.equal(canHostLiveStudio(["admin"]), true);
  assert.equal(canHostLiveStudio(["moderator"]), true);
  assert.equal(hostStudioPath("town-hall"), "/live/town-hall/studio");
  assert.equal(
    hostStudioUrl("https://accountabul.com/", "town-hall"),
    "https://accountabul.com/live/town-hall/studio",
  );
  assert.equal(eventIsPublicLive("scheduled"), false);
  assert.equal(eventIsPublicLive("live"), true);
  assert.equal(greenRoomIsReady({ camera: "ok", mic: "ok", speaker: "idle" }), false);
  assert.equal(greenRoomIsReady({ camera: "fail", mic: "ok", speaker: "ok" }), false);
  assert.equal(greenRoomIsReady({ camera: "ok", mic: "ok", speaker: "ok" }), true);
});

test("speaker join path keeps the token out of the query string", () => {
  const path = speakerJoinPath("a0000001-0000-4000-8000-000000000001", "secret-token");
  assert.equal(path.includes("?token="), false);
  assert.equal(path.includes("&token="), false);
  assert.match(path, /^\/speakers\/join\?request=/);
  assert.match(path, /#secret-token$/);
});

test("Restream normalization creates a stable cross-provider dedupe key", () => {
  const message = normalizeRestreamMessage({
    id: "external-1",
    eventId: "event-1",
    text: " Hello room ",
    createdAt: "2026-08-26T12:00:00Z",
    platform: "YouTube",
    author: { name: "Viewer" },
  });
  assert.equal(message.source, "youtube");
  assert.equal(message.body, "Hello room");
  assert.equal(restreamDedupeKey(message), "event-1:youtube:external-1");
});

test("Restream bridge maps official source IDs and history records", async () => {
  assert.equal(platformForEventSource(13), "youtube");
  assert.equal(platformForEventSource(20), "facebook");
  assert.equal(platformForEventSource(26), "linkedin");
  assert.equal(platformForEventSource(28), "x");

  const live = await normalizeWebSocketAction(
    {
      action: "event",
      timestamp: 1_788_220_800,
      payload: {
        connectionIdentifier: "connection-1",
        eventIdentifier: "not-globally-unique",
        eventSourceId: 13,
        eventPayload: {
          text: "YouTube message",
          author: { displayName: "Viewer", avatar: "https://example.test/avatar.png" },
        },
      },
    },
    "event-1",
  );
  assert.equal(live?.source, "youtube");
  assert.equal(live?.authorDisplayName, "Viewer");

  const history = await normalizeHistoryMessage(
    {
      timestamp: "2026-08-26T12:00:00Z",
      platform: "LinkedIn",
      channelName: "Accountabul",
      author: "Guest",
      text: "Recovered message",
    },
    "event-1",
  );
  assert.equal(history?.source, "linkedin");
  assert.equal(history?.body, "Recovered message");
});

test("operations API rejects missing and incorrect secrets", () => {
  assert.equal(
    authorizeOperationsRequest(new Request("https://example.test"), "secret").status,
    401,
  );
  assert.equal(
    authorizeOperationsRequest(
      new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }),
      "secret",
    ).status,
    403,
  );
  assert.deepEqual(
    authorizeOperationsRequest(
      new Request("https://example.test", { headers: { authorization: "Bearer secret" } }),
      "secret",
    ),
    { ok: true },
  );
});

test("operations operator passwords are salted, verified, and reject incorrect input", async () => {
  const previousEmail = process.env["OPERATIONS_OPERATOR_EMAIL"];
  const previousHash = process.env["OPERATIONS_OPERATOR_PASSWORD_HASH"];
  const previousRole = process.env["OPERATIONS_OPERATOR_ROLE"];
  try {
    const hash = await hashOperationsPassword(
      "correct horse battery staple",
      new Uint8Array(16).fill(7),
    );
    process.env["OPERATIONS_OPERATOR_EMAIL"] = "operator@accountabul.example";
    process.env["OPERATIONS_OPERATOR_PASSWORD_HASH"] = hash;
    process.env["OPERATIONS_OPERATOR_ROLE"] = "moderator";

    const verified = await verifyOperationsOperator(
      "Operator@Accountabul.Example",
      "correct horse battery staple",
    );
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.operator.role, "moderator");
    assert.equal(
      (await verifyOperationsOperator("operator@accountabul.example", "incorrect")).ok,
      false,
    );
  } finally {
    restoreEnvironment("OPERATIONS_OPERATOR_EMAIL", previousEmail);
    restoreEnvironment("OPERATIONS_OPERATOR_PASSWORD_HASH", previousHash);
    restoreEnvironment("OPERATIONS_OPERATOR_ROLE", previousRole);
  }
});

test("payment reconciliation is amount-bound, idempotent, and terminal-status aware", () => {
  const payment: PaymentRecordForReconciliation = {
    id: "payment-1",
    amount_minor: 100,
    currency: "USD",
    checkout_session_id: "cs_1",
    status: "processing",
  };
  const event: StripeEvent = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: { id: "cs_1", amount_total: 100, currency: "usd", payment_status: "paid" },
    },
  };
  assert.deepEqual(planPaymentRecordTransition(event, payment), {
    status: "paid",
    allowedCurrentStatuses: ["created", "requires_action", "processing", "failed"],
  });
  assert.equal(planPaymentRecordTransition(event, { ...payment, status: "paid" }), null);
  assert.deepEqual(getPaymentRecordOutcome(event, { ...payment, status: "paid" }), {
    status: "paid",
  });
  assert.throws(
    () => planPaymentRecordTransition(event, { ...payment, amount_minor: 101 }),
    /does not match/,
  );

  assert.deepEqual(
    planPaymentRecordTransition(
      {
        id: "evt_partial_refund",
        type: "charge.refunded",
        data: { object: { amount: 100, amount_refunded: 25, currency: "usd" } },
      },
      { ...payment, status: "paid" },
    ),
    {
      status: "partially_refunded",
      refundedAmountMinor: 25,
      allowedCurrentStatuses: [
        "created",
        "requires_action",
        "processing",
        "paid",
        "failed",
        "partially_refunded",
      ],
    },
  );
});

test("Palisade signatures verify the base64 payload hash and tampering fails", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const payload = Buffer.from(
    JSON.stringify({ id: "transaction-1", updatedAt: "2026-08-26T12:00:00Z", status: "CONFIRMED" }),
  ).toString("base64");
  const signature = sign(
    null,
    createHash("sha256").update(payload).digest(),
    keys.privateKey,
  ).toString("base64");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  assert.equal(verifyPalisadeWebhook(publicKey, signature, payload), true);
  assert.equal(verifyPalisadeWebhook(publicKey, signature, `${payload}A`), false);

  const parsed = parsePalisadeWebhook(
    JSON.stringify({ domain: "TRANSACTION", timestamp: "2026-08-26T12:00:00Z", payload }),
  );
  assert.equal(parsed.providerEventId, "transaction-1:2026-08-26T12:00:00Z");
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("the go-live countdown is ten seconds and cannot be skipped", () => {
  const start = new Date("2026-09-16T18:00:00.000Z");
  const target = countdownTargetFrom(start);
  assert.equal(new Date(target).getTime() - start.getTime(), LIVE_COUNTDOWN_MS);
  assert.equal(countdownSecondsLeft(target, start), 10);
  assert.equal(countdownIsComplete(target, start), false);

  const oneSecondLeft = new Date(start.getTime() + 9_000);
  assert.equal(countdownSecondsLeft(target, oneSecondLeft), 1);
  assert.equal(countdownIsComplete(target, oneSecondLeft), false);

  const zero = new Date(start.getTime() + LIVE_COUNTDOWN_MS);
  assert.equal(countdownRemainingMs(target, zero), 0);
  assert.equal(countdownIsComplete(target, zero), true);

  // A missing or past target never counts as an armed countdown.
  assert.equal(countdownRemainingMs(null, start), 0);
  assert.equal(countdownIsComplete(null, start), false);
});

test("go live requires a scheduled event, a meeting, and a finished countdown", () => {
  const start = new Date("2026-09-16T18:00:00.000Z");
  const target = countdownTargetFrom(start);
  const armed = { status: "scheduled" as const, actualStartAt: target, meetingId: "meeting_1" };
  const zero = new Date(start.getTime() + LIVE_COUNTDOWN_MS);

  assert.equal(canBeginCountdown("scheduled"), true);
  assert.equal(canBeginCountdown("live"), false);
  assert.equal(canBeginCountdown("ended"), false);
  assert.equal(canBeginCountdown("canceled"), false);

  // Mid-countdown the commit is refused, so the ten seconds cannot be skipped.
  assert.equal(canGoLive(armed, start), false);
  assert.equal(canGoLive(armed, zero), true);

  // No meeting, no go live.
  assert.equal(canGoLive({ ...armed, meetingId: null }, zero), false);
  // Never re-open an event that already ran.
  assert.equal(canGoLive({ ...armed, status: "ended" }, zero), false);
  // An unarmed event cannot commit.
  assert.equal(canGoLive({ ...armed, actualStartAt: null }, zero), false);

  assert.equal(canEndStream("live"), true);
  assert.equal(canEndStream("scheduled"), false);
});

test("live phase separates green room, countdown, and public live", () => {
  const start = new Date("2026-09-16T18:00:00.000Z");
  const target = countdownTargetFrom(start);
  const zero = new Date(start.getTime() + LIVE_COUNTDOWN_MS);

  assert.equal(
    livePhase({ status: "scheduled", actualStartAt: null, meetingId: null }, start),
    "idle",
  );
  assert.equal(
    livePhase({ status: "scheduled", actualStartAt: target, meetingId: "m" }, start),
    "counting_down",
  );
  assert.equal(
    livePhase({ status: "scheduled", actualStartAt: target, meetingId: "m" }, zero),
    "idle",
  );
  assert.equal(livePhase({ status: "live", actualStartAt: target, meetingId: "m" }, zero), "live");
  assert.equal(livePhase({ status: "ended", actualStartAt: target, meetingId: "m" }, zero), "over");
  assert.equal(
    livePhase({ status: "canceled", actualStartAt: null, meetingId: null }, zero),
    "over",
  );
});

test("viewer media tokens are withheld until the room is publicly live", () => {
  const target = countdownTargetFrom(new Date("2026-09-16T18:00:00.000Z"));
  const live = { status: "live" as const, actualStartAt: target, meetingId: "meeting_1" };

  assert.equal(viewerMayJoinMedia(live, true), true);
  // Entitlement alone is not enough during green room or countdown.
  assert.equal(viewerMayJoinMedia({ ...live, status: "scheduled" }, true), false);
  assert.equal(viewerMayJoinMedia({ ...live, status: "ended" }, true), false);
  // An entitled-but-not-watching caller never gets a token.
  assert.equal(viewerMayJoinMedia(live, false), false);
  // A live event with no meeting yields nothing to join.
  assert.equal(viewerMayJoinMedia({ ...live, meetingId: null }, true), false);
});

test("RealtimeKit participants are keyed by the Accountabul user id", () => {
  const userId = "2b1f7c64-6d1a-4a5e-9f3b-7a0c9d2e5f18";
  assert.equal(participantIdentity(userId), userId);
});

const baseCandidate: AlertCandidate = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "member@example.com",
  phone: null,
  isMember: true,
  hasPass: false,
  isVendor: false,
  emailOptIn: true,
  smsOptIn: false,
};

test("hop-on alerts reach members, pass holders, and vendors only", () => {
  assert.equal(isAlertEligible(baseCandidate), true);
  assert.equal(isAlertEligible({ ...baseCandidate, isMember: false, hasPass: true }), true);
  assert.equal(isAlertEligible({ ...baseCandidate, isMember: false, isVendor: true }), true);
  // Somebody with no membership, no pass, and no vendor account hears nothing.
  assert.equal(
    isAlertEligible({ ...baseCandidate, isMember: false, hasPass: false, isVendor: false }),
    false,
  );
  assert.deepEqual(
    channelsFor({ ...baseCandidate, isMember: false, hasPass: false, isVendor: false }),
    [],
  );
});

test("SMS alerts require an explicit opt-in and a usable number", () => {
  // Opted in, but no number on file.
  assert.equal(smsChannelOpen({ ...baseCandidate, smsOptIn: true, phone: null }), false);
  // A number on file is not consent.
  assert.equal(smsChannelOpen({ ...baseCandidate, smsOptIn: false, phone: "+15555550123" }), false);
  // Consent plus a number.
  assert.equal(smsChannelOpen({ ...baseCandidate, smsOptIn: true, phone: "+15555550123" }), true);
  // Non-E.164 is refused rather than guessed at.
  assert.equal(smsChannelOpen({ ...baseCandidate, smsOptIn: true, phone: "555-555-0123" }), false);
});

test("alert channels default to in-app plus email, never SMS", () => {
  assert.deepEqual(channelsFor(baseCandidate), ["in_app", "email"]);
  // Email opted out still leaves the in-app banner.
  assert.deepEqual(channelsFor({ ...baseCandidate, emailOptIn: false }), ["in_app"]);
  // A bad address is dropped rather than sent to.
  assert.deepEqual(channelsFor({ ...baseCandidate, email: "not-an-address" }), ["in_app"]);
  assert.deepEqual(channelsFor({ ...baseCandidate, smsOptIn: true, phone: "+15555550123" }), [
    "in_app",
    "email",
    "sms",
  ]);
});

test("recipient selection drops duplicates and carries only open channels", () => {
  const recipients = selectAlertRecipients([
    baseCandidate,
    // Same person, reached again as a vendor. They must not be alerted twice.
    { ...baseCandidate, isVendor: true },
    {
      ...baseCandidate,
      userId: "22222222-2222-4222-8222-222222222222",
      emailOptIn: false,
      smsOptIn: true,
      phone: "+15555550199",
    },
    // Not entitled, so absent from the result entirely.
    {
      ...baseCandidate,
      userId: "33333333-3333-4333-8333-333333333333",
      isMember: false,
      hasPass: false,
      isVendor: false,
    },
  ]);

  assert.equal(recipients.length, 2);
  assert.equal(recipients[0]?.userId, baseCandidate.userId);
  assert.equal(recipients[0]?.email, "member@example.com");
  assert.equal(recipients[0]?.phone, null);

  const second = recipients[1];
  assert.deepEqual(second?.channels, ["in_app", "sms"]);
  // Email was opted out, so no address is carried forward to a transport.
  assert.equal(second?.email, null);
  assert.equal(second?.phone, "+15555550199");
});

test("the hop-on link always opens the Accountabul event page", () => {
  const url = liveEventUrl("https://accountabul.com/", "september-standup");
  assert.equal(url, "https://accountabul.com/live/september-standup");

  const message = buildHopOnMessage({ title: "September standup", url });
  assert.match(message.subject, /September standup/);
  assert.match(message.text, /https:\/\/accountabul\.com\/live\/september-standup/);
  assert.match(message.sms, /Reply STOP to opt out/);
  // The spec fails the flow if a guest link ever appears.
  assert.doesNotMatch(message.text, /zoom|restream/i);
  assert.doesNotMatch(message.sms, /zoom|restream/i);
});

test("alert delivery is deduped per person, per event, per channel", () => {
  const eventId = "44444444-4444-4444-8444-444444444444";
  assert.equal(
    alertDedupeKey(eventId, baseCandidate.userId, "email"),
    `${eventId}:${baseCandidate.userId}:email:live`,
  );
  // The scheduled announcement must not suppress the go-live alert.
  assert.notEqual(
    alertDedupeKey(eventId, baseCandidate.userId, "email", "scheduled"),
    alertDedupeKey(eventId, baseCandidate.userId, "email", "live"),
  );
  assert.notEqual(
    alertDedupeKey(eventId, baseCandidate.userId, "email"),
    alertDedupeKey(eventId, baseCandidate.userId, "sms"),
  );
});

test("only present Accountabul commenters can be pulled onto the stage", () => {
  const member = {
    userId: "55555555-5555-4555-8555-555555555555",
    source: "accountabul",
    presentInRoom: true,
  };
  assert.equal(commenterIsInvitable(member), true);

  // Left the room, so there is nothing to promote.
  assert.equal(commenterIsInvitable({ ...member, presentInRoom: false }), false);
  // Anonymous paid-guest text has no live session behind it.
  assert.equal(commenterIsInvitable({ ...member, userId: null, source: "paid_guest" }), false);
  // Imported external chat is never invitable.
  assert.equal(commenterIsInvitable({ ...member, source: "restream" }), false);
  assert.equal(commenterIsInvitable({ ...member, source: "youtube" }), false);
});

test("the room assistant validates questions before spending a call", () => {
  assert.equal(normalizeQuestion("  What is a cap rate?  "), "What is a cap rate?");
  assert.throws(() => normalizeQuestion("   "), /Ask a question first/);
  assert.throws(() => normalizeQuestion("x".repeat(ASSISTANT_MAX_QUESTION + 1)), /limited to/);
});

test("assistant history is trimmed rather than refused", () => {
  const turn = (index: number): AssistantTurn => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn ${index}`,
  });
  const short = [turn(0), turn(1)];
  assert.deepEqual(trimHistory(short), short);

  const long = Array.from({ length: ASSISTANT_MAX_TURNS + 6 }, (_value, index) => turn(index));
  const trimmed = trimHistory(long);
  assert.equal(trimmed.length, ASSISTANT_MAX_TURNS);
  // The most recent turns survive, so the conversation stays coherent.
  assert.deepEqual(trimmed[trimmed.length - 1], long[long.length - 1]);
});

test("the assistant prompt refuses personalized financial advice", () => {
  const prompt = buildSystemPrompt({
    eventTitle: "Deal review",
    eventDescription: "Walking a live deal",
  });
  assert.match(prompt, /Deal review/);
  assert.match(prompt, /Walking a live deal/);
  assert.match(prompt, /not give personalized investment, tax, or legal advice/i);

  // A missing description simply drops out of the prompt.
  const sparse = buildSystemPrompt({ eventTitle: "Open mic", eventDescription: null });
  assert.match(sparse, /Open mic/);
  assert.doesNotMatch(sparse, /Event description/);
});

test("the assistant is disabled unless a key is configured", () => {
  assert.equal(assistantIsConfigured({}), false);
  assert.equal(assistantIsConfigured({ ANTHROPIC_API_KEY: "" }), false);
  assert.equal(assistantIsConfigured({ ANTHROPIC_API_KEY: "sk-ant-test" }), true);
});

function closeTo(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("amortized payments match the standard mortgage formula", () => {
  // 200k at 7% over 30 years is the textbook 1330.60 a month.
  closeTo(monthlyPayment(200_000, 7, 30), 1330.6);
  // A zero-interest loan is straight-line, not a divide by zero.
  closeTo(monthlyPayment(120_000, 0, 10), 1000);
  // Degenerate inputs return zero rather than NaN.
  assert.equal(monthlyPayment(0, 7, 30), 0);
  assert.equal(monthlyPayment(200_000, 7, 0), 0);
  assert.equal(monthlyPayment(Number.NaN, 7, 30), 0);
});

test("the deal calculator reports cash flow, cap rate, and coverage", () => {
  const results = calculateDeal(DEAL_DEFAULTS);

  assert.equal(results.loanAmount, 200_000);
  // 20% down plus closing costs.
  assert.equal(results.cashInvested, 57_500);
  closeTo(results.monthlyDebtService, 1330.6);
  // 2200 rent less 5% vacancy.
  closeTo(results.effectiveMonthlyRent, 2090);
  // NOI is before debt service.
  closeTo(results.netOperatingIncome, (2090 - 650) * 12);
  closeTo(results.monthlyCashFlow, 2090 - 650 - 1330.6);
  closeTo(results.capRatePercent, ((2090 - 650) * 12 * 100) / 250_000);
  closeTo(results.debtServiceCoverageRatio, ((2090 - 650) * 12) / (1330.6 * 12), 0.001);
});

test("the deal calculator never reports NaN or Infinity", () => {
  const empty = calculateDeal({
    purchasePrice: 0,
    downPaymentPercent: 0,
    annualInterestRatePercent: 0,
    loanTermYears: 0,
    monthlyRent: 0,
    vacancyPercent: 0,
    monthlyOperatingExpenses: 0,
    closingCosts: 0,
  });
  for (const [key, value] of Object.entries(empty)) {
    assert.ok(Number.isFinite(value), `${key} should be finite, got ${value}`);
  }

  // An all-cash purchase has no debt service, so coverage is reported as zero.
  const allCash = calculateDeal({ ...DEAL_DEFAULTS, downPaymentPercent: 100 });
  assert.equal(allCash.loanAmount, 0);
  assert.equal(allCash.monthlyDebtService, 0);
  assert.equal(allCash.debtServiceCoverageRatio, 0);
  closeTo(allCash.monthlyCashFlow, 2090 - 650);

  // Full vacancy wipes out rent without breaking the ratios.
  const vacant = calculateDeal({ ...DEAL_DEFAULTS, vacancyPercent: 150 });
  assert.equal(vacant.effectiveMonthlyRent, 0);
  assert.ok(Number.isFinite(vacant.capRatePercent));
});

test("the scheduled announcement names the start time and the event page", () => {
  const url = "https://accountabul.com/live/october-deal-night";
  const message = buildScheduledMessage({
    title: "October deal night",
    url,
    startsAt: "2026-10-01T23:00:00.000Z",
  });
  assert.match(message.subject, /^Scheduled: October deal night$/);
  assert.match(message.text, /Oct 1, 2026/);
  assert.match(message.text, /UTC/);
  assert.ok(message.text.includes(url));
  assert.match(message.sms, /Reply STOP to opt out/);
  assert.doesNotMatch(message.text, /zoom|restream/i);

  // An unparseable time degrades to "soon" instead of printing Invalid Date.
  const vague = buildScheduledMessage({ title: "Pop-up", url, startsAt: "not-a-date" });
  assert.match(vague.text, /scheduled for soon/);
  assert.doesNotMatch(vague.text, /Invalid Date/);

  // buildAlertMessage picks the right template, and falls back to live without a time.
  assert.match(
    buildAlertMessage("scheduled", { title: "X", url, startsAt: "2026-10-01T23:00:00Z" }).subject,
    /^Scheduled/,
  );
  assert.match(
    buildAlertMessage("scheduled", { title: "X", url, startsAt: null }).subject,
    /^We're live/,
  );
  assert.match(buildAlertMessage("live", { title: "X", url }).subject, /^We're live/);
});

test("alert preferences refuse text alerts without a usable number", () => {
  assert.deepEqual(
    normalizeAlertPreferences({ emailOptIn: true, smsOptIn: false, smsPhone: null }),
    { emailOptIn: true, smsOptIn: false, smsPhone: null },
  );
  // US numbers are normalized to E.164.
  assert.equal(
    normalizeAlertPreferences({ emailOptIn: false, smsOptIn: true, smsPhone: "(555) 555-0123" })
      .smsPhone,
    "+15555550123",
  );
  assert.equal(
    normalizeAlertPreferences({ emailOptIn: false, smsOptIn: true, smsPhone: "1 555 555 0123" })
      .smsPhone,
    "+15555550123",
  );
  assert.equal(
    normalizeAlertPreferences({ emailOptIn: false, smsOptIn: true, smsPhone: "+447700900123" })
      .smsPhone,
    "+447700900123",
  );
  // Opting in with no number, or a junk number, is refused rather than saved.
  assert.throws(
    () => normalizeAlertPreferences({ emailOptIn: true, smsOptIn: true, smsPhone: "  " }),
    /Add a mobile number/,
  );
  assert.throws(
    () => normalizeAlertPreferences({ emailOptIn: true, smsOptIn: true, smsPhone: "12345" }),
    /Enter a mobile number/,
  );
});

test("host removal is an event-scoped ban that survives a rejoin", () => {
  const eventId = "66666666-6666-4666-8666-666666666666";
  const otherEvent = "77777777-7777-4777-8777-777777777777";
  const now = new Date("2026-09-16T20:00:00.000Z");

  assert.equal(isRemovedFromEvent([], eventId, now), false);
  // Removed from this event.
  assert.equal(
    isRemovedFromEvent([{ action: "ban", eventId, expiresAt: null }], eventId, now),
    true,
  );
  // A ban on a different event does not follow them here.
  assert.equal(
    isRemovedFromEvent([{ action: "ban", eventId: otherEvent, expiresAt: null }], eventId, now),
    false,
  );
  // A global ban applies everywhere.
  assert.equal(
    isRemovedFromEvent([{ action: "ban", eventId: null, expiresAt: null }], eventId, now),
    true,
  );
  // An expired ban no longer applies.
  assert.equal(
    isRemovedFromEvent(
      [{ action: "ban", eventId, expiresAt: "2026-09-16T19:00:00.000Z" }],
      eventId,
      now,
    ),
    false,
  );
  // Other moderation actions are not removals.
  assert.equal(
    isRemovedFromEvent([{ action: "warn", eventId, expiresAt: null }], eventId, now),
    false,
  );
});

test("the operations console can never make a room public", () => {
  // Creating or editing into live skips the green room and countdown.
  assert.equal(opsStatusChangeAllowed(null, "live"), false);
  assert.equal(opsStatusChangeAllowed("scheduled", "live"), false);
  assert.equal(opsStatusChangeAllowed("ended", "live"), false);
  // Editing an event that is already live leaves it live.
  assert.equal(opsStatusChangeAllowed("live", "live"), true);

  // Ops can end or cancel a running broadcast, but not push it back.
  assert.equal(opsStatusChangeAllowed("live", "ended"), true);
  assert.equal(opsStatusChangeAllowed("live", "canceled"), true);
  assert.equal(opsStatusChangeAllowed("live", "scheduled"), false);
  assert.equal(opsStatusChangeAllowed("live", "replay_available"), false);

  // Ordinary scheduling work is unaffected.
  assert.equal(opsStatusChangeAllowed(null, "scheduled"), true);
  assert.equal(opsStatusChangeAllowed("scheduled", "canceled"), true);
  assert.equal(opsStatusChangeAllowed("ended", "replay_available"), true);
});

test("ACC-20260916-007: ended and canceled events cannot be reopened to scheduled", () => {
  // scheduled is not inert: TIPPABLE_STATUSES includes it, so reverting a
  // terminal event there would re-enable tipping and re-qualify it for the
  // ops "starting soon" alert dispatch on a room that already closed.
  assert.equal(opsStatusChangeAllowed("ended", "scheduled"), false);
  assert.equal(opsStatusChangeAllowed("canceled", "scheduled"), false);
  // canceled is fully terminal -- unlike ended, it has no replay to publish.
  assert.equal(opsStatusChangeAllowed("canceled", "replay_available"), false);
  assert.equal(opsStatusChangeAllowed("canceled", "ended"), false);
});

test("ACC-20260916-007 (residual, found by independent verification): replay_available is exactly as terminal as ended", () => {
  // The first pass fixed ended -> scheduled and canceled -> scheduled, but
  // left replay_available -- what ended becomes once a replay is published,
  // not a lesser state -- covered by the same unguarded fallthrough that
  // caused the original bug. ended -> replay_available -> scheduled
  // reproduced the identical impact in two calls instead of one.
  assert.equal(opsStatusChangeAllowed("replay_available", "scheduled"), false);
  assert.equal(opsStatusChangeAllowed("replay_available", "ended"), false);
  assert.equal(opsStatusChangeAllowed("replay_available", "canceled"), false);
  // Still reachable: publishing a replay itself is unaffected.
  assert.equal(opsStatusChangeAllowed("ended", "replay_available"), true);
  assert.equal(opsStatusChangeAllowed("replay_available", "replay_available"), true);
});
