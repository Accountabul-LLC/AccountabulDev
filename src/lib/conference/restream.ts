export type RestreamChatPayload = {
  id: string;
  eventId: string;
  text: string;
  createdAt: string;
  author?: { name?: string; avatarUrl?: string };
  platform?: string;
};

export type NormalizedChatMessage = {
  eventId: string;
  source: "restream" | "youtube" | "facebook" | "linkedin" | "twitch" | "x";
  externalId: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  authorBadge: "external";
  body: string;
  sourceCreatedAt: string;
};

const SOURCES = new Set(["youtube", "facebook", "linkedin", "twitch", "x"]);

export function normalizeRestreamMessage(payload: RestreamChatPayload): NormalizedChatMessage {
  const body = payload.text.normalize("NFKC").trim();
  if (!payload.id || !payload.eventId || !body) throw new Error("Invalid Restream chat message.");

  const platform = payload.platform?.toLowerCase();
  const source = platform && SOURCES.has(platform) ? platform : "restream";

  return {
    eventId: payload.eventId,
    source: source as NormalizedChatMessage["source"],
    externalId: payload.id,
    authorDisplayName: payload.author?.name?.trim() || "External guest",
    authorAvatarUrl: payload.author?.avatarUrl?.trim() || null,
    authorBadge: "external",
    body,
    sourceCreatedAt: payload.createdAt,
  };
}

export function restreamDedupeKey(message: NormalizedChatMessage) {
  return `${message.eventId}:${message.source}:${message.externalId}`;
}
