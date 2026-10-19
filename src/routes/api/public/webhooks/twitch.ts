import { createFileRoute } from "@tanstack/react-router";

import { eventsForChannel, ingestExternalChat } from "@/lib/chat-adapters/ingest.server";
import { normalizeTwitchChatMessage } from "@/lib/chat-adapters/normalize";
import { verifyTwitchSignature } from "@/lib/chat-adapters/webhook-signatures";

/**
 * Twitch EventSub webhook for `channel.chat.message`. The signature is checked
 * before anything is parsed; unsigned or stale deliveries get 403.
 */
export const Route = createFileRoute("/api/public/webhooks/twitch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["TWITCH_EVENTSUB_SECRET"];
        if (!secret) return Response.json({ error: "Twitch is not configured." }, { status: 503 });
        const rawBody = await request.text();
        const messageId = request.headers.get("twitch-eventsub-message-id") ?? "";
        const timestamp = request.headers.get("twitch-eventsub-message-timestamp") ?? "";
        const verified = await verifyTwitchSignature({
          secret,
          messageId,
          timestamp,
          rawBody,
          signature: request.headers.get("twitch-eventsub-message-signature") ?? "",
        });
        if (!verified) return new Response("Invalid signature.", { status: 403 });

        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        const type = request.headers.get("twitch-eventsub-message-type");
        if (type === "webhook_callback_verification") {
          return new Response(String(payload["challenge"] ?? ""), {
            headers: { "content-type": "text/plain" },
          });
        }
        if (type !== "notification") return new Response(null, { status: 204 });

        const event = payload["event"] as Record<string, unknown> | undefined;
        const channelId =
          typeof event?.["broadcaster_user_id"] === "string" ? event["broadcaster_user_id"] : "";
        if (!channelId) return new Response(null, { status: 204 });
        for (const eventId of await eventsForChannel("twitch", channelId)) {
          const message = normalizeTwitchChatMessage(payload, eventId, timestamp);
          if (message) await ingestExternalChat(message, event);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
