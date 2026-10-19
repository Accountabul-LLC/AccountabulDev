import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createVariableAmountCheckout } from "@/lib/billing/checkout.server";
import { eventPassExpiresAt } from "@/lib/conference/entitlements";
import {
  offerFor,
  type EventAccessType,
  type EventPricingRow,
} from "@/lib/conference/event-pricing";
import { missingStripeCheckoutSecrets } from "@/lib/stripe/client.server";

/**
 * Buying watch or watch+chat access to one event.
 *
 * Shared by the authenticated purchase (billing.functions.ts) and the
 * anonymous/guest purchase (routes/api/public/event-passes.ts) so there is one
 * place that reads the event's configured price, one place that skips Stripe
 * for a free event, and one place that shapes the payment_records row the
 * webhook reconciles. Amounts always come from the event row this function
 * reads itself — a caller can request an access type, never a price.
 */

const EVENT_PRODUCT_NAME: Record<EventAccessType, string> = {
  watch: "Accountabul live event — watch access",
  watch_and_chat: "Accountabul live event — watch + chat access",
};

export type EventForAccessPurchase = {
  id: string;
  slug: string;
  status: string;
} & EventPricingRow;

export async function loadEventForAccessPurchase(eventId: string) {
  const { data: event, error } = await supabaseAdmin
    .from("events")
    .select(
      "id, slug, status, access_mode, watch_price_minor, allow_watch_purchase, watch_and_chat_price_minor, allow_watch_and_chat_purchase, guest_comment_price_minor, allow_guest_comment, pricing_currency",
    )
    .eq("id", eventId)
    .single();
  if (error) throw error;
  return event as EventForAccessPurchase;
}

export type AccessPurchaseResult =
  | { outcome: "granted" }
  | { outcome: "checkout"; checkoutUrl: string }
  | { outcome: "unavailable"; reason: string };

/**
 * Starts (or, for a free event, completes) a purchase of watch or
 * watch+chat access for one signed-in or guest buyer.
 */
export async function purchaseEventAccess(input: {
  event: EventForAccessPurchase;
  accessType: EventAccessType;
  attemptId: string;
  /**
   * A signed-in buyer gets a real user_id pass. A guest has no account, so
   * they are recognized afterward by the hashed token in their cookie — the
   * caller mints the raw token, sets the cookie, and passes only the hash
   * here (see routes/api/public/event-passes.ts).
   */
  buyer: { userId: string } | { email: string; accessTokenHash: string };
  successPath: string;
  cancelPath: string;
}): Promise<AccessPurchaseResult> {
  const { event, accessType, buyer } = input;

  if (
    event.access_mode !== "subscriber_or_pass" ||
    (event.status !== "scheduled" && event.status !== "live")
  ) {
    return { outcome: "unavailable", reason: "This event does not sell that kind of access." };
  }
  const offer = offerFor(event, accessType);
  if (!offer) {
    return { outcome: "unavailable", reason: "This event does not sell that kind of access." };
  }

  if (offer.free) {
    const now = new Date();
    const { error } = await supabaseAdmin.from("event_passes").insert({
      event_id: event.id,
      ...("userId" in buyer
        ? { user_id: buyer.userId }
        : { purchaser_email: buyer.email, access_token_hash: buyer.accessTokenHash }),
      access_type: accessType,
      status: "active",
      granted_free: true,
      activated_at: now.toISOString(),
      expires_at: eventPassExpiresAt(now),
    });
    // A user can already hold this exact free grant (e.g. a retried request);
    // that is success, not an error.
    if (error && error.code !== "23505") throw error;
    return { outcome: "granted" };
  }

  if (missingStripeCheckoutSecrets().length > 0) {
    return { outcome: "unavailable", reason: "Checkout is not configured." };
  }

  const { getStripeRuntime } = await import("@/lib/stripe/client.server");
  const { accountId } = getStripeRuntime();
  const buyerKey = "userId" in buyer ? buyer.userId : buyer.email;
  const idempotencyKey = `event-access:${event.id}:${accessType}:${buyerKey}:${input.attemptId}`;
  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payment_records")
    .insert({
      kind: "event_pass",
      provider: "stripe",
      provider_account_id: accountId,
      event_id: event.id,
      ...("userId" in buyer ? { user_id: buyer.userId } : {}),
      amount_minor: offer.amountMinor,
      currency: offer.currency,
      status: "created",
      idempotency_key: idempotencyKey,
      metadata: {
        access_type: accessType,
        ...("email" in buyer ? { purchaser_email: buyer.email } : {}),
      },
    })
    .select("id")
    .single();
  if (paymentError) throw paymentError;

  // A guest checkout has no account to attach a pending pass to later, so it
  // needs a pending event_passes row now, keyed by the hashed cookie token,
  // for both the webhook to activate and loadEntitlement to find afterward.
  if ("email" in buyer) {
    const { error: pendingError } = await supabaseAdmin.from("event_passes").insert({
      event_id: event.id,
      purchaser_email: buyer.email,
      access_type: accessType,
      access_token_hash: buyer.accessTokenHash,
      payment_record_id: payment.id,
      status: "pending",
    });
    if (pendingError) throw pendingError;
  }

  try {
    const session = await createVariableAmountCheckout({
      kind: "event_pass",
      amountMinor: offer.amountMinor,
      currency: offer.currency,
      productName: EVENT_PRODUCT_NAME[accessType],
      referenceId: payment.id,
      ...("userId" in buyer ? { userId: buyer.userId } : { customerEmail: buyer.email }),
      successPath: input.successPath,
      cancelPath: input.cancelPath,
      idempotencyKey,
      metadata: { access_type: accessType, event_id: event.id, payment_record_id: payment.id },
    });

    const { error: updateError } = await supabaseAdmin
      .from("payment_records")
      .update({ checkout_session_id: session.id, status: "processing" })
      .eq("id", payment.id);
    if (updateError) throw updateError;

    return { outcome: "checkout", checkoutUrl: session.url! };
  } catch (error) {
    await Promise.all([
      supabaseAdmin
        .from("payment_records")
        .update({ status: "canceled" })
        .eq("id", payment.id)
        .eq("status", "created"),
      "email" in buyer
        ? supabaseAdmin
            .from("event_passes")
            .delete()
            .eq("payment_record_id", payment.id)
            .eq("status", "pending")
        : Promise.resolve({ error: null }),
    ]);
    throw error;
  }
}
