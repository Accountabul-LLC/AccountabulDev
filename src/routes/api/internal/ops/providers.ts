import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { isCircleUsdcTipsConfigured } from "@/lib/crypto/circle-wallets.server";
import { isStripePurposeConfigured } from "@/lib/stripe/client.server";

export const Route = createFileRoute("/api/internal/ops/providers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const { data: health, error } = await supabaseAdmin
          .from("provider_health")
          .select(
            "provider, status, last_connected_at, last_event_at, last_error_at, last_error_code, details, updated_at",
          );
        if (error) throw error;
        const byProvider = new Map((health ?? []).map((item) => [item.provider, item]));
        const providers = [
          provider(
            "stripe",
            Boolean(
              isStripePurposeConfigured("member") &&
              isStripePurposeConfigured("operations") &&
              isStripePurposeConfigured("webhook") &&
              process.env["STRIPE_WEBHOOK_SECRET"],
            ),
            byProvider,
          ),
          provider(
            "restream",
            Boolean(
              process.env["RESTREAM_CLIENT_ID"] &&
              process.env["RESTREAM_CLIENT_SECRET"] &&
              process.env["RESTREAM_REDIRECT_URI"] &&
              process.env["RESTREAM_TOKEN_ENCRYPTION_KEY"] &&
              process.env["RESTREAM_BRIDGE_API_KEY"],
            ),
            byProvider,
          ),
          provider("moderation", Boolean(process.env["OPENAI_API_KEY"]), byProvider),
          provider("crypto_checkout", isCircleUsdcTipsConfigured(), byProvider),
          provider("palisade_treasury", Boolean(process.env["PALISADE_API_KEY"]), byProvider),
        ];
        return Response.json({ items: providers });
      },
    },
  },
});

function provider(
  key: string,
  configured: boolean,
  health: Map<string, { status: string; updated_at: string; last_error_code: string | null }>,
) {
  const observed = health.get(key);
  return {
    key,
    credentialConfigured: configured,
    status: observed?.status ?? (configured ? "unknown" : "offline"),
    lastCheckedAt: observed?.updated_at ?? null,
    lastErrorCode: observed?.last_error_code ?? null,
  };
}
