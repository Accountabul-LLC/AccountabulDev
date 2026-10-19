import { bytesToHex } from "./security/hex.ts";
import { constantTimeEqual } from "./security/constant-time.ts";

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type StripeObject = Record<string, unknown> & {
  id?: string;
  amount?: number;
  amount_due?: number;
  amount_paid?: number;
  amount_refunded?: number;
  amount_total?: number;
  client_reference_id?: string | null;
  customer?: string | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | null;
  payment_status?: string | null;
  status?: string | null;
  subscription?: string | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  account?: string;
  livemode?: boolean;
  data: { object: StripeObject };
};

export type PaymentRecordForReconciliation = {
  id: string;
  amount_minor: number;
  currency: string;
  checkout_session_id: string | null;
  status:
    | "created"
    | "requires_action"
    | "processing"
    | "paid"
    | "failed"
    | "refunded"
    | "partially_refunded"
    | "canceled";
};

export type PaymentRecordTransition = {
  status: "paid" | "failed" | "refunded" | "partially_refunded";
  refundedAmountMinor?: number;
  allowedCurrentStatuses: PaymentRecordForReconciliation["status"][];
};

export type PaymentRecordOutcome = Pick<PaymentRecordTransition, "status" | "refundedAmountMinor">;

export type TipForReconciliation = {
  id: string;
  amount_minor: number;
  currency: string;
  provider_record_id: string | null;
  status: "created" | "processing" | "paid" | "failed" | "refunded";
};

export type TipTransition = {
  status: "paid" | "failed" | "refunded";
  allowedCurrentStatuses: TipForReconciliation["status"][];
};

export function parseStripeEvent(payload: string): StripeEvent {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Invalid Stripe event JSON.");
  }

  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["type"] !== "string") {
    throw new Error("Invalid Stripe event envelope.");
  }

  const data = value["data"];
  if (!isRecord(data) || !isRecord(data["object"])) {
    throw new Error("Invalid Stripe event data.");
  }

  return {
    id: value["id"],
    type: value["type"],
    ...(typeof value["account"] === "string" ? { account: value["account"] } : {}),
    ...(typeof value["livemode"] === "boolean" ? { livemode: value["livemode"] } : {}),
    data: { object: data["object"] },
  };
}

export function getStripeTipId(event: StripeEvent): string | null {
  const object = event.data.object;
  const explicitTipId = object.metadata?.["tip_id"];
  const value =
    typeof explicitTipId === "string"
      ? explicitTipId
      : object.metadata?.["accountabul_kind"] === "tip"
        ? object.client_reference_id
        : null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getStripePaymentRecordId(event: StripeEvent): string | null {
  const value = event.data.object.metadata?.["payment_record_id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getStripePaidCommentId(event: StripeEvent): string | null {
  const value = event.data.object.metadata?.["paid_comment_id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function planPaymentRecordTransition(
  event: StripeEvent,
  payment: PaymentRecordForReconciliation,
): PaymentRecordTransition | null {
  const outcome = getPaymentRecordOutcome(event, payment);
  if (!outcome) return null;

  if (outcome.status === "paid") {
    if (payment.status === "paid" || payment.status === "refunded") return null;
    return {
      ...outcome,
      allowedCurrentStatuses: ["created", "requires_action", "processing", "failed"],
    };
  }

  if (outcome.status === "failed") {
    if (!["created", "requires_action", "processing"].includes(payment.status)) return null;
    return {
      ...outcome,
      allowedCurrentStatuses: ["created", "requires_action", "processing"],
    };
  }

  if (payment.status === "refunded" && outcome.status === "refunded") return null;
  return {
    ...outcome,
    allowedCurrentStatuses: [
      "created",
      "requires_action",
      "processing",
      "paid",
      "failed",
      "partially_refunded",
    ],
  };
}

/**
 * Validates a Stripe event against the Accountabul payment record and returns
 * the provider-authoritative outcome even when the database already contains
 * that outcome. Webhook retries use this to replay idempotent side effects
 * after a prior attempt updated the payment but failed before publication or
 * entitlement activation completed.
 */
export function getPaymentRecordOutcome(
  event: StripeEvent,
  payment: PaymentRecordForReconciliation,
): PaymentRecordOutcome | null {
  const object = event.data.object;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    if (
      typeof object.id !== "string" ||
      object.id !== payment.checkout_session_id ||
      object.amount_total !== payment.amount_minor ||
      object.currency?.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new Error("Stripe Checkout Session does not match the recorded payment.");
    }

    if (
      (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") &&
      object.payment_status === "paid"
    ) {
      return { status: "paid" };
    }
    if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      return { status: "failed" };
    }
  }

  if (event.type === "charge.refunded") {
    if (
      object.amount !== payment.amount_minor ||
      typeof object.amount_refunded !== "number" ||
      object.amount_refunded <= 0 ||
      object.amount_refunded > object.amount ||
      object.currency?.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new Error("Stripe refund does not match the recorded payment.");
    }
    const fullyRefunded = object.amount_refunded === object.amount;
    return {
      status: fullyRefunded ? "refunded" : "partially_refunded",
      refundedAmountMinor: object.amount_refunded,
    };
  }

  return null;
}

export function planTipTransition(
  event: StripeEvent,
  tip: TipForReconciliation,
): TipTransition | null {
  const object = event.data.object;

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    assertCheckoutSessionMatches(object, tip);

    if (
      (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") &&
      object.payment_status === "paid"
    ) {
      if (tip.status === "paid" || tip.status === "refunded") return null;
      return {
        status: "paid",
        allowedCurrentStatuses: ["created", "processing", "failed"],
      };
    }

    if (
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      if (tip.status !== "created" && tip.status !== "processing") return null;
      return { status: "failed", allowedCurrentStatuses: ["created", "processing"] };
    }

    // Some payment methods complete Checkout before funds are available. A later
    // async_payment_succeeded or async_payment_failed event owns the transition.
    return null;
  }

  if (event.type === "charge.refunded") {
    assertChargeRefundMatches(object, tip);
    if (tip.status === "refunded") return null;
    return {
      status: "refunded",
      allowedCurrentStatuses: ["created", "processing", "paid", "failed"],
    };
  }

  return null;
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  options: { nowMs?: number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  const fields = parseSignatureHeader(header);
  const timestamp = fields.timestamp;
  if (!timestamp || fields.signatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${payload}`));
  const expected = bytesToHex(new Uint8Array(digest));

  return fields.signatures.some((signature) => constantTimeEqual(expected, signature));
}

function assertCheckoutSessionMatches(object: StripeObject, tip: TipForReconciliation) {
  if (
    typeof object.id !== "string" ||
    object.id !== tip.provider_record_id ||
    object.amount_total !== tip.amount_minor ||
    object.currency?.toUpperCase() !== tip.currency.toUpperCase()
  ) {
    throw new Error("Stripe Checkout Session does not match the recorded tip.");
  }
}

function assertChargeRefundMatches(object: StripeObject, tip: TipForReconciliation) {
  if (
    object.amount !== tip.amount_minor ||
    object.amount_refunded !== object.amount ||
    object.currency?.toUpperCase() !== tip.currency.toUpperCase()
  ) {
    throw new Error("Stripe refund does not match the recorded tip.");
  }
}

function parseSignatureHeader(header: string) {
  let timestamp: string | undefined;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }

  return { timestamp, signatures };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
