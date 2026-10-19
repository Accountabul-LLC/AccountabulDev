import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isRetryableCircleUnmatched,
  parseCircleNotification,
  planCircleTipTransition,
  verifyCircleSignature,
} from "@/lib/crypto/circle-webhook";
import { constantTimeEqual } from "@/lib/security/constant-time";
import { circleUsdcNetwork, isCircleUsdcTipsConfigured } from "@/lib/crypto/circle-wallets.server";
import { publishPaidTipChat } from "@/lib/tips/publish.server";

export const Route = createFileRoute("/api/public/webhooks/circle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isCircleUsdcTipsConfigured()) {
          return new Response("Circle USDC tips are not configured", { status: 503 });
        }
        const publicKey = process.env["CIRCLE_WEBHOOK_PUBLIC_KEY"] ?? "";
        const expectedKeyId = process.env["CIRCLE_WEBHOOK_KEY_ID"] ?? "";
        const keyId = request.headers.get("x-circle-key-id") ?? "";
        if (!expectedKeyId || !constantTimeEqual(expectedKeyId, keyId)) {
          return new Response("Unknown Circle signing key", { status: 401 });
        }
        const signature = request.headers.get("x-circle-signature") ?? "";
        const rawBody = await request.text();
        if (!verifyCircleSignature(publicKey, signature, rawBody)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let notification;
        try {
          notification = parseCircleNotification(rawBody);
        } catch {
          return new Response("Invalid webhook", { status: 400 });
        }

        const { error: ledgerError } = await supabaseAdmin.from("payment_events").insert({
          provider: "circle",
          provider_event_id: notification.notificationId,
          event_type: notification.notificationType,
          payload: {
            wallet_id: notification.walletId,
            state: notification.state,
            amount: notification.amount,
            unmatched: notification.notificationType !== "transactions.inbound",
          },
        });
        if (ledgerError?.code === "23505") {
          const { data: existing, error: existingError } = await supabaseAdmin
            .from("payment_events")
            .select("processed_at, attempt_count")
            .eq("provider", "circle")
            .eq("provider_event_id", notification.notificationId)
            .single();
          if (existingError) throw existingError;
          if (existing.processed_at) return new Response("ok");
          const { error: attemptError } = await supabaseAdmin
            .from("payment_events")
            .update({ attempt_count: existing.attempt_count + 1, processing_error: null })
            .eq("provider", "circle")
            .eq("provider_event_id", notification.notificationId);
          if (attemptError) throw attemptError;
        } else if (ledgerError) {
          throw ledgerError;
        }

        if (notification.notificationType === "webhooks.test") {
          await markCircleEventProcessed(notification.notificationId, null);
          return new Response("ok");
        }

        if (!notification.walletId) {
          await markCircleEventProcessed(notification.notificationId, null, "missing_wallet");
          return new Response("ok");
        }

        const { data: tip, error: tipError } = await supabaseAdmin
          .from("tips")
          .select(
            "id, amount_minor, currency, provider_record_id, deposit_address, quote_expires_at, status",
          )
          .eq("provider", "circle")
          .eq("provider_record_id", notification.walletId)
          .maybeSingle();
        if (tipError) throw tipError;

        if (!tip) {
          await markCircleEventRetryable(notification.notificationId, null, "unmatched_wallet");
          await supabaseAdmin.from("provider_health").upsert(
            {
              provider: "crypto_checkout",
              status: "degraded",
              last_event_at: new Date().toISOString(),
              last_error_code: "unmatched_inbound",
              details: { wallet_id: notification.walletId },
            },
            { onConflict: "provider" },
          );
          return new Response("ok");
        }

        const transition = planCircleTipTransition(
          notification,
          {
            id: tip.id,
            amount_minor: tip.amount_minor,
            currency: tip.currency,
            provider_record_id: tip.provider_record_id,
            deposit_address: tip.deposit_address,
            quote_expires_at: tip.quote_expires_at,
            status: tip.status,
          },
          new Date(),
          circleUsdcNetwork(),
          process.env["CIRCLE_USDC_TOKEN_ID"] ?? null,
        );

        if (transition.kind !== "paid") {
          if (isRetryableCircleUnmatched(transition.reason)) {
            await markCircleEventRetryable(notification.notificationId, tip.id, transition.reason);
          } else {
            await markCircleEventProcessed(notification.notificationId, tip.id, transition.reason);
          }
          return new Response("ok");
        }

        const { error: updateError } = await supabaseAdmin
          .from("tips")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", tip.id)
          .in("status", transition.allowedCurrentStatuses);
        if (updateError) throw updateError;

        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payment_records")
          .select("id, status")
          .eq("tip_id", tip.id)
          .eq("provider", "circle")
          .maybeSingle();
        if (paymentError) throw paymentError;
        if (!payment) throw new Error("Circle tip is missing its payment record.");

        const { error: paymentUpdateError } = await supabaseAdmin
          .from("payment_records")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            crypto_transaction_id: notification.txHash ?? notification.transactionId,
          })
          .eq("id", payment.id)
          .in("status", ["created", "processing", "paid"]);
        if (paymentUpdateError) throw paymentUpdateError;
        await publishPaidTipChat({ tipId: tip.id, paymentRecordId: payment.id });

        await markCircleEventProcessed(notification.notificationId, tip.id);
        await supabaseAdmin.from("provider_health").upsert(
          {
            provider: "crypto_checkout",
            status: "healthy",
            last_event_at: new Date().toISOString(),
            last_error_at: null,
            last_error_code: null,
            details: { last_notification: notification.notificationType },
          },
          { onConflict: "provider" },
        );
        return new Response("ok");
      },
    },
  },
});

async function markCircleEventRetryable(
  notificationId: string,
  tipId: string | null,
  processingError: string,
) {
  const { error } = await supabaseAdmin
    .from("payment_events")
    .update({
      tip_id: tipId,
      processed_at: null,
      processing_error: processingError.slice(0, 1_000),
    })
    .eq("provider", "circle")
    .eq("provider_event_id", notificationId);
  if (error) throw error;
}

async function markCircleEventProcessed(
  notificationId: string,
  tipId: string | null,
  processingError?: string,
) {
  const { error } = await supabaseAdmin
    .from("payment_events")
    .update({
      tip_id: tipId,
      processed_at: new Date().toISOString(),
      processing_error: processingError ? processingError.slice(0, 1_000) : null,
    })
    .eq("provider", "circle")
    .eq("provider_event_id", notificationId);
  if (error) throw error;
}
