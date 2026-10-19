import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  isRetryableCircleUnmatched,
  parseCircleNotification,
  planCircleTipTransition,
  verifyCircleSignature,
  type CircleTipForReconciliation,
} from "../src/lib/crypto/circle-webhook.ts";
import { eventAcceptsTips } from "../src/lib/tips/eligibility.ts";
import {
  usdMinorToUsdcBaseUnits,
  usdcAmountsMatch,
  usdcBaseUnitsToDecimal,
  usdcDecimalToBaseUnits,
} from "../src/lib/crypto/usdc.ts";
import { assertTipSpeech, formatTipChatBody, normalizeTipSpeech } from "../src/lib/tips/speech.ts";

test("refuses a tip without a name or message", () => {
  assert.throws(
    () => assertTipSpeech(normalizeTipSpeech({ displayName: "  ", message: "go" })),
    /name/,
  );
  assert.throws(
    () => assertTipSpeech(normalizeTipSpeech({ displayName: "Jane", message: "\n" })),
    /message/,
  );
});

test("formats the on-stream tip line from locked name, USD amount, and message", () => {
  assert.equal(
    formatTipChatBody({ displayName: "Jane", amountMinor: 2500, message: "keep going" }),
    "Jane tipped $25.00 — keep going",
  );
});

test("converts USD cents to native USDC 6-decimal base units", () => {
  assert.equal(usdMinorToUsdcBaseUnits(1000), 10_000_000n);
  assert.equal(usdcBaseUnitsToDecimal(10_000_000n), "10");
  assert.equal(usdcDecimalToBaseUnits("10"), 10_000_000n);
  assert.equal(usdcDecimalToBaseUnits("10.50"), 10_500_000n);
  assert.equal(usdcAmountsMatch(1050, "10.5"), true);
  assert.equal(usdcAmountsMatch(1000, "10.01"), false);
});

test("verifies Circle ECDSA signatures over the raw body", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const body =
    '{"subscriptionId":"00000000-0000-0000-0000-000000000000","notificationId":"00000000-0000-0000-0000-000000000000","notificationType":"webhooks.test","notification":{"hello":"world"},"timestamp":"2026-09-04T12:00:00Z","version":2}';
  const signature = sign("sha256", Buffer.from(body), keys.privateKey).toString("base64");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  assert.equal(verifyCircleSignature(publicKey, signature, body), true);
  assert.equal(verifyCircleSignature(publicKey, signature, `${body} `), false);
});

test("pays only a matching completed inbound USDC transfer for the quoted wallet", () => {
  const tip = buildCircleTip();
  const tokenId = "usdc-sepolia";
  const paid = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId })),
    tip,
    new Date("2026-09-04T12:05:00.000Z"),
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.deepEqual(paid, { kind: "paid", allowedCurrentStatuses: ["created", "processing"] });

  const wrongAmount = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["9"], state: "COMPLETE", tokenId })),
    tip,
    new Date("2026-09-04T12:05:00.000Z"),
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(wrongAmount.kind, "unmatched");
  if (wrongAmount.kind === "unmatched") assert.equal(wrongAmount.reason, "amount_mismatch");

  const expired = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId })),
    tip,
    new Date("2026-09-04T12:20:00.000Z"),
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(expired.kind, "unmatched");
  if (expired.kind === "unmatched") assert.equal(expired.reason, "quote_expired");
});

test("refuses Circle inbounds that omit network or token binding", () => {
  const tip = buildCircleTip();
  const tokenId = "usdc-sepolia";
  const missingToken = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["10"], state: "COMPLETE" })),
    tip,
    new Date("2026-09-04T12:05:00.000Z"),
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(missingToken.kind, "unmatched");
  if (missingToken.kind === "unmatched") assert.equal(missingToken.reason, "missing_token");

  const missingConfig = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId })),
    tip,
    new Date("2026-09-04T12:05:00.000Z"),
    "BASE-SEPOLIA",
  );
  assert.equal(missingConfig.kind, "unmatched");
  if (missingConfig.kind === "unmatched")
    assert.equal(missingConfig.reason, "missing_token_config");

  const otherToken = planCircleTipTransition(
    parseCircleNotification(
      buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId: "other" }),
    ),
    tip,
    new Date("2026-09-04T12:05:00.000Z"),
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(otherToken.kind, "unmatched");
  if (otherToken.kind === "unmatched") assert.equal(otherToken.reason, "token_mismatch");
});

test("refuses Circle inbounds that omit or mismatch the deposit address", () => {
  const tip = buildCircleTip();
  const tokenId = "usdc-sepolia";
  const now = new Date("2026-09-04T12:05:00.000Z");
  const missingDestination = planCircleTipTransition(
    parseCircleNotification(
      buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId, omitDestination: true }),
    ),
    tip,
    now,
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(missingDestination.kind, "unmatched");
  if (missingDestination.kind === "unmatched") {
    assert.equal(missingDestination.reason, "missing_destination");
  }

  const missingQuoteAddress = planCircleTipTransition(
    parseCircleNotification(buildInboundPayload({ amounts: ["10"], state: "COMPLETE", tokenId })),
    buildCircleTip({ deposit_address: null }),
    now,
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(missingQuoteAddress.kind, "unmatched");
  if (missingQuoteAddress.kind === "unmatched") {
    assert.equal(missingQuoteAddress.reason, "missing_deposit_address");
  }

  const wrongAddress = planCircleTipTransition(
    parseCircleNotification(
      buildInboundPayload({
        amounts: ["10"],
        state: "COMPLETE",
        tokenId,
        destinationAddress: "0xdef",
      }),
    ),
    tip,
    now,
    "BASE-SEPOLIA",
    tokenId,
  );
  assert.equal(wrongAddress.kind, "unmatched");
  if (wrongAddress.kind === "unmatched") assert.equal(wrongAddress.reason, "address_mismatch");
});

function buildCircleTip(
  overrides: Partial<CircleTipForReconciliation> = {},
): CircleTipForReconciliation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    amount_minor: 1000,
    currency: "USD",
    provider_record_id: "wallet-1",
    deposit_address: "0xabc",
    quote_expires_at: "2026-09-04T12:15:00.000Z",
    status: "processing",
    ...overrides,
  };
}

function buildInboundPayload(input: {
  amounts: string[];
  state: string;
  tokenId?: string;
  destinationAddress?: string;
  omitDestination?: boolean;
}) {
  return JSON.stringify({
    subscriptionId: "sub-1",
    notificationId: "note-1",
    notificationType: "transactions.inbound",
    notification: {
      id: "tx-1",
      blockchain: "BASE-SEPOLIA",
      walletId: "wallet-1",
      ...(input.omitDestination ? {} : { destinationAddress: input.destinationAddress ?? "0xabc" }),
      amounts: input.amounts,
      state: input.state,
      tokenId: input.tokenId,
      transactionType: "INBOUND",
      txHash: "0xhash",
    },
    timestamp: "2026-09-04T12:06:00Z",
    version: 2,
  });
}

test("only scheduled and live rooms accept tips", () => {
  assert.equal(eventAcceptsTips({ tips_enabled: true, status: "live" }), true);
  assert.equal(eventAcceptsTips({ tips_enabled: true, status: "scheduled" }), true);
  assert.equal(eventAcceptsTips({ tips_enabled: true, status: "canceled" }), false);
  assert.equal(eventAcceptsTips({ tips_enabled: true, status: "ended" }), false);
  assert.equal(eventAcceptsTips({ tips_enabled: false, status: "live" }), false);
});

test("expired Circle unmatched reasons stay retryable", () => {
  assert.equal(isRetryableCircleUnmatched("quote_expired"), true);
  assert.equal(isRetryableCircleUnmatched("not_complete"), true);
  assert.equal(isRetryableCircleUnmatched("missing_destination"), true);
  assert.equal(isRetryableCircleUnmatched("unmatched_wallet"), true);
  assert.equal(isRetryableCircleUnmatched("amount_mismatch"), false);
  assert.equal(isRetryableCircleUnmatched("token_mismatch"), false);
});
