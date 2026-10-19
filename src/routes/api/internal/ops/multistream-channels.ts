import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

const PLATFORMS = new Set(["twitch", "kick", "youtube"]);

/**
 * Maps an event to the platform channels OBS is pushing to. Twitch and Kick use the
 * broadcaster user id from their webhooks; YouTube uses the connected channel id.
 */
export const Route = createFileRoute("/api/internal/ops/multistream-channels")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const eventId = new URL(request.url).searchParams.get("eventId") ?? "";
        if (!eventId) return Response.json({ error: "eventId is required." }, { status: 400 });
        const { data, error } = await supabaseAdmin
          .from("event_chat_channels")
          .select("platform, channel_id, enabled, last_polled_at")
          .eq("event_id", eventId);
        if (error) throw error;
        return Response.json({ items: data ?? [] });
      },
      PUT: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const eventId = typeof payload["eventId"] === "string" ? payload["eventId"] : "";
        const platform = typeof payload["platform"] === "string" ? payload["platform"] : "";
        const channelId =
          typeof payload["channelId"] === "string" ? payload["channelId"].trim() : "";
        if (!eventId || !PLATFORMS.has(platform) || !channelId || channelId.length > 128) {
          return Response.json(
            { error: "eventId, platform and channelId are required." },
            { status: 400 },
          );
        }
        const { data, error } = await supabaseAdmin
          .from("event_chat_channels")
          .upsert(
            {
              event_id: eventId,
              platform,
              channel_id: channelId,
              enabled: payload["enabled"] !== false,
              // A new mapping starts a fresh YouTube cursor.
              youtube_live_chat_id: null,
              youtube_page_token: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "event_id,platform" },
          )
          .select("platform, channel_id, enabled")
          .single();
        if (error) throw error;
        return Response.json(data);
      },
    },
  },
});
