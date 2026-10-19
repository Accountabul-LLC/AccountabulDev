import { createFileRoute } from "@tanstack/react-router";

import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { isStripePurposeConfigured } from "@/lib/stripe/client.server";

export const Route = createFileRoute("/api/internal/ops/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        return Response.json({
          status: "ok",
          service: "accountabul-operations-api",
          providers: {
            stripe: Boolean(
              isStripePurposeConfigured("member") &&
              isStripePurposeConfigured("operations") &&
              isStripePurposeConfigured("webhook") &&
              process.env["STRIPE_WEBHOOK_SECRET"],
            ),
            moderation: Boolean(process.env["OPENAI_API_KEY"]),
            restream: Boolean(
              process.env["RESTREAM_CLIENT_ID"] &&
              process.env["RESTREAM_CLIENT_SECRET"] &&
              process.env["RESTREAM_REDIRECT_URI"] &&
              process.env["RESTREAM_TOKEN_ENCRYPTION_KEY"] &&
              process.env["RESTREAM_BRIDGE_API_KEY"],
            ),
            palisade: Boolean(process.env["PALISADE_API_KEY"]),
          },
          checkedAt: new Date().toISOString(),
        });
      },
    },
  },
});
