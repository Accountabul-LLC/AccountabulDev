import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isApprovedPaidCommentPrice } from "@/lib/conference/moderation";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { getStripeRuntime } from "@/lib/stripe/client.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";
import { trimmedString as stringValue } from "@/lib/validation/strings";

const IDENTIFIER = /^[a-z][a-z0-9_-]{1,63}$/;

export const Route = createFileRoute("/api/internal/ops/catalog")({
  server: {
    handlers: {
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
        const kind = String(payload["kind"] || "") as "paid_comment" | "event_pass" | "membership";
        const amountMinor = Number(payload["amountMinor"]);
        const currency = stringValue(payload, "currency").toLowerCase() || "usd";
        const attemptId = stringValue(payload, "attemptId");
        if (
          !["paid_comment", "event_pass", "membership"].includes(kind) ||
          !Number.isSafeInteger(amountMinor) ||
          amountMinor < 1 ||
          !/^[a-z]{3}$/.test(currency) ||
          !UUID.test(attemptId)
        ) {
          return Response.json({ error: "Invalid catalog request." }, { status: 400 });
        }
        if (kind === "paid_comment" && !isApprovedPaidCommentPrice(amountMinor, currency)) {
          return Response.json(
            { error: "Paid guest comments must remain $1.00 USD." },
            { status: 400 },
          );
        }

        const eventId = stringValue(payload, "eventId");
        const tierKey = stringValue(payload, "tierKey");
        const interval = stringValue(payload, "interval");
        if (kind === "event_pass" && !UUID.test(eventId)) {
          return Response.json(
            { error: "Event pass catalog requests require an event ID." },
            { status: 400 },
          );
        }
        if (kind === "event_pass") {
          const { data: event, error } = await supabaseAdmin
            .from("events")
            .select("stripe_product_id, stripe_price_id, pass_price_minor, pass_currency")
            .eq("id", eventId)
            .maybeSingle();
          if (error) throw error;
          if (!event) return Response.json({ error: "Event was not found." }, { status: 404 });
          if (event.stripe_product_id && event.stripe_price_id) {
            if (event.pass_price_minor === null || !event.pass_currency) {
              return Response.json(
                { error: "The event catalog identifiers exist without complete price metadata." },
                { status: 409 },
              );
            }
            return Response.json({
              productId: event.stripe_product_id,
              priceId: event.stripe_price_id,
              amountMinor: event.pass_price_minor,
              currency: event.pass_currency,
              environmentVariable: null,
              alreadyExists: true,
            });
          }
        }
        if (
          kind === "membership" &&
          (!IDENTIFIER.test(tierKey) || !["month", "year"].includes(interval))
        ) {
          return Response.json(
            { error: "Membership catalog requests require a tier key and month/year interval." },
            { status: 400 },
          );
        }

        const name =
          kind === "paid_comment" ? "Accountabul Paid Guest Comment" : stringValue(payload, "name");
        if (!name) return Response.json({ error: "Product name is required." }, { status: 400 });
        const { accountId, client } = getStripeRuntime("operations");
        const metadata = {
          accountabul_kind: String(kind),
          ...(eventId ? { accountabul_event_id: eventId } : {}),
          ...(tierKey ? { accountabul_tier_key: tierKey } : {}),
        };
        const catalogKey = kind === "paid_comment" ? "paid_comment" : tierKey;
        let existingProductId: string | null = null;
        if (kind !== "event_pass") {
          const exactQuery = supabaseAdmin
            .from("stripe_catalog_items")
            .select("stripe_product_id, stripe_price_id, amount_minor, currency")
            .eq("stripe_account_id", accountId)
            .eq("kind", kind)
            .eq("catalog_key", catalogKey)
            .eq("active", true);
          const { data: exact, error: exactError } = await (
            kind === "membership"
              ? exactQuery.eq("billing_interval", interval as "month" | "year")
              : exactQuery.is("billing_interval", null)
          ).maybeSingle();
          if (exactError) throw exactError;
          if (exact) {
            return Response.json(
              {
                productId: exact.stripe_product_id,
                priceId: exact.stripe_price_id,
                amountMinor: exact.amount_minor,
                currency: exact.currency,
                environmentVariable: environmentVariableFor(kind, tierKey, interval),
                alreadyExists: true,
              },
              { status: 200 },
            );
          }
          const { data: sibling, error: siblingError } = await supabaseAdmin
            .from("stripe_catalog_items")
            .select("stripe_product_id")
            .eq("stripe_account_id", accountId)
            .eq("kind", kind)
            .eq("catalog_key", catalogKey)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (siblingError) throw siblingError;
          existingProductId = sibling?.stripe_product_id ?? null;
        }
        const product = existingProductId
          ? await client.products.retrieve(existingProductId)
          : await client.products.create(
              { name, metadata },
              {
                idempotencyKey: `catalog-product:${kind}:${eventId || tierKey || "fixed"}:${attemptId}`,
              },
            );
        const price = await client.prices.create(
          {
            product: product.id,
            unit_amount: amountMinor,
            currency,
            ...(kind === "membership"
              ? { recurring: { interval: interval as "month" | "year" } }
              : {}),
            metadata,
          },
          { idempotencyKey: `catalog-price:${kind}:${eventId || tierKey || "fixed"}:${attemptId}` },
        );

        if (kind === "event_pass") {
          const { error } = await supabaseAdmin
            .from("events")
            .update({
              stripe_product_id: product.id,
              stripe_price_id: price.id,
              pass_price_minor: amountMinor,
              pass_currency: currency.toUpperCase(),
            })
            .eq("id", eventId);
          if (error) throw error;
        } else {
          const { error } = await supabaseAdmin.from("stripe_catalog_items").insert({
            kind,
            catalog_key: catalogKey,
            billing_interval: kind === "membership" ? interval : null,
            stripe_account_id: accountId,
            stripe_product_id: product.id,
            stripe_price_id: price.id,
            amount_minor: amountMinor,
            currency,
          });
          if (error) throw error;
        }
        const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
          action: "ops.stripe.catalog_created",
          target_table: kind === "event_pass" ? "events" : "stripe_catalog",
          target_id: eventId || null,
          request_id: request.headers.get("x-request-id"),
          diff: { kind, product_id: product.id, price_id: price.id, amount_minor: amountMinor },
        });
        if (auditError) throw auditError;
        return Response.json(
          {
            productId: product.id,
            priceId: price.id,
            amountMinor,
            currency,
            environmentVariable: environmentVariableFor(kind, tierKey, interval),
            alreadyExists: false,
          },
          { status: 201 },
        );
      },
    },
  },
});

function environmentVariableFor(
  kind: "paid_comment" | "event_pass" | "membership",
  tierKey: string,
  interval: string,
) {
  if (kind === "paid_comment") return "STRIPE_PAID_COMMENT_PRICE_ID";
  if (kind === "event_pass") return null;
  return `STRIPE_MEMBERSHIP_PRICE_${tierKey.toUpperCase().replaceAll("-", "_")}_${interval === "month" ? "MONTHLY" : "ANNUAL"}`;
}
