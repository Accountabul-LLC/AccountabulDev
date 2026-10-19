import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { getStripeRuntime } from "@/lib/stripe/client.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

export const Route = createFileRoute("/api/internal/ops/payments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const [
          { data: payments, error: paymentsError },
          { data: failures, error: failuresError },
          { data: unmatched, error: unmatchedError },
        ] = await Promise.all([
          supabaseAdmin
            .from("payment_records")
            .select(
              "id, kind, provider, provider_account_id, user_id, event_id, tip_id, amount_minor, refunded_amount_minor, currency, status, checkout_session_id, payment_intent_id, crypto_transaction_id, metadata, created_at, updated_at, paid_at",
            )
            .order("created_at", { ascending: false })
            .limit(200),
          supabaseAdmin
            .from("payment_events")
            .select(
              "id, provider, provider_event_id, event_type, provider_account_id, attempt_count, processing_error, created_at",
            )
            .is("processed_at", null)
            .order("created_at", { ascending: true })
            .limit(200),
          supabaseAdmin
            .from("payment_events")
            .select(
              "id, provider, provider_event_id, event_type, processing_error, payload, created_at, processed_at",
            )
            .eq("provider", "circle")
            .not("processing_error", "is", null)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        if (paymentsError) throw paymentsError;
        if (failuresError) throw failuresError;
        if (unmatchedError) throw unmatchedError;
        return Response.json({
          payments: (payments ?? []).map((payment) => {
            const metadata =
              payment.metadata &&
              typeof payment.metadata === "object" &&
              !Array.isArray(payment.metadata)
                ? (payment.metadata as Record<string, unknown>)
                : {};
            return {
              ...payment,
              displayName:
                typeof metadata["guest_display_name"] === "string"
                  ? metadata["guest_display_name"]
                  : null,
              provider_reference:
                payment.crypto_transaction_id ??
                payment.payment_intent_id ??
                payment.checkout_session_id,
            };
          }),
          unmatchedCryptoDeposits: unmatched ?? [],
          webhookFailures: (failures ?? []).map((failure) => ({
            ...failure,
            attempts: failure.attempt_count,
            last_error: failure.processing_error,
            last_attempt_at: failure.created_at,
            reconciliation_status: "pending",
          })),
        });
      },
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        if (process.env["STRIPE_OPERATIONS_MUTATIONS_ENABLED"] !== "true") {
          return Response.json(
            { error: "Stripe operations mutations are disabled in this environment." },
            { status: 503 },
          );
        }

        const payload = (await request.json()) as Record<string, unknown>;
        const paymentId = typeof payload["paymentId"] === "string" ? payload["paymentId"] : "";
        const attemptId = typeof payload["attemptId"] === "string" ? payload["attemptId"] : "";
        const requestedAmount = Number(payload["amountMinor"]);
        if (!UUID.test(paymentId) || !UUID.test(attemptId)) {
          return Response.json(
            { error: "Valid payment and attempt IDs are required." },
            { status: 400 },
          );
        }

        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payment_records")
          .select(
            "id, provider, provider_account_id, payment_intent_id, amount_minor, refunded_amount_minor, currency, status",
          )
          .eq("id", paymentId)
          .single();
        if (paymentError) throw paymentError;
        const { accountId, client } = getStripeRuntime("operations");
        if (
          payment.provider !== "stripe" ||
          payment.provider_account_id !== accountId ||
          !payment.payment_intent_id ||
          !["paid", "partially_refunded"].includes(payment.status)
        ) {
          return Response.json(
            { error: "This payment is not eligible for a Stripe refund." },
            { status: 409 },
          );
        }
        const refundable = payment.amount_minor - payment.refunded_amount_minor;
        const amountMinor = Number.isSafeInteger(requestedAmount) ? requestedAmount : refundable;
        if (amountMinor < 1 || amountMinor > refundable) {
          return Response.json(
            { error: "Refund amount exceeds the refundable balance." },
            { status: 400 },
          );
        }

        const refund = await client.refunds.create(
          {
            payment_intent: payment.payment_intent_id,
            amount: amountMinor,
            reason: "requested_by_customer",
            metadata: {
              accountabul_payment_record_id: paymentId,
              accountabul_attempt_id: attemptId,
            },
          },
          { idempotencyKey: `ops-refund:${paymentId}:${attemptId}` },
        );
        const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
          action: "ops.payment.refund_requested",
          target_table: "payment_records",
          target_id: paymentId,
          request_id: request.headers.get("x-request-id"),
          diff: { amount_minor: amountMinor, stripe_refund_id: refund.id },
        });
        if (auditError) throw auditError;
        return Response.json({
          refundId: refund.id,
          status: refund.status,
          amountMinor: refund.amount,
          currency: refund.currency,
          note: "The signed Stripe webhook remains authoritative for Accountabul payment status.",
        });
      },
    },
  },
});
