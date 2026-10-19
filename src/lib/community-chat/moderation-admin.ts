/**
 * Request parsing for staff moderation actions on community chat.
 *
 * Pure and dependency-free so the rules are testable: which fields each action
 * needs, which actions require a written reason, and the bounds on durations.
 */

import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export const MODERATION_ACTIONS = [
  "hide_message",
  "unhide_message",
  "delete_message",
  "restore_message",
  "dismiss_flags",
  "mute_user",
  "remove_from_room",
  "ban_user",
  "lift_restriction",
] as const;

export type ModerationActionName = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_REASON_MAX_LENGTH = 500;
/** 30 days. Longer than this is a ban, which may be permanent. */
export const MAX_MUTE_MINUTES = 30 * 24 * 60;
/** One year cap for timed room removals and bans. */
export const MAX_TIMED_RESTRICTION_MINUTES = 365 * 24 * 60;
const MAX_OPERATOR_LENGTH = 200;

export function isModerationAction(value: string): value is ModerationActionName {
  return MODERATION_ACTIONS.some((action) => action === value);
}

/** Actions that take something away from a member must say why. */
export function moderationActionRequiresReason(action: ModerationActionName) {
  return (
    action === "hide_message" ||
    action === "delete_message" ||
    action === "mute_user" ||
    action === "remove_from_room" ||
    action === "ban_user"
  );
}

export function isMessageAction(action: ModerationActionName) {
  return (
    action === "hide_message" ||
    action === "unhide_message" ||
    action === "delete_message" ||
    action === "restore_message" ||
    action === "dismiss_flags"
  );
}

export function isRestrictionAction(action: ModerationActionName) {
  return action === "mute_user" || action === "remove_from_room" || action === "ban_user";
}

export type ParsedModerationAction = {
  action: ModerationActionName;
  messageId: string | null;
  userId: string | null;
  roomId: string | null;
  restrictionId: string | null;
  durationMinutes: number | null;
  reason: string | null;
  operator: string | null;
};

type Failure = { ok: false; error: string };

export function parseModerationAction(
  payload: unknown,
): { ok: true; value: ParsedModerationAction } | Failure {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failure("A JSON object moderation request is required.");
  }
  const record = payload as Record<string, unknown>;
  const action = text(record["action"]);
  if (!isModerationAction(action)) {
    return failure(`action must be one of: ${MODERATION_ACTIONS.join(", ")}`);
  }

  const ids: Record<"messageId" | "userId" | "roomId" | "restrictionId", string | null> = {
    messageId: null,
    userId: null,
    roomId: null,
    restrictionId: null,
  };
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const value = text(record[key]);
    if (!value) continue;
    if (!UUID.test(value)) return failure(`${key} must be a UUID.`);
    ids[key] = value.toLowerCase();
  }

  const reason = text(record["reason"]);
  if (reason.length > MODERATION_REASON_MAX_LENGTH) {
    return failure(`reason cannot exceed ${MODERATION_REASON_MAX_LENGTH} characters.`);
  }
  if (moderationActionRequiresReason(action) && !reason) {
    return failure("A reason is required for this action.");
  }

  const operator = text(record["operator"]).slice(0, MAX_OPERATOR_LENGTH) || null;

  let durationMinutes: number | null = null;
  const rawDuration = record["durationMinutes"];
  if (rawDuration !== undefined && rawDuration !== null) {
    if (typeof rawDuration !== "number" || !Number.isInteger(rawDuration) || rawDuration < 1) {
      return failure("durationMinutes must be a positive whole number.");
    }
    durationMinutes = rawDuration;
  }

  if (isMessageAction(action) && !ids.messageId) {
    return failure("messageId is required for this action.");
  }

  if (isRestrictionAction(action)) {
    // The target can be named directly or through the message that prompted it.
    if (!ids.userId && !ids.messageId) {
      return failure("userId or messageId is required to restrict a member.");
    }
    if (action === "mute_user") {
      if (durationMinutes === null) return failure("A mute needs a duration.");
      if (durationMinutes > MAX_MUTE_MINUTES) {
        return failure("A mute cannot exceed 30 days. Use a ban for longer.");
      }
    }
    if (action === "remove_from_room" && !ids.roomId && !ids.messageId) {
      return failure("roomId or messageId is required to remove a member from a room.");
    }
    if (action === "ban_user" && ids.roomId) {
      return failure("A ban covers all chat. Use remove_from_room for a single room.");
    }
    if (durationMinutes !== null && durationMinutes > MAX_TIMED_RESTRICTION_MINUTES) {
      return failure(
        "A timed restriction cannot exceed one year. Omit the duration for indefinite.",
      );
    }
  }

  if (action === "lift_restriction" && !ids.restrictionId) {
    return failure("restrictionId is required to lift a restriction.");
  }

  return {
    ok: true,
    value: { action, ...ids, durationMinutes, reason: reason || null, operator },
  };
}

/** The history entry each staff action writes. */
export function historyActionFor(
  action: ModerationActionName,
):
  | "message_hidden"
  | "message_unhidden"
  | "message_deleted"
  | "message_restored"
  | "flags_dismissed"
  | "user_muted"
  | "user_removed_from_room"
  | "user_banned"
  | "restriction_lifted" {
  switch (action) {
    case "hide_message":
      return "message_hidden";
    case "unhide_message":
      return "message_unhidden";
    case "delete_message":
      return "message_deleted";
    case "restore_message":
      return "message_restored";
    case "dismiss_flags":
      return "flags_dismissed";
    case "mute_user":
      return "user_muted";
    case "remove_from_room":
      return "user_removed_from_room";
    case "ban_user":
      return "user_banned";
    case "lift_restriction":
      return "restriction_lifted";
  }
}

/**
 * What happens to a message's open flags. Taking content down or restricting
 * its author resolves them as actioned; clearing or restoring the message
 * resolves them as dismissed; lifting a restriction leaves flags alone.
 */
export function flagResolutionFor(action: ModerationActionName): "actioned" | "dismissed" | null {
  switch (action) {
    case "hide_message":
    case "delete_message":
    case "mute_user":
    case "remove_from_room":
    case "ban_user":
      return "actioned";
    case "unhide_message":
    case "restore_message":
    case "dismiss_flags":
      return "dismissed";
    case "lift_restriction":
      return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function failure(error: string): Failure {
  return { ok: false, error };
}
