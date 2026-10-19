import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createVariableAmountCheckout } from "@/lib/billing/checkout.server";
import { moderateComment } from "@/lib/conference/moderation.server";
import { screenDeterministically, sha256Text } from "@/lib/conference/moderation";
import { getCryptoCheckoutAdapter } from "@/lib/crypto/adapters";
import { circleUsdcNetwork, isCircleUsdcTipsConfigured } from "@/lib/crypto/circle-wallets.server";
import {
  buildUsdcQrPayload,
  usdMinorToUsdcBaseUnits,
  usdcBaseUnitsToDecimal,
} from "@/lib/crypto/usdc";
import { getStripeRuntime } from "@/lib/stripe/client.server";
import { eventAcceptsTips } from "@/lib/tips/eligibility";
import { assertTipSpeech, normalizeTipSpeech } from "@/lib/tips/speech";
import { UUID_V1_TO_V8 as UUID_PATTERN } from "../validation/patterns.ts";

export type TipMethod = "stripe" | "usdc";

export type NamedTipResult = {
  tipId: string;
  status: string;
  checkoutUrl: string | null;
  quote: {
    depositAddress: string;
    exactAssetAmount: string;
    network: string;
    expiresAt: string;
    qrPayload: string;
    asset: "USDC";
  } | null;
  note: string;
};

export async function createNamedTipIntent(input: {
  eventId: string;
  amountMinor: number;
  attemptId: string;
  displayName: unknown;
  message: unknown;
  method: TipMethod;
  userId?: string | null;
  guestEmail?: string | null;
}): Promise<NamedTipResult> {
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.attemptId)) {
    throw new Error("A valid event and tip attempt are required.");
  }
  const amount = Math.round(Number(input.amountMinor));
  if (!Number.isFinite(amount) || amount < 100 || amount > 100_000_00) {
    throw new Error("Tip amounts must be between $1 and $100,000.");
  }
  const speech = normalizeTipSpeech({ displayName: input.displayName, message: input.message });
  assertTipSpeech(speech);
  const nameScreen = screenDeterministically(speech.displayName);
  const messageScreen = screenDeterministically(speech.message);
  if (!nameScreen.allowed || !messageScreen.allowed) {
    throw new Error("This tip cannot be submitted.");
  }
  const moderation = await moderateComment(speech.message);
  if (moderation.status !== "approved") {
    throw new Error("This tip cannot be submitted.");
  }

  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("id, slug, status, tips_enabled, host_business_id")
    .eq("id", input.eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event || !event.host_business_id || !eventAcceptsTips(event)) {
    throw new Error("Tips are not open for this event.");
  }

  const idempotencyKey = input.userId
    ? `${input.userId}:${input.attemptId}`
    : `guest-tip:${input.guestEmail}:${input.attemptId}`;
  const messageSha256 = await sha256Text(speech.message);
  const provider = input.method === "usdc" ? "circle" : "stripe";

  const tipValues = {
    event_id: event.id,
    from_user_id: input.userId ?? null,
    to_business_id: event.host_business_id,
    amount_minor: amount,
    currency: "USD",
    message: speech.message,
    guest_display_name: speech.displayName,
    message_sha256: messageSha256,
    status: "created" as const,
    provider,
    idempotency_key: idempotencyKey,
  };

  const { data: insertedTip, error: tipError } = await supabaseAdmin
    .from("tips")
    .upsert(tipValues, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select(
      "id, event_id, from_user_id, amount_minor, currency, message, guest_display_name, message_sha256, provider, provider_record_id, deposit_address, quote_expires_at, status",
    )
    .maybeSingle();
  if (tipError) throw tipError;

  const { data: existingTip, error: existingTipError } = insertedTip
    ? { data: insertedTip, error: null }
    : await supabaseAdmin
        .from("tips")
        .select(
          "id, event_id, from_user_id, amount_minor, currency, message, guest_display_name, message_sha256, provider, provider_record_id, deposit_address, quote_expires_at, status",
        )
        .eq("idempotency_key", idempotencyKey)
        .single();
  if (existingTipError) throw existingTipError;
  if (
    !existingTip ||
    existingTip.event_id !== event.id ||
    existingTip.from_user_id !== (input.userId ?? null) ||
    existingTip.amount_minor !== amount ||
    existingTip.currency !== "USD" ||
    existingTip.message !== speech.message ||
    existingTip.guest_display_name !== speech.displayName ||
    existingTip.message_sha256 !== messageSha256 ||
    existingTip.provider !== provider
  ) {
    throw new Error("This tip attempt does not match the original request.");
  }
  if (existingTip.status === "paid" || existingTip.status === "refunded") {
    throw new Error("This tip attempt is already complete.");
  }

  if (input.method === "usdc") {
    return createUsdcQuoteForTip({
      eventId: event.id,
      tip: existingTip,
      amount,
      idempotencyKey,
      userId: input.userId ?? null,
      guestEmail: input.guestEmail ?? null,
      displayName: speech.displayName,
    });
  }

  return createStripeCheckoutForTip({
    eventSlug: event.slug,
    eventId: event.id,
    tip: existingTip,
    amount,
    idempotencyKey,
    userId: input.userId ?? null,
    guestEmail: input.guestEmail ?? null,
    displayName: speech.displayName,
  });
}

async function createStripeCheckoutForTip(input: {
  eventSlug: string;
  eventId: string;
  tip: { id: string; provider_record_id: string | null; status: string };
  amount: number;
  idempotencyKey: string;
  userId: string | null;
  guestEmail: string | null;
  displayName: string;
}): Promise<NamedTipResult> {
  const payment = await getOrCreatePaymentRecord({
    ...input,
    provider: "stripe",
    providerAccountId: getStripeRuntime().accountId,
  });
  const session = await createVariableAmountCheckout({
    kind: "tip",
    amountMinor: input.amount,
    currency: "USD",
    productName: "Accountabul live tip",
    referenceId: input.tip.id,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.guestEmail ? { customerEmail: input.guestEmail } : {}),
    successPath: `/live/${input.eventSlug}?tip=success`,
    cancelPath: `/live/${input.eventSlug}?tip=canceled`,
    idempotencyKey: input.idempotencyKey,
    metadata: {
      tip_id: input.tip.id,
      payment_record_id: payment.id,
      event_id: input.eventId,
      guest_display_name: input.displayName,
    },
  });
  await markTipProcessing({
    tipId: input.tip.id,
    paymentId: payment.id,
    providerRecordId: session.id,
    checkoutSessionId: session.id,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
  });
  return {
    tipId: input.tip.id,
    status: "processing",
    checkoutUrl: session.url,
    quote: null,
    note: "",
  };
}

async function createUsdcQuoteForTip(input: {
  eventId: string;
  tip: {
    id: string;
    provider_record_id: string | null;
    deposit_address: string | null;
    quote_expires_at: string | null;
    status: string;
  };
  amount: number;
  idempotencyKey: string;
  userId: string | null;
  guestEmail: string | null;
  displayName: string;
}): Promise<NamedTipResult> {
  if (!isCircleUsdcTipsConfigured()) {
    throw new Error("USDC tips are not available yet.");
  }
  const quoteStillValid =
    input.tip.provider_record_id &&
    input.tip.deposit_address &&
    input.tip.quote_expires_at &&
    new Date(input.tip.quote_expires_at).getTime() > Date.now();
  if (quoteStillValid) {
    const network = circleUsdcNetwork();
    const baseUnits = usdMinorToUsdcBaseUnits(input.amount);
    return {
      tipId: input.tip.id,
      status: "processing",
      checkoutUrl: null,
      quote: {
        depositAddress: input.tip.deposit_address as string,
        exactAssetAmount: usdcBaseUnitsToDecimal(baseUnits),
        network,
        expiresAt: input.tip.quote_expires_at as string,
        qrPayload: buildUsdcQrPayload({
          address: input.tip.deposit_address as string,
          network,
          baseUnits,
        }),
        asset: "USDC",
      },
      note: "",
    };
  }

  const payment = await getOrCreatePaymentRecord({
    ...input,
    provider: "circle",
    providerAccountId: process.env["CIRCLE_WALLET_SET_ID"] ?? null,
  });
  const quote = await getCryptoCheckoutAdapter().createQuote({
    referenceId: input.tip.id,
    usdAmountMinor: input.amount,
    asset: "USDC",
    network: circleUsdcNetwork(),
    expiresInSeconds: 15 * 60,
  });
  const metadata: Json = {
    guest_display_name: input.displayName,
    ...(input.guestEmail ? { guest_email: input.guestEmail } : {}),
    circle_wallet_id: quote.providerQuoteId,
    deposit_address: quote.depositAddress,
    network: circleUsdcNetwork(),
    exact_asset_amount: quote.exactAssetAmount,
    expires_at: quote.expiresAt,
  };
  const [tipUpdate, paymentUpdate] = await Promise.all([
    supabaseAdmin
      .from("tips")
      .update({
        status: "processing",
        provider_record_id: quote.providerQuoteId,
        deposit_address: quote.depositAddress,
        quote_expires_at: quote.expiresAt,
      })
      .eq("id", input.tip.id),
    supabaseAdmin
      .from("payment_records")
      .update({
        status: "processing",
        metadata,
      })
      .eq("id", payment.id),
  ]);
  if (tipUpdate.error) throw tipUpdate.error;
  if (paymentUpdate.error) throw paymentUpdate.error;

  return {
    tipId: input.tip.id,
    status: "processing",
    checkoutUrl: null,
    quote: {
      depositAddress: quote.depositAddress,
      exactAssetAmount: quote.exactAssetAmount,
      network: circleUsdcNetwork(),
      expiresAt: quote.expiresAt,
      qrPayload: quote.qrPayload,
      asset: "USDC",
    },
    note: "",
  };
}

async function getOrCreatePaymentRecord(input: {
  eventId: string;
  tip: { id: string };
  amount: number;
  idempotencyKey: string;
  userId: string | null;
  guestEmail: string | null;
  displayName: string;
  provider: "stripe" | "circle";
  providerAccountId: string | null;
}) {
  const metadata: Json = {
    guest_display_name: input.displayName,
    ...(input.guestEmail ? { guest_email: input.guestEmail } : {}),
  };
  const { data: inserted, error } = await supabaseAdmin
    .from("payment_records")
    .insert({
      kind: "tip",
      provider: input.provider,
      provider_account_id: input.providerAccountId,
      user_id: input.userId,
      event_id: input.eventId,
      tip_id: input.tip.id,
      amount_minor: input.amount,
      currency: "USD",
      status: "created",
      idempotency_key: input.idempotencyKey,
      metadata,
    })
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") throw error;
  if (inserted) return inserted;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("payment_records")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .single();
  if (existingError) throw existingError;
  return existing;
}

async function markTipProcessing(input: {
  tipId: string;
  paymentId: string;
  providerRecordId: string;
  checkoutSessionId: string;
  stripeCustomerId: string | null;
}) {
  const [tipUpdate, paymentUpdate] = await Promise.all([
    supabaseAdmin
      .from("tips")
      .update({ status: "processing", provider_record_id: input.providerRecordId })
      .eq("id", input.tipId),
    supabaseAdmin
      .from("payment_records")
      .update({
        checkout_session_id: input.checkoutSessionId,
        stripe_customer_id: input.stripeCustomerId,
        status: "processing",
      })
      .eq("id", input.paymentId),
  ]);
  if (tipUpdate.error) throw tipUpdate.error;
  if (paymentUpdate.error) throw paymentUpdate.error;
}
