import { createPublicKey, verify } from "node:crypto";

import { usdcAmountsMatch } from "./usdc.ts";

export type CircleInboundNotification = {
  notificationId: string;
  notificationType: string;
  walletId: string | null;
  destinationAddress: string | null;
  amount: string | null;
  state: string | null;
  transactionId: string | null;
  txHash: string | null;
  blockchain: string | null;
  tokenId: string | null;
};

export type CircleTipForReconciliation = {
  id: string;
  amount_minor: number;
  currency: string;
  provider_record_id: string | null;
  deposit_address: string | null;
  quote_expires_at: string | null;
  status: "created" | "processing" | "paid" | "failed" | "refunded";
};

export type CircleTipTransition =
  | { kind: "paid"; allowedCurrentStatuses: CircleTipForReconciliation["status"][] }
  | { kind: "unmatched"; reason: string };

export function parseCircleNotification(payload: string): CircleInboundNotification {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Invalid Circle notification JSON.");
  }
  if (!isRecord(value) || typeof value["notificationId"] !== "string") {
    throw new Error("Invalid Circle notification envelope.");
  }
  const notificationType =
    typeof value["notificationType"] === "string" ? value["notificationType"] : "";
  const body = isRecord(value["notification"]) ? value["notification"] : {};
  const amounts = body["amounts"];
  const amount = Array.isArray(amounts) && typeof amounts[0] === "string" ? amounts[0] : null;
  return {
    notificationId: value["notificationId"],
    notificationType,
    walletId: stringOrNull(body["walletId"]),
    destinationAddress: stringOrNull(body["destinationAddress"]),
    amount,
    state: stringOrNull(body["state"]),
    transactionId: stringOrNull(body["id"]),
    txHash: stringOrNull(body["txHash"]),
    blockchain: stringOrNull(body["blockchain"]),
    tokenId: stringOrNull(body["tokenId"]),
  };
}

export function verifyCircleSignature(
  publicKeyBase64: string,
  signatureBase64: string,
  rawBody: string,
) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      Buffer.from(rawBody),
      publicKey,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export function planCircleTipTransition(
  notification: CircleInboundNotification,
  tip: CircleTipForReconciliation,
  now: Date,
  expectedNetwork: string,
  expectedTokenId?: string | null,
): CircleTipTransition {
  if (notification.notificationType === "webhooks.test") {
    return { kind: "unmatched", reason: "test_notification" };
  }
  if (notification.notificationType !== "transactions.inbound") {
    return { kind: "unmatched", reason: "ignored_notification_type" };
  }
  if (tip.status === "paid" || tip.status === "refunded") {
    return { kind: "unmatched", reason: "already_terminal" };
  }
  if (notification.walletId !== tip.provider_record_id) {
    return { kind: "unmatched", reason: "wallet_mismatch" };
  }
  if (!tip.deposit_address) return { kind: "unmatched", reason: "missing_deposit_address" };
  if (!notification.destinationAddress) return { kind: "unmatched", reason: "missing_destination" };
  if (notification.destinationAddress.toLowerCase() !== tip.deposit_address.toLowerCase()) {
    return { kind: "unmatched", reason: "address_mismatch" };
  }
  if (!notification.blockchain) return { kind: "unmatched", reason: "missing_network" };
  if (notification.blockchain !== expectedNetwork) {
    return { kind: "unmatched", reason: "network_mismatch" };
  }
  if (!expectedTokenId) return { kind: "unmatched", reason: "missing_token_config" };
  if (!notification.tokenId) return { kind: "unmatched", reason: "missing_token" };
  if (notification.tokenId !== expectedTokenId) {
    return { kind: "unmatched", reason: "token_mismatch" };
  }
  if (tip.quote_expires_at && new Date(tip.quote_expires_at).getTime() <= now.getTime()) {
    return { kind: "unmatched", reason: "quote_expired" };
  }
  if (tip.currency !== "USD") return { kind: "unmatched", reason: "currency_mismatch" };
  if (!notification.amount) return { kind: "unmatched", reason: "missing_amount" };
  try {
    if (!usdcAmountsMatch(tip.amount_minor, notification.amount)) {
      return { kind: "unmatched", reason: "amount_mismatch" };
    }
  } catch {
    return { kind: "unmatched", reason: "amount_mismatch" };
  }
  if (notification.state !== "COMPLETE" && notification.state !== "COMPLETED") {
    return { kind: "unmatched", reason: "not_complete" };
  }
  return {
    kind: "paid",
    allowedCurrentStatuses: ["created", "processing"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const RETRYABLE_CIRCLE_UNMATCHED = new Set([
  "quote_expired",
  "not_complete",
  "missing_destination",
  "unmatched_wallet",
]);

export function isRetryableCircleUnmatched(reason: string) {
  return RETRYABLE_CIRCLE_UNMATCHED.has(reason);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
