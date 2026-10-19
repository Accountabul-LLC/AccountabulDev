import { createFileRoute } from "@tanstack/react-router";

import { sha256Text } from "@/lib/conference/moderation";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exchangeRestreamCode, storeRestreamTokens } from "@/lib/restream/oauth.server";

export const Route = createFileRoute("/api/public/oauth/restream-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code || !state)
          return new Response("Restream authorization was declined.", { status: 400 });
        const stateSha256 = await sha256Text(state);
        const { data: redirectUri, error } = await supabaseAdmin.rpc(
          "private_consume_provider_oauth_state",
          {
            p_state_sha256: stateSha256,
            p_provider: "restream",
            p_now: new Date().toISOString(),
          },
        );
        if (error) throw error;
        if (!redirectUri)
          return new Response("Invalid or expired Restream OAuth state.", { status: 403 });
        const tokens = await exchangeRestreamCode(code, redirectUri);
        await storeRestreamTokens(tokens);
        const successUrl = process.env["RESTREAM_OAUTH_SUCCESS_URL"];
        if (successUrl && isAllowedOAuthRedirect(successUrl)) {
          return Response.redirect(successUrl, 303);
        }
        return Response.json({ connected: true, provider: "restream" });
      },
    },
  },
});

function isAllowedOAuthRedirect(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return false;
  const allowed = new Set<string>();
  const site = process.env["PUBLIC_SITE_URL"];
  if (site) {
    try {
      allowed.add(new URL(site).origin);
    } catch {
      /* ignore invalid site URL */
    }
  }
  for (const part of (process.env["RESTREAM_OAUTH_ALLOWED_ORIGINS"] ?? "").split(",")) {
    const candidate = part.trim();
    if (!candidate) continue;
    try {
      allowed.add(new URL(candidate).origin);
    } catch {
      /* ignore invalid allowlist entries */
    }
  }
  return allowed.has(parsed.origin);
}
