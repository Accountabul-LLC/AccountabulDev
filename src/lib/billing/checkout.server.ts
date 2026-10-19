import type Stripe from "stripe";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getStripeRuntime,
  requirePublicSiteUrl,
  STRIPE_INTEGRATION_IDENTIFIER,
} from "@/lib/stripe/client.server";

export type CheckoutKind = "membership" | "event_pass" | "paid_comment" | "tip";

export async function getOrCreateStripeCustomer(userId: string) {
  const { accountId, client } = getStripeRuntime();
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("billing_customers")
    .select("id, stripe_customer_id, email")
    .eq("user_id", userId)
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data: userResult, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const email = userResult.user.email ?? undefined;
  const customer = await client.customers.create(
    {
      ...(email ? { email } : {}),
      metadata: { accountabul_user_id: userId },
    },
    { idempotencyKey: `accountabul-customer-${userId}` },
  );

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("billing_customers")
    .insert({
      user_id: userId,
      stripe_account_id: accountId,
      stripe_customer_id: customer.id,
      email: email ?? null,
    })
    .select("id, stripe_customer_id, email")
    .single();
  if (insertError) throw insertError;
  return inserted;
}

export async function createPriceCheckout(input: {
  kind: Exclude<CheckoutKind, "tip">;
  userId: string;
  priceId: string;
  mode: "payment" | "subscription";
  referenceId: string;
  successPath: string;
  cancelPath: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}) {
  const { client } = getStripeRuntime();
  const customer = await getOrCreateStripeCustomer(input.userId);
  const siteUrl = requirePublicSiteUrl();
  const metadata = {
    accountabul_kind: input.kind,
    accountabul_reference_id: input.referenceId,
    accountabul_user_id: input.userId,
    ...input.metadata,
  };

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: input.mode,
    integration_identifier: STRIPE_INTEGRATION_IDENTIFIER,
    customer: customer.stripe_customer_id,
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.referenceId,
    metadata,
    success_url: `${siteUrl}${input.successPath}`,
    cancel_url: `${siteUrl}${input.cancelPath}`,
    allow_promotion_codes: input.mode === "subscription",
  };
  if (input.mode === "payment") params.payment_intent_data = { metadata };
  if (input.mode === "subscription") params.subscription_data = { metadata };

  const session = await client.checkout.sessions.create(params, {
    idempotencyKey: input.idempotencyKey,
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return session;
}

export async function createVariableAmountCheckout(input: {
  /**
   * "tip" was the original caller. "event_pass" and "paid_comment" cover
   * per-event configurable pricing (watch, watch + chat, guest comments):
   * amounts vary per event, so there is no pre-created Stripe Price to point
   * at — Stripe is handed the amount at checkout time instead of via a stored
   * price id, exactly as tips already do.
   */
  kind: "tip" | "event_pass" | "paid_comment";
  amountMinor: number;
  currency: string;
  productName: string;
  referenceId: string;
  userId?: string;
  customerEmail?: string;
  successPath: string;
  cancelPath: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}) {
  const { client } = getStripeRuntime();
  const siteUrl = requirePublicSiteUrl();
  const metadata = {
    accountabul_kind: input.kind,
    accountabul_reference_id: input.referenceId,
    ...(input.userId ? { accountabul_user_id: input.userId } : {}),
    ...input.metadata,
  };

  const session = await client.checkout.sessions.create(
    {
      mode: "payment",
      integration_identifier: STRIPE_INTEGRATION_IDENTIFIER,
      ...(input.userId
        ? { customer: (await getOrCreateStripeCustomer(input.userId)).stripe_customer_id }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountMinor,
            product_data: { name: input.productName },
          },
          quantity: 1,
        },
      ],
      client_reference_id: input.referenceId,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${siteUrl}${input.successPath}`,
      cancel_url: `${siteUrl}${input.cancelPath}`,
    },
    { idempotencyKey: input.idempotencyKey },
  );
  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return session;
}
