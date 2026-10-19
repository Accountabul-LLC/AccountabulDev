import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const createMembershipCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { tierKey: string; billingInterval: "monthly" | "annual"; attemptId: string }) => {
      if (!IDENTIFIER.test(input.tierKey)) throw new Error("Invalid membership tier.");
      if (!(["monthly", "annual"] as const).includes(input.billingInterval)) {
        throw new Error("Invalid membership billing interval.");
      }
      if (!UUID.test(input.attemptId)) throw new Error("Invalid checkout attempt.");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createPriceCheckout } = await import("@/lib/billing/checkout.server");
    const { requireStripeCheckoutSecrets } = await import("@/lib/stripe/client.server");
    requireStripeCheckoutSecrets();
    const { data: tier, error: tierError } = await supabaseAdmin
      .from("membership_tiers")
      .select("slug, is_active, stripe_price_id_monthly, stripe_price_id_annual")
      .eq("slug", data.tierKey)
      .maybeSingle();
    if (tierError) throw tierError;
    if (!tier?.is_active) throw new Error("That membership plan is not available.");

    const envKey = `STRIPE_MEMBERSHIP_PRICE_${data.tierKey.toUpperCase().replace(/-/g, "_")}_${data.billingInterval.toUpperCase()}`;
    const priceId =
      (data.billingInterval === "annual"
        ? tier.stripe_price_id_annual
        : tier.stripe_price_id_monthly) ?? process.env[envKey];
    if (!priceId?.startsWith("price_"))
      throw new Error(`Membership tier ${data.tierKey} is not configured.`);

    const session = await createPriceCheckout({
      kind: "membership",
      userId: context.userId,
      priceId,
      mode: "subscription",
      referenceId: context.userId,
      successPath: "/dashboard/billing?checkout=success",
      cancelPath: "/dashboard/billing?checkout=canceled",
      idempotencyKey: `membership:${context.userId}:${data.attemptId}`,
      metadata: { tier_key: data.tierKey, billing_interval: data.billingInterval },
    });
    return { checkoutUrl: session.url };
  });

export const createCustomerPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getOrCreateStripeCustomer } = await import("@/lib/billing/checkout.server");
    const { getStripeRuntime, requirePublicSiteUrl } = await import("@/lib/stripe/client.server");
    const { client } = getStripeRuntime();
    const customer = await getOrCreateStripeCustomer(context.userId);
    const session = await client.billingPortal.sessions.create({
      customer: customer.stripe_customer_id,
      return_url: `${requirePublicSiteUrl()}/dashboard/billing`,
    });
    return { portalUrl: session.url };
  });

export const getCheckoutReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { missingStripeCheckoutSecrets } = await import("@/lib/stripe/client.server");
    const missing = missingStripeCheckoutSecrets();
    return { ready: missing.length === 0, missing };
  });

export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { missingStripeCheckoutSecrets } = await import("@/lib/stripe/client.server");
    const [
      { data: subscription, error: subscriptionError },
      { data: payments, error: paymentsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("membership_subscriptions")
        .select(
          "id, tier_key, status, cancel_at_period_end, current_period_end, grace_expires_at, created_at",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("payment_records")
        .select("id, kind, amount_minor, currency, status, created_at, paid_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (subscriptionError) throw subscriptionError;
    if (paymentsError) throw paymentsError;
    const missingCheckoutSecrets = missingStripeCheckoutSecrets();
    return {
      subscription,
      payments: payments ?? [],
      checkoutReady: missingCheckoutSecrets.length === 0,
      missingCheckoutSecrets,
    };
  });

/**
 * Buy watch or watch + chat access to one event, at whatever that event is
 * currently configured to charge. See event-access.server.ts: the amount is
 * read fresh from the event row here, never accepted from the caller, and a
 * price of 0 grants access directly without going near Stripe.
 */
export const createEventPassCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { eventId: string; accessType: "watch" | "watch_and_chat"; attemptId: string }) => {
      if (!UUID.test(input.eventId) || !UUID.test(input.attemptId))
        throw new Error("Invalid event checkout.");
      if (input.accessType !== "watch" && input.accessType !== "watch_and_chat") {
        throw new Error("Invalid access type.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { loadEventForAccessPurchase, purchaseEventAccess } =
      await import("@/lib/conference/event-access.server");
    const event = await loadEventForAccessPurchase(data.eventId);
    const result = await purchaseEventAccess({
      event,
      accessType: data.accessType,
      attemptId: data.attemptId,
      buyer: { userId: context.userId },
      successPath: `/live/${event.slug}?pass=success`,
      cancelPath: `/live/${event.slug}?pass=canceled`,
    });
    if (result.outcome === "unavailable") throw new Error(result.reason);
    return result.outcome === "granted"
      ? { checkoutUrl: null, granted: true as const }
      : { checkoutUrl: result.checkoutUrl, granted: false as const };
  });
