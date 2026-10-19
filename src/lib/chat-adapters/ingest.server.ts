import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { NormalizedChatMessage } from "@/lib/chat-adapters/normalize";
import { moderateComment } from "@/lib/conference/moderation.server";
import { sha256Text } from "@/lib/conference/moderation";

type ChatSource = Database["public"]["Enums"]["chat_source"];
export type ChannelPlatform = "twitch" | "kick" | "youtube";

export type IngestResult =
  | { status: "closed" }
  | { status: "duplicate" }
  | { status: Database["public"]["Enums"]["moderation_status"]; id: string };

/**
 * Single write path for off-platform chat. Every message goes through the same
 * moderation as first-party chat, and only lands while the event is live with chat on.
 */
export async function ingestExternalChat(
  message: Omit<NormalizedChatMessage, "source"> & { source: ChatSource },
  raw: unknown,
  metadataKey: string = message.source,
): Promise<IngestResult> {
  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("status, chat_enabled")
    .eq("id", message.eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event || !event.chat_enabled || event.status !== "live") return { status: "closed" };

  const moderation = await moderateComment(message.body);
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      event_id: message.eventId,
      user_id: null,
      body: message.body,
      source: message.source,
      external_id: message.externalId,
      author_display_name: message.authorDisplayName || "External guest",
      author_avatar_url: message.authorAvatarUrl,
      author_badge: "external",
      moderation_status: moderation.status,
      content_sha256: await sha256Text(message.body),
      source_created_at: message.sourceCreatedAt || null,
      metadata: JSON.parse(JSON.stringify({ moderation, [metadataKey]: raw })),
      published_at: moderation.status === "approved" ? new Date().toISOString() : null,
    })
    .select("id, moderation_status")
    .single();
  if (error?.code === "23505") return { status: "duplicate" };
  if (error) throw error;
  return { status: data.moderation_status, id: data.id };
}

/** Live events that have mapped this platform channel. Usually one; a channel can feed several. */
export async function eventsForChannel(platform: ChannelPlatform, channelId: string) {
  const { data, error } = await supabaseAdmin
    .from("event_chat_channels")
    .select("event_id, events!inner(status)")
    .eq("platform", platform)
    .eq("channel_id", channelId)
    .eq("enabled", true)
    .eq("events.status", "live");
  if (error) throw error;
  return (data ?? []).map((row) => row.event_id);
}
