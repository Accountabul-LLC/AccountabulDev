// Pure normalizers: platform chat payloads -> the message shape accepted by
// /api/internal/ops/restream-ingest. No network, no secrets, no Node-only APIs.

export type NormalizedChatMessage = {
  eventId: string;
  source: "twitch" | "youtube" | "facebook" | "kick";
  externalId: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  body: string;
  sourceCreatedAt: string;
};

type Json = Record<string, unknown>;

const MAX_BODY = 500;

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function str(record: Json | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function cleanBody(value: string) {
  return value.normalize("NFKC").trim().slice(0, MAX_BODY);
}

function isoOrNow(value: string) {
  const time = Date.parse(value);
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}

/**
 * Twitch EventSub `channel.chat.message` notification (WebSocket frame, or webhook
 * body whose timestamp arrives in the Twitch-Eventsub-Message-Timestamp header).
 */
export function normalizeTwitchChatMessage(
  frame: unknown,
  eventId: string,
  headerTimestamp = "",
): NormalizedChatMessage | null {
  const root = asRecord(frame);
  const event = asRecord(
    root?.["payload"] ? asRecord(root["payload"])?.["event"] : root?.["event"],
  );
  const metadata = asRecord(root?.["metadata"]);
  const messageId = str(event, "message_id");
  const body = cleanBody(str(asRecord(event?.["message"]), "text"));
  if (!event || !messageId || !body) return null;
  return {
    eventId,
    source: "twitch",
    externalId: `twitch:${messageId}`,
    authorDisplayName:
      str(event, "chatter_user_name") || str(event, "chatter_user_login") || "Twitch viewer",
    authorAvatarUrl: null,
    body,
    sourceCreatedAt: isoOrNow(str(metadata, "message_timestamp") || headerTimestamp),
  };
}

/** YouTube `liveChatMessages` item (list or streamList). Only plain text messages are kept. */
export function normalizeYouTubeChatMessage(
  item: unknown,
  eventId: string,
): NormalizedChatMessage | null {
  const root = asRecord(item);
  const snippet = asRecord(root?.["snippet"]);
  const author = asRecord(root?.["authorDetails"]);
  const id = str(root, "id");
  if (!id || str(snippet, "type") !== "textMessageEvent") return null;
  const body = cleanBody(
    str(asRecord(snippet?.["textMessageDetails"]), "messageText") || str(snippet, "displayMessage"),
  );
  if (!body) return null;
  return {
    eventId,
    source: "youtube",
    externalId: `youtube:${id}`,
    authorDisplayName: str(author, "displayName") || "YouTube viewer",
    authorAvatarUrl: str(author, "profileImageUrl") || null,
    body,
    sourceCreatedAt: isoOrNow(str(snippet, "publishedAt")),
  };
}

/** Facebook Graph `live_comments` item. `from` may be absent for privacy reasons. */
export function normalizeFacebookLiveComment(
  comment: unknown,
  eventId: string,
): NormalizedChatMessage | null {
  const root = asRecord(comment);
  const id = str(root, "id");
  const body = cleanBody(str(root, "message"));
  if (!id || !body) return null;
  return {
    eventId,
    source: "facebook",
    externalId: `facebook:${id}`,
    authorDisplayName: str(asRecord(root?.["from"]), "name") || "Facebook viewer",
    authorAvatarUrl: null,
    body,
    sourceCreatedAt: isoOrNow(str(root, "created_time")),
  };
}

/** Kick webhook `chat.message.sent` body. */
export function normalizeKickChatMessage(
  payload: unknown,
  eventId: string,
): NormalizedChatMessage | null {
  const root = asRecord(payload);
  const sender = asRecord(root?.["sender"]);
  const id = str(root, "message_id");
  const body = cleanBody(str(root, "content"));
  if (!id || !body) return null;
  return {
    eventId,
    source: "kick",
    externalId: `kick:${id}`,
    authorDisplayName: str(sender, "username") || "Kick viewer",
    authorAvatarUrl: str(sender, "profile_picture") || null,
    body,
    sourceCreatedAt: isoOrNow(str(root, "created_at")),
  };
}

/** Sort key for the merged feed: platform timestamp, then external id as a stable tiebreak. */
export function compareChat(
  left: Pick<NormalizedChatMessage, "sourceCreatedAt" | "externalId">,
  right: Pick<NormalizedChatMessage, "sourceCreatedAt" | "externalId">,
) {
  return (
    Date.parse(left.sourceCreatedAt) - Date.parse(right.sourceCreatedAt) ||
    left.externalId.localeCompare(right.externalId)
  );
}
