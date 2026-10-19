import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parsePalisadeWebhook, verifyPalisadeWebhook } from "@/lib/crypto/palisade-webhook.server";

export const Route = createFileRoute("/api/public/webhooks/palisade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env["PALISADE_WEBHOOK_PUBLIC_KEY"];
        if (!publicKey) return new Response("Palisade webhook is not configured", { status: 503 });
        const signature = request.headers.get("signature") ?? "";
        const rawBody = await request.text();
        let parsed;
        try {
          parsed = parsePalisadeWebhook(rawBody);
        } catch {
          return new Response("Invalid webhook", { status: 400 });
        }
        if (!verifyPalisadeWebhook(publicKey, signature, parsed.envelope.payload)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const { error: ledgerError } = await supabaseAdmin.from("payment_events").insert({
          provider: "palisade",
          provider_event_id: parsed.providerEventId,
          event_type: parsed.envelope.domain,
          payload: {
            resource_id: typeof parsed.payload["id"] === "string" ? parsed.payload["id"] : null,
            status: typeof parsed.payload["status"] === "string" ? parsed.payload["status"] : null,
          },
          processed_at: new Date().toISOString(),
        });
        if (ledgerError?.code === "23505") return new Response("ok");
        if (ledgerError) throw ledgerError;

        const { error: healthError } = await supabaseAdmin.from("provider_health").upsert(
          {
            provider: "palisade_treasury",
            status: "healthy",
            last_event_at: new Date().toISOString(),
            last_error_at: null,
            last_error_code: null,
            details: { last_domain: parsed.envelope.domain },
          },
          { onConflict: "provider" },
        );
        if (healthError) throw healthError;
        return new Response("ok");
      },
    },
  },
});
