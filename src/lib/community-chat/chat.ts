/**
 * Shared, pure helpers for the member community chat.
 *
 * Nothing here performs I/O, so both the browser components and the server
 * function can apply exactly the same rules. Room membership itself is decided
 * by row level security in the database, never by this file.
 */

import type { Database } from "@/integrations/supabase/types";

export type CommunityAccessPolicy = Database["public"]["Enums"]["community_access_policy"];
export type CommunityBadge = Database["public"]["Enums"]["community_badge"];

/** Matches the community_messages_body_len database constraint. */
export const COMMUNITY_MESSAGE_MAX_LENGTH = 500;
/** A member may post this many messages per rolling window, per room. */
export const COMMUNITY_MESSAGE_RATE_LIMIT = 20;
export const COMMUNITY_MESSAGE_RATE_WINDOW_MS = 60_000;

export type CommunityRoomSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  access_policy: CommunityAccessPolicy;
  room_kind: string;
  sort_order: number;
};

export type CommunityMessage = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_display_name: string | null;
  author_handle: string | null;
  author_badge: CommunityBadge;
  author_avatar_url: string | null;
};

export function normalizeMessageBody(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MessageValidation = { ok: true; body: string } | { ok: false; error: string };

export function validateMessageBody(raw: string): MessageValidation {
  const body = normalizeMessageBody(raw);
  if (!body) return { ok: false, error: "Write a message first." };
  if (body.length > COMMUNITY_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Messages are limited to ${COMMUNITY_MESSAGE_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, body };
}

/**
 * The badge stored on a message. Highest standing wins, so an admin who is also
 * a verified vendor reads as an admin.
 */
export function resolveAuthorBadge(standing: {
  isAdmin: boolean;
  isModerator: boolean;
  isVerifiedVendor: boolean;
}): CommunityBadge {
  if (standing.isAdmin) return "admin";
  if (standing.isModerator) return "moderator";
  if (standing.isVerifiedVendor) return "vendor";
  return "member";
}

/** How an author is named in the stream. Never invents a name. */
export function authorLabel(message: CommunityMessage, viewerId: string | null) {
  if (viewerId && message.user_id === viewerId) return "You";
  const displayName = message.author_display_name?.trim();
  if (displayName) return displayName;
  const handle = message.author_handle?.trim();
  if (handle) return `@${handle}`;
  return `Member ${message.user_id.slice(0, 6)}`;
}

// A same-origin image file served by the app, such as /seed-avatars/dana.svg.
// "//" is excluded because a protocol-relative URL points at another host.
const SAME_ORIGIN_IMAGE = /^\/(?!\/)[\w\-./]+\.(?:svg|png|jpe?g|webp|gif)$/i;
const MAX_AVATAR_URL_LENGTH = 2048;

/** An avatar URL safe to render, or null to fall back to initials. */
export function avatarSource(message: CommunityMessage) {
  const url = message.author_avatar_url?.trim();
  if (!url || url.length > MAX_AVATAR_URL_LENGTH || url.includes("..")) return null;
  return /^https:\/\//i.test(url) || SAME_ORIGIN_IMAGE.test(url) ? url : null;
}

/**
 * The avatar to stamp on a new message: the photo the sign-in provider put on
 * the account (Google sets avatar_url and picture). Only https is kept.
 */
export function avatarFromAccountMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  for (const key of ["avatar_url", "picture"]) {
    const value = record[key];
    if (
      typeof value === "string" &&
      /^https:\/\//i.test(value.trim()) &&
      value.trim().length <= MAX_AVATAR_URL_LENGTH
    ) {
      return value.trim();
    }
  }
  return null;
}

/** Initials for the avatar disc, derived only from what the message carries. */
export function authorInitials(message: CommunityMessage) {
  const source = message.author_display_name?.trim() || message.author_handle?.trim() || "";
  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (letters || message.user_id.slice(0, 2)).toUpperCase();
}

export type MessageGroup = {
  /** Stable key for the day heading. */
  dayKey: string;
  label: string;
  messages: (CommunityMessage & { continuesAuthor: boolean })[];
};

const TWO_MINUTES_MS = 2 * 60 * 1000;

/**
 * Group a chronological stream into day sections, marking messages that
 * continue the previous author within a couple of minutes so the stream can
 * render them without repeating the author line.
 */
export function groupMessages(messages: CommunityMessage[], now = new Date()): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const created = new Date(message.created_at);
    const dayKey = Number.isNaN(created.getTime())
      ? "unknown"
      : `${created.getFullYear()}-${created.getMonth() + 1}-${created.getDate()}`;
    let group = groups.at(-1);
    if (!group || group.dayKey !== dayKey) {
      group = { dayKey, label: dayLabel(created, now), messages: [] };
      groups.push(group);
    }
    const previous = group.messages.at(-1);
    const continuesAuthor =
      previous !== undefined &&
      previous.user_id === message.user_id &&
      created.getTime() - new Date(previous.created_at).getTime() < TWO_MINUTES_MS;
    group.messages.push({ ...message, continuesAuthor });
  }
  return groups;
}

function dayLabel(date: Date, now: Date) {
  if (Number.isNaN(date.getTime())) return "Earlier";
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

/** One line telling a member who else is in the room they are reading. */
export function describeRoomAudience(policy: CommunityAccessPolicy) {
  switch (policy) {
    case "signed_in":
      return "Open to every signed-in Accountabul member.";
    case "verified_vendor":
      return "Open to verified vendors, moderators, and admins.";
    case "role_allowlist":
      return "Open to members holding the roles an admin granted.";
    case "user_allowlist":
      return "A private room. Only the people an admin added can open it.";
  }
}

export function sortRooms(rooms: CommunityRoomSummary[]) {
  return [...rooms].sort(
    (left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name),
  );
}

/**
 * The chat policy a member must accept before posting. Acceptance is recorded
 * per version, so publishing a new version asks everyone again.
 */
export type ChatPolicy = {
  id: string;
  version: string;
  title: string;
  summary: string[];
  body_markdown: string;
};

export function policyAcceptanceRequired(
  policy: Pick<ChatPolicy, "id"> | null,
  acceptedVersionIds: string[],
) {
  return policy !== null && !acceptedVersionIds.includes(policy.id);
}
