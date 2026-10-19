import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Text } from "@/lib/conference/moderation";
import { exchangeYouTubeCode, storeYouTubeTokens } from "@/lib/youtube/oauth.server";

export const Route = createFileRoute("/api/public/oauth/youtube-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code || !state) {
          return new Response("YouTube authorization was declined.", { status: 400 });
        }
        const { data: redirectUri, error } = await supabaseAdmin.rpc(
          "private_consume_provider_oauth_state",
          {
            p_state_sha256: await sha256Text(state),
            p_provider: "youtube",
            p_now: new Date().toISOString(),
          },
        );
        if (error) throw error;
        if (!redirectUri) {
          return new Response("Invalid or expired YouTube OAuth state.", { status: 403 });
        }
        await storeYouTubeTokens(await exchangeYouTubeCode(code, redirectUri));
        return Response.json({ connected: true, provider: "youtube" });
      },
    },
  },
});
