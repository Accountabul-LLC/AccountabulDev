import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ingestExternalChat } from "@/lib/chat-adapters/ingest.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { findActiveLiveChatId, pollOnce } from "@/lib/youtube/chat-poller";
import { getFreshYouTubeAccessToken } from "@/lib/youtube/oauth.server";

// Cron fires once a minute; polling inside the request keeps chat latency near
// YouTube's own interval without a long-lived worker.
const BUDGET_MS = 50_000;

export const Route = createFileRoute("/api/internal/ops/multistream-youtube-poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const { data: channels, error } = await supabaseAdmin
          .from("event_chat_channels")
          .select(
            "id, event_id, channel_id, youtube_live_chat_id, youtube_page_token, events!inner(status)",
          )
          .eq("platform", "youtube")
          .eq("enabled", true)
          .eq("events.status", "live");
        if (error) throw error;
        if (!channels?.length) return Response.json({ polled: 0, ingested: 0 });

        const { accessToken } = await getFreshYouTubeAccessToken();
        const deadline = Date.now() + BUDGET_MS;
        let ingested = 0;
        const state = channels.map((row) => ({
          id: row.id,
          eventId: row.event_id,
          channelId: row.channel_id,
          liveChatId: row.youtube_live_chat_id,
          pageToken: row.youtube_page_token,
          nextAt: 0,
        }));

        for (const channel of state) {
          channel.liveChatId ??= await findActiveLiveChatId(fetch, accessToken, channel.channelId);
        }
        const active = state.filter((channel) => channel.liveChatId);

        while (active.length && Date.now() < deadline) {
          const next = active.reduce((a, b) => (a.nextAt <= b.nextAt ? a : b));
          const wait = next.nextAt - Date.now();
          if (wait > 0) {
            if (Date.now() + wait >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
          const result = await pollOnce({
            fetchFn: fetch,
            accessToken,
            liveChatId: next.liveChatId!,
            eventId: next.eventId,
            pageToken: next.pageToken,
            ingest: async (message) => {
              await ingestExternalChat(message, message);
            },
          });
          ingested += result.ingested;
          next.pageToken = result.nextPageToken;
          next.nextAt = Date.now() + result.waitMs;
          const { error: saveError } = await supabaseAdmin
            .from("event_chat_channels")
            .update({
              youtube_live_chat_id: next.liveChatId,
              youtube_page_token: next.pageToken,
              last_polled_at: new Date().toISOString(),
            })
            .eq("id", next.id);
          if (saveError) throw saveError;
        }
        return Response.json({ polled: active.length, ingested });
      },
    },
  },
});
