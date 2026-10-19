import { createFileRoute } from "@tanstack/react-router";

import {
  getStripePaidCommentId,
  getStripePaymentRecordId,
  getStripeTipId,
  getPaymentRecordOutcome,
  parseStripeEvent,
  planPaymentRecordTransition,
  planTipTransition,
  verifyStripeSignature,
  type PaymentRecordOutcome,
  type PaymentRecordForReconciliation,
  type TipForReconciliation,
} from "@/lib/stripe-webhook";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { eventPassExpiresAt } from "@/lib/conference/entitlements";
import { publishPaidTipChat } from "@/lib/tips/publish.server";
import { getStripeRuntime, requireStripeWebhookSecrets } from "@/lib/stripe/client.server";

/**
 * Stripe webhook. Reconciliation happens here and nowhere else: a client
 * redirect can never mark a tip paid. Repeated deliveries are idempotent
 * because payment_events has a unique (provider, provider_event_id).
 */
export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["STRIPE_WEBHOOK_SECRET"];
        const signatureHeader = request.headers.get("stripe-signature") ?? "";
        const rawBody = await request.text();
        let ledgerEventId: string | null = null;
        let ledgerRecorded = false;

        try {
          if (!secret) return new Response("Webhook secret not configured", { status: 503 });
          if (!(await verifyStripeSignature(rawBody, signatureHeader, secret))) {
            return new Response("Invalid signature", { status: 401 });
          }

          let event;
          try {
            event = parseStripeEvent(rawBody);
            ledgerEventId = event.id;
          } catch {
            return new Response("Invalid event", { status: 400 });
          }

          try {
            requireStripeWebhookSecrets();
          } catch {
            return new Response("Webhook key not configured", { status: 503 });
          }
          try {
            const { client } = getStripeRuntime("webhook");
            const remote = await client.events.retrieve(event.id);
            event = parseStripeEvent(JSON.stringify(remote));
          } catch {
            return new Response("Unable to load Stripe event", { status: 503 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const expectedAccountId = process.env["STRIPE_ACCOUNT_ID"];
          if (!expectedAccountId) {
            return new Response("Stripe account is not configured", { status: 503 });
          }
          if (event.account && event.account !== expectedAccountId) {
            return new Response("Wrong Stripe account", { status: 403 });
          }
          if (process.env["STRIPE_LIVE_MODE"] === "true" && event.livemode === false) {
            return new Response("Test-mode events are not accepted", { status: 403 });
          }

          const { error: ledgerError } = await supabaseAdmin.from("payment_events").insert({
            provider: "stripe",
            provider_event_id: event.id,
            event_type: event.type,
            payload: { type: event.type },
            provider_account_id: event.account ?? expectedAccountId ?? null,
            livemode: event.livemode ?? null,
          });
          if (ledgerError?.code === "23505") {
            const { data: existing, error: existingError } = await supabaseAdmin
              .from("payment_events")
              .select("processed_at, attempt_count")
              .eq("provider", "stripe")
              .eq("provider_event_id", event.id)
              .single();
            if (existingError) throw existingError;
            // Only completed events are duplicates. An unprocessed event must retry.
            if (existing.processed_at) return new Response("ok");
            const { error: attemptError } = await supabaseAdmin
              .from("payment_events")
              .update({ attempt_count: existing.attempt_count + 1, processing_error: null })
              .eq("provider", "stripe")
              .eq("provider_event_id", event.id);
            if (attemptError) throw attemptError;
          }
          if (ledgerError && ledgerError.code !== "23505") throw ledgerError;
          ledgerRecorded = true;

          const tipId = getStripeTipId(event);
          let paymentRecordId = getStripePaymentRecordId(event);
          if (
            !paymentRecordId &&
            event.type === "charge.refunded" &&
            typeof event.data.object["payment_intent"] === "string"
          ) {
            const { data: paymentByIntent, error: intentLookupError } = await supabaseAdmin
              .from("payment_records")
              .select("id")
              .eq("payment_intent_id", event.data.object["payment_intent"])
              .maybeSingle();
            if (intentLookupError) throw intentLookupError;
            paymentRecordId = typeof paymentByIntent?.id === "string" ? paymentByIntent.id : null;
          }

          if (tipId) {
            const { data: tip, error: tipError } = await supabaseAdmin
              .from("tips")
              .select("id, amount_minor, currency, provider_record_id, status")
              .eq("id", tipId)
              .single();
            if (tipError) throw tipError;

            const transition = planTipTransition(event, tip as TipForReconciliation);
            if (transition) {
              const patch =
                transition.status === "paid"
                  ? { status: transition.status, paid_at: new Date().toISOString() }
                  : { status: transition.status };
              const { data: updated, error: updateError } = await supabaseAdmin
                .from("tips")
                .update(patch)
                .eq("id", tipId)
                .in("status", transition.allowedCurrentStatuses)
                .select("id")
                .maybeSingle();
              if (updateError) throw updateError;

              if (!updated) {
                const { data: current, error: currentError } = await supabaseAdmin
                  .from("tips")
                  .select("status")
                  .eq("id", tipId)
                  .single();
                if (currentError) throw currentError;
                const supersededByTerminalStatus =
                  current.status === "refunded" ||
                  (transition.status === "failed" && current.status === "paid");
                if (current.status !== transition.status && !supersededByTerminalStatus) {
                  throw new Error("Tip status changed during Stripe reconciliation.");
                }
              }
            }
          }

          if (paymentRecordId) {
            const { data: payment, error: paymentError } = await supabaseAdmin
              .from("payment_records")
              .select(
                "id, kind, user_id, event_id, tip_id, amount_minor, currency, checkout_session_id, status, metadata",
              )
              .eq("id", paymentRecordId)
              .single();
            if (paymentError) throw paymentError;

            const transition = planPaymentRecordTransition(
              event,
              payment as PaymentRecordForReconciliation,
            );
            const outcome = getPaymentRecordOutcome(
              event,
              payment as PaymentRecordForReconciliation,
            );
            let sideEffectTransition: PaymentRecordOutcome["status"] | null = null;
            if (transition) {
              const { data: updated, error: paymentUpdateError } = await supabaseAdmin
                .from("payment_records")
                .update({
                  status: transition.status,
                  ...(transition.status === "paid" ? { paid_at: new Date().toISOString() } : {}),
                  ...(typeof transition.refundedAmountMinor === "number"
                    ? { refunded_amount_minor: transition.refundedAmountMinor }
                    : {}),
                  ...(typeof event.data.object["payment_intent"] === "string"
                    ? { payment_intent_id: event.data.object["payment_intent"] }
                    : {}),
                })
                .eq("id", paymentRecordId)
                .in("status", transition.allowedCurrentStatuses)
                .select("id")
                .maybeSingle();
              if (paymentUpdateError) throw paymentUpdateError;

              if (updated) {
                sideEffectTransition = transition.status;
              }
            } else if (outcome && payment.status === outcome.status) {
              // The previous delivery may have committed the payment update and
              // then failed before its idempotent side effect completed.
              sideEffectTransition = outcome.status;
            }

            if (sideEffectTransition) {
              await applyPaymentSideEffect({
                event,
                payment: payment as PaymentRecordForReconciliation & {
                  kind: string;
                  user_id: string | null;
                  event_id: string | null;
                  tip_id: string | null;
                  metadata: Record<string, unknown>;
                },
                transition: sideEffectTransition,
              });
            }
          }

          if (event.type.startsWith("customer.subscription.")) {
            await reconcileMembershipSubscription(event);
          }
          if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
            await reconcileMembershipInvoice(event);
          }

          const { error: processedError } = await supabaseAdmin
            .from("payment_events")
            .update({
              tip_id: tipId,
              payment_record_id: paymentRecordId,
              processed_at: new Date().toISOString(),
              processing_error: null,
            })
            .eq("provider", "stripe")
            .eq("provider_event_id", event.id);
          if (processedError) throw processedError;

          return new Response("ok");
        } catch (error) {
          if (ledgerRecorded && ledgerEventId) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const message = error instanceof Error ? error.message : "Unknown webhook error";
            const { error: diagnosticError } = await supabaseAdmin
              .from("payment_events")
              .update({ processing_error: message.slice(0, 1_000) })
              .eq("provider", "stripe")
              .eq("provider_event_id", ledgerEventId);
            if (diagnosticError)
              console.error("Failed to record Stripe webhook error", diagnosticError);
          }
          throw error;
        }
      },
    },
  },
});

async function applyPaymentSideEffect(input: {
  event: ReturnType<typeof parseStripeEvent>;
  payment: PaymentRecordForReconciliation & {
    kind: string;
    user_id: string | null;
    event_id: string | null;
    tip_id: string | null;
    metadata: Record<string, unknown>;
  };
  transition: "paid" | "failed" | "refunded" | "partially_refunded";
}) {
  if (input.payment.kind === "tip" && input.transition === "paid") {
    if (!input.payment.tip_id) throw new Error("Tip payment is missing its tip reference.");
    await publishPaidTipChat({
      tipId: input.payment.tip_id,
      paymentRecordId: input.payment.id,
    });
  }

  if (input.payment.kind === "event_pass" && input.payment.event_id) {
    if (input.transition === "paid") {
      const { data: existingPass, error: lookupError } = await supabaseAdmin
        .from("event_passes")
        .select("id, expires_at")
        .eq("payment_record_id", input.payment.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existingPass) {
        const expiresAt =
          typeof existingPass.expires_at === "string" && existingPass.expires_at
            ? existingPass.expires_at
            : eventPassExpiresAt();
        const { error } = await supabaseAdmin
          .from("event_passes")
          .update({
            status: "active",
            activated_at: new Date().toISOString(),
            expires_at: expiresAt,
          })
          .eq("payment_record_id", input.payment.id)
          .eq("status", "pending");
        if (error) throw error;
      } else if (input.payment.user_id) {
        const accessType =
          input.payment.metadata["access_type"] === "watch" ? "watch" : "watch_and_chat";
        const { error } = await supabaseAdmin.from("event_passes").insert({
          event_id: input.payment.event_id,
          user_id: input.payment.user_id,
          access_type: accessType,
          payment_record_id: input.payment.id,
          status: "active",
          activated_at: new Date().toISOString(),
          expires_at: eventPassExpiresAt(),
        });
        if (error && error.code !== "23505") throw error;
      } else {
        throw new Error("Guest event pass is missing its pending entitlement record.");
      }
    } else if (input.transition === "refunded") {
      const { error } = await supabaseAdmin
        .from("event_passes")
        .update({ status: "refunded" })
        .eq("payment_record_id", input.payment.id);
      if (error) throw error;
    }
  }

  if (input.payment.kind === "paid_comment") {
    const paidCommentId = getStripePaidCommentId(input.event);
    if (!paidCommentId) throw new Error("Paid comment payment is missing its comment reference.");
    if (input.transition === "paid")
      await publishPaidComment(paidCommentId, input.payment.id, input.event);
    if (input.transition === "failed" || input.transition === "refunded") {
      const { error } = await supabaseAdmin
        .from("paid_comments")
        .update({ status: input.transition === "refunded" ? "refunded" : "payment_failed" })
        .eq("id", paidCommentId)
        .eq("payment_record_id", input.payment.id);
      if (error) throw error;
    }
  }
}

async function publishPaidComment(
  paidCommentId: string,
  paymentRecordId: string,
  event: ReturnType<typeof parseStripeEvent>,
) {
  const { data: comment, error: commentError } = await supabaseAdmin
    .from("paid_comments")
    .select(
      "id, event_id, user_id, guest_display_name, body, body_sha256, approved_body_sha256, status, payment_record_id, chat_message_id",
    )
    .eq("id", paidCommentId)
    .single();
  if (commentError) throw commentError;
  const bodyHash = comment["body_sha256"];
  const exactPaymentReference = comment["payment_record_id"] === paymentRecordId;
  const exactApprovedText =
    comment["approved_body_sha256"] === bodyHash &&
    event.data.object.metadata?.["body_sha256"] === bodyHash;
  if (comment["status"] === "published" && exactPaymentReference && exactApprovedText) return;
  if (comment["status"] !== "checkout_created" || !exactPaymentReference || !exactApprovedText) {
    throw new Error("Paid comment approval or exact-text hash does not match the payment.");
  }

  // A signed-in member's $1 comment speaks as that member, with their photo.
  const authorId = typeof comment["user_id"] === "string" ? comment["user_id"] : null;
  const { loadAuthorIdentity, screenAfterPublication } =
    await import("@/lib/conference/live-chat.server");
  const identity = authorId ? await loadAuthorIdentity(authorId).catch(() => null) : null;

  const { data: message, error: messageError } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      event_id: String(comment["event_id"]),
      user_id: authorId,
      body: String(comment["body"]),
      source: "paid_guest",
      external_id: paymentRecordId,
      author_display_name: identity?.displayName ?? String(comment["guest_display_name"]),
      author_avatar_url: identity?.avatarUrl ?? null,
      author_badge: "paid_guest",
      moderation_status: "approved",
      content_sha256: String(bodyHash),
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (messageError && messageError.code !== "23505") throw messageError;
  if (message?.id) screenAfterPublication(message.id, String(comment["body"]));
  let messageId = message?.id ?? null;
  if (!messageId && messageError?.code === "23505") {
    const { data: existingMessage, error: existingMessageError } = await supabaseAdmin
      .from("chat_messages")
      .select("id")
      .eq("event_id", String(comment["event_id"]))
      .eq("source", "paid_guest")
      .eq("external_id", paymentRecordId)
      .single();
    if (existingMessageError) throw existingMessageError;
    messageId = existingMessage.id;
  }

  const { error: updateError } = await supabaseAdmin
    .from("paid_comments")
    .update({ status: "published", chat_message_id: messageId })
    .eq("id", paidCommentId)
    .eq("status", "checkout_created");
  if (updateError) throw updateError;
}

async function reconcileMembershipSubscription(event: ReturnType<typeof parseStripeEvent>) {
  const object = event.data.object;
  if (
    typeof object.id !== "string" ||
    typeof object.customer !== "string" ||
    typeof object.status !== "string"
  ) {
    throw new Error("Invalid Stripe subscription event.");
  }
  const expectedAccountId = process.env["STRIPE_ACCOUNT_ID"];
  if (!expectedAccountId) throw new Error("Stripe account is not configured.");
  const { data: customer, error: customerError } = await supabaseAdmin
    .from("billing_customers")
    .select("id, user_id, stripe_account_id")
    .eq("stripe_account_id", expectedAccountId)
    .eq("stripe_customer_id", object.customer)
    .single();
  if (customerError) throw customerError;

  const items = object["items"] as { data?: Array<Record<string, unknown>> } | undefined;
  const item = items?.data?.[0];
  const price = item?.["price"] as Record<string, unknown> | undefined;
  const productValue = price?.["product"];
  const productId =
    typeof productValue === "string"
      ? productValue
      : (productValue as Record<string, unknown>)?.["id"];
  if (typeof price?.["id"] !== "string" || typeof productId !== "string") {
    throw new Error("Stripe subscription is missing its Price or Product.");
  }
  const metadata = object.metadata ?? {};
  const tierKey = metadata["tier_key"] || "membership";
  const toTimestamp = (value: unknown) =>
    typeof value === "number" ? new Date(value * 1000).toISOString() : null;
  const periodStart = toTimestamp(item?.["current_period_start"] ?? object["current_period_start"]);
  const periodEnd = toTimestamp(item?.["current_period_end"] ?? object["current_period_end"]);
  if ((object.status === "active" || object.status === "trialing") && !periodEnd) {
    throw new Error("Stripe subscription is missing its current period end.");
  }

  const { data: existing } = await supabaseAdmin
    .from("membership_subscriptions")
    .select("status, grace_expires_at")
    .eq("stripe_account_id", customer.stripe_account_id)
    .eq("stripe_subscription_id", object.id)
    .maybeSingle();
  const graceExpiresAt =
    object.status === "past_due"
      ? existing?.status === "past_due" && existing.grace_expires_at
        ? existing.grace_expires_at
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { error } = await supabaseAdmin.from("membership_subscriptions").upsert(
    {
      user_id: customer.user_id,
      billing_customer_id: customer.id,
      stripe_account_id: customer.stripe_account_id,
      stripe_subscription_id: object.id,
      stripe_product_id: productId,
      stripe_price_id: price["id"],
      tier_key: tierKey,
      status: object.status as Database["public"]["Enums"]["membership_subscription_status"],
      cancel_at_period_end: object["cancel_at_period_end"] === true,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      grace_expires_at: graceExpiresAt,
      canceled_at: toTimestamp(object["canceled_at"]),
    },
    { onConflict: "stripe_account_id,stripe_subscription_id" },
  );
  if (error) throw error;
}

async function reconcileMembershipInvoice(event: ReturnType<typeof parseStripeEvent>) {
  const object = event.data.object;
  const expectedAccountId = process.env["STRIPE_ACCOUNT_ID"];
  if (
    !expectedAccountId ||
    typeof object.id !== "string" ||
    typeof object.customer !== "string" ||
    typeof object.currency !== "string"
  ) {
    throw new Error("Invalid Stripe membership invoice event.");
  }

  const { data: customer, error: customerError } = await supabaseAdmin
    .from("billing_customers")
    .select("id, user_id, stripe_account_id")
    .eq("stripe_account_id", expectedAccountId)
    .eq("stripe_customer_id", object.customer)
    .single();
  if (customerError) throw customerError;

  const failed = event.type === "invoice.payment_failed";
  const amountMinor = failed ? object.amount_due : object.amount_paid;
  if (typeof amountMinor === "number" && amountMinor > 0) {
    const idempotencyKey = `stripe-invoice:${expectedAccountId}:${object.id}`;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("payment_records")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existing) {
      const { error: insertError } = await supabaseAdmin.from("payment_records").insert({
        kind: "membership",
        provider: "stripe",
        provider_account_id: expectedAccountId,
        user_id: customer.user_id,
        stripe_customer_id: object.customer,
        payment_intent_id: typeof object.payment_intent === "string" ? object.payment_intent : null,
        amount_minor: amountMinor,
        currency: object.currency.toUpperCase(),
        status: failed ? "failed" : "paid",
        idempotency_key: idempotencyKey,
        metadata: {
          stripe_invoice_id: object.id,
          ...(typeof object.subscription === "string"
            ? { stripe_subscription_id: object.subscription }
            : {}),
        },
        paid_at: failed ? null : new Date().toISOString(),
      });
      if (insertError) throw insertError;
    } else if (!failed && existing.status !== "paid" && existing.status !== "refunded") {
      const { error: recoveryError } = await supabaseAdmin
        .from("payment_records")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", existing.id)
        .in("status", ["created", "requires_action", "processing", "failed"]);
      if (recoveryError) throw recoveryError;
    }
  }

  if (typeof object.subscription !== "string") return;
  if (failed) {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from("membership_subscriptions")
      .select("status, grace_expires_at")
      .eq("stripe_account_id", expectedAccountId)
      .eq("stripe_subscription_id", object.subscription)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (subscription && ["active", "past_due"].includes(String(subscription.status))) {
      const graceExpiresAt =
        subscription.status === "past_due" && subscription.grace_expires_at
          ? subscription.grace_expires_at
          : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const { error: graceError } = await supabaseAdmin
        .from("membership_subscriptions")
        .update({ status: "past_due", grace_expires_at: graceExpiresAt })
        .eq("stripe_account_id", expectedAccountId)
        .eq("stripe_subscription_id", object.subscription);
      if (graceError) throw graceError;
    }
    return;
  }

  const { error: recoveryError } = await supabaseAdmin
    .from("membership_subscriptions")
    .update({ status: "active", grace_expires_at: null })
    .eq("stripe_account_id", expectedAccountId)
    .eq("stripe_subscription_id", object.subscription)
    .in("status", ["past_due", "unpaid"]);
  if (recoveryError) throw recoveryError;
}
