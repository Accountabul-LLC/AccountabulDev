import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Text } from "@/lib/conference/moderation";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { YOUTUBE_SCOPE } from "@/lib/youtube/oauth.server";

export const Route = createFileRoute("/api/internal/ops/youtube-oauth-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const clientId = process.env["YOUTUBE_CLIENT_ID"];
        const redirectUri = process.env["YOUTUBE_REDIRECT_URI"];
        if (!clientId || !redirectUri) {
          return Response.json({ error: "YouTube OAuth is not configured." }, { status: 503 });
        }
        const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
        const { error } = await supabaseAdmin.rpc("private_create_provider_oauth_state", {
          p_state_sha256: await sha256Text(state),
          p_provider: "youtube",
          p_redirect_uri: redirectUri,
          p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        if (error) throw error;
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", YOUTUBE_SCOPE);
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
        url.searchParams.set("state", state);
        return Response.json({ authorizationUrl: url.toString(), expiresInSeconds: 600 });
      },
    },
  },
});
