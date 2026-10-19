import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  canCreatePaidCommentCheckout,
  PAID_COMMENT_PRICE_MINOR,
} from "@/lib/conference/moderation";
import { emailsMatch, normalizeEmail } from "@/lib/security/emails";
import { rateLimitResponse } from "@/lib/security/rate-limit.server";
import {
  getStripeRuntime,
  requirePublicSiteUrl,
  STRIPE_INTEGRATION_IDENTIFIER,
  stripeCheckoutUnavailableResponse,
} from "@/lib/stripe/client.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/paid-comments/$id/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const limited = await rateLimitResponse(request, "paid-comment-checkout", 8, 10 * 60_000);
        if (limited) return limited;
        const unavailable = stripeCheckoutUnavailableResponse();
        if (unavailable) return unavailable;
        const payload = (await request.json()) as Record<string, unknown>;
        const attemptId = typeof payload["attemptId"] === "string" ? payload["attemptId"] : "";
        const guestEmail =
          typeof payload["guestEmail"] === "string" ? normalizeEmail(payload["guestEmail"]) : "";
        if (!UUID.test(params.id) || !UUID.test(attemptId) || !guestEmail) {
          return Response.json({ error: "Invalid checkout request." }, { status: 400 });
        }

        const { data: comment, error: commentError } = await supabaseAdmin
          .from("paid_comments")
          .select(
            "id, event_id, guest_email, body_sha256, approved_body_sha256, status, expires_at",
          )
          .eq("id", params.id)
          .single();
        if (commentError) throw commentError;
        if (!emailsMatch(guestEmail, String(comment["guest_email"] ?? ""))) {
          return Response.json(
            { error: "Checkout is not available for this comment." },
            { status: 403 },
          );
        }
        if (
          !canCreatePaidCommentCheckout({
            status: String(comment["status"]),
            bodySha256: String(comment["body_sha256"]),
            approvedBodySha256:
              typeof comment["approved_body_sha256"] === "string"
                ? comment["approved_body_sha256"]
                : null,
            expiresAt: typeof comment["expires_at"] === "string" ? comment["expires_at"] : null,
          })
        ) {
          return Response.json(
            { error: "This exact comment is not approved for checkout." },
            { status: 409 },
          );
        }

        const eventId = String(comment["event_id"]);
        const { data: event, error: eventError } = await supabaseAdmin
          .from("events")
          .select("slug, status, chat_enabled")
          .eq("id", eventId)
          .single();
        if (eventError) throw eventError;
        if (!event.chat_enabled || event.status !== "live") {
          return Response.json(
            { error: "Paid comments are closed for this event." },
            { status: 409 },
          );
        }

        const priceId = process.env["STRIPE_PAID_COMMENT_PRICE_ID"];
        if (!priceId?.startsWith("price_")) {
          return Response.json(
            { error: "Paid comment checkout is not configured." },
            { status: 503 },
          );
        }
        const { accountId, client } = getStripeRuntime();
        const idempotencyKey = `paid-comment:${params.id}:${attemptId}`;
        const { data: payment, error: paymentError } = await supabaseAdmin
          .from("payment_records")
          .insert({
            kind: "paid_comment",
            provider: "stripe",
            provider_account_id: accountId,
            event_id: eventId,
            amount_minor: PAID_COMMENT_PRICE_MINOR,
            currency: "USD",
            status: "created",
            idempotency_key: idempotencyKey,
            metadata: { paid_comment_id: params.id },
          })
          .select("id")
          .single();
        if (paymentError) throw paymentError;

        // Claim this approved text before talking to Stripe. Exactly one
        // concurrent request can move it from approved to checkout_created.
        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("paid_comments")
          .update({ payment_record_id: payment.id as string, status: "checkout_created" })
          .eq("id", params.id)
          .in("status", ["approved", "payment_failed"])
          .eq("approved_body_sha256", String(comment["body_sha256"]))
          .select("id")
          .maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) {
          const { error: cancelError } = await supabaseAdmin
            .from("payment_records")
            .update({ status: "canceled" })
            .eq("id", payment.id as string)
            .eq("status", "created");
          if (cancelError) throw cancelError;
          return Response.json(
            { error: "Checkout was already created for this approved comment." },
            { status: 409 },
          );
        }

        const siteUrl = requirePublicSiteUrl();
        const metadata = {
          accountabul_kind: "paid_comment",
          accountabul_reference_id: payment.id as string,
          paid_comment_id: params.id,
          payment_record_id: payment.id as string,
          event_id: eventId,
          body_sha256: String(comment["body_sha256"]),
        };
        let session;
        try {
          session = await client.checkout.sessions.create(
            {
              mode: "payment",
              integration_identifier: STRIPE_INTEGRATION_IDENTIFIER,
              customer_email: String(comment["guest_email"]),
              line_items: [{ price: priceId, quantity: 1 }],
              client_reference_id: payment.id as string,
              metadata,
              payment_intent_data: { metadata },
              success_url: `${siteUrl}/live/${event.slug}?paid_comment=success`,
              cancel_url: `${siteUrl}/live/${event.slug}?paid_comment=canceled`,
            },
            { idempotencyKey },
          );
          if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
        } catch (error) {
          const [commentReset, paymentCancel] = await Promise.all([
            supabaseAdmin
              .from("paid_comments")
              .update({ payment_record_id: null, status: "approved" })
              .eq("id", params.id)
              .eq("payment_record_id", payment.id as string)
              .eq("status", "checkout_created"),
            supabaseAdmin
              .from("payment_records")
              .update({ status: "canceled" })
              .eq("id", payment.id as string)
              .eq("status", "created"),
          ]);
          if (commentReset.error) throw commentReset.error;
          if (paymentCancel.error) throw paymentCancel.error;
          throw error;
        }

        const { error: paymentUpdateError } = await supabaseAdmin
          .from("payment_records")
          .update({ checkout_session_id: session.id, status: "processing" })
          .eq("id", payment.id as string);
        if (paymentUpdateError) throw paymentUpdateError;
        return Response.json({ checkoutUrl: session.url });
      },
    },
  },
});
