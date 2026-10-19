import { createFileRoute } from "@tanstack/react-router";

import { sha256Text } from "@/lib/conference/moderation";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/internal/ops/restream-oauth-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const clientId = process.env["RESTREAM_CLIENT_ID"];
        const redirectUri = process.env["RESTREAM_REDIRECT_URI"];
        if (!clientId || !redirectUri) {
          return Response.json({ error: "Restream OAuth is not configured." }, { status: 503 });
        }
        const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
        const stateSha256 = await sha256Text(state);
        const { error } = await supabaseAdmin.rpc("private_create_provider_oauth_state", {
          p_state_sha256: stateSha256,
          p_provider: "restream",
          p_redirect_uri: redirectUri,
          p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        if (error) throw error;
        const url = new URL("https://api.restream.io/login");
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("state", state);
        return Response.json({ authorizationUrl: url.toString(), expiresInSeconds: 600 });
      },
    },
  },
});
