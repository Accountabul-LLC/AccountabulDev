import { createFileRoute } from "@tanstack/react-router";

import { eventsForChannel, ingestExternalChat } from "@/lib/chat-adapters/ingest.server";
import { normalizeKickChatMessage } from "@/lib/chat-adapters/normalize";
import { verifyKickSignature } from "@/lib/chat-adapters/webhook-signatures";

/**
 * Kick webhook for `chat.message.sent`. Kick signs with its published RSA key,
 * which is pinned in KICK_WEBHOOK_PUBLIC_KEY rather than fetched per request.
 */
export const Route = createFileRoute("/api/public/webhooks/kick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKeyPem = process.env["KICK_WEBHOOK_PUBLIC_KEY"];
        if (!publicKeyPem)
          return Response.json({ error: "Kick is not configured." }, { status: 503 });
        const rawBody = await request.text();
        const verified = await verifyKickSignature({
          publicKeyPem,
          messageId: request.headers.get("kick-event-message-id") ?? "",
          timestamp: request.headers.get("kick-event-message-timestamp") ?? "",
          rawBody,
          signature: request.headers.get("kick-event-signature") ?? "",
        });
        if (!verified) return new Response("Invalid signature.", { status: 403 });
        if (request.headers.get("kick-event-type") !== "chat.message.sent") {
          return new Response(null, { status: 204 });
        }

        const payload = JSON.parse(rawBody) as Record<string, unknown>;
        const broadcaster = payload["broadcaster"] as Record<string, unknown> | undefined;
        const channelId = broadcaster?.["user_id"] == null ? "" : String(broadcaster["user_id"]);
        if (!channelId) return new Response(null, { status: 204 });
        for (const eventId of await eventsForChannel("kick", channelId)) {
          const message = normalizeKickChatMessage(payload, eventId);
          if (message) await ingestExternalChat(message, payload);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
