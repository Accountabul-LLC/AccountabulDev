export type EventStatus = "scheduled" | "live" | "ended" | "canceled" | "replay_available";

/** The spec fixes the pre-live countdown at ten seconds. */
export const LIVE_COUNTDOWN_MS = 10_000;

/** RealtimeKit presets. The host publishes; the viewer joins view-only. */
export const DEFAULT_HOST_PRESET = "accountabul_host";
export const DEFAULT_VIEWER_PRESET = "accountabul_viewer";

export type LiveSessionSnapshot = {
  status: EventStatus;
  /** Countdown target while scheduled, and the real start once live. */
  actualStartAt: string | null;
  meetingId: string | null;
};

export type LivePhase = "idle" | "counting_down" | "live" | "over";

export function countdownTargetFrom(now = new Date()) {
  return new Date(now.getTime() + LIVE_COUNTDOWN_MS).toISOString();
}

export function countdownRemainingMs(target: string | null | undefined, now = new Date()) {
  if (!target) return 0;
  const remaining = new Date(target).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining;
}

export function countdownSecondsLeft(target: string | null | undefined, now = new Date()) {
  return Math.ceil(countdownRemainingMs(target, now) / 1000);
}

export function countdownIsComplete(target: string | null | undefined, now = new Date()) {
  if (!target) return false;
  return countdownRemainingMs(target, now) === 0;
}

/** Only a scheduled event can be armed, and only once a meeting exists to join. */
export function canBeginCountdown(status: EventStatus) {
  return status === "scheduled";
}

/**
 * Go live is the commit step. It requires an armed countdown that has actually
 * reached zero, so a tampered client cannot skip the ten seconds.
 */
export function canGoLive(snapshot: LiveSessionSnapshot, now = new Date()) {
  if (snapshot.status !== "scheduled") return false;
  if (!snapshot.meetingId) return false;
  return countdownIsComplete(snapshot.actualStartAt, now);
}

export function canEndStream(status: EventStatus) {
  return status === "live";
}

export function livePhase(snapshot: LiveSessionSnapshot, now = new Date()): LivePhase {
  if (snapshot.status === "live") return "live";
  if (snapshot.status === "ended" || snapshot.status === "canceled") return "over";
  if (snapshot.status === "replay_available") return "over";
  if (snapshot.status === "scheduled" && countdownRemainingMs(snapshot.actualStartAt, now) > 0) {
    return "counting_down";
  }
  return "idle";
}

/**
 * The audience only ever receives a media token for a room that is already
 * public. Green room and countdown stay host-only.
 */
export function viewerMayJoinMedia(snapshot: LiveSessionSnapshot, canWatch: boolean) {
  return canWatch && snapshot.status === "live" && Boolean(snapshot.meetingId);
}

/**
 * RealtimeKit participants are keyed by the Accountabul user UUID. Provider IDs
 * are never treated as an authorization claim.
 */
export function participantIdentity(userId: string) {
  return userId;
}

export type CommenterRef = {
  /** Null for paid-guest text and imported external chat. */
  userId: string | null;
  source: string;
  /** Whether that Accountabul user is currently present in the live room. */
  presentInRoom: boolean;
};

/**
 * Who the host may pull onto the stage from the comment list.
 *
 * Imported external comments and anonymous paid-guest text have no Accountabul
 * session to promote, and someone who already left has nothing to join.
 * Entitlement itself is re-checked on the server before access is granted.
 */
export function commenterIsInvitable(commenter: CommenterRef) {
  if (commenter.source !== "accountabul") return false;
  if (!commenter.userId) return false;
  return commenter.presentInRoom;
}

export type ModerationActionRef = {
  action: string;
  eventId: string | null;
  expiresAt: string | null;
};

/**
 * Mirrors public.is_chat_banned: a ban scoped to this event, or to every event,
 * that has not expired. Removal from the live room is recorded as exactly this
 * ban, so it also closes chat and cannot be undone by rejoining.
 */
export function isRemovedFromEvent(
  actions: readonly ModerationActionRef[],
  eventId: string,
  now = new Date(),
) {
  return actions.some(
    (entry) =>
      entry.action === "ban" &&
      (entry.eventId === null || entry.eventId === eventId) &&
      (entry.expiresAt === null || new Date(entry.expiresAt) > now),
  );
}

/**
 * Status changes the Operations Console may make. The console schedules,
 * cancels, ends, and publishes replays; it never makes a room public. Going
 * live only happens through the host studio, after the green room and the
 * countdown, so an event can only be `live` here if it already was.
 */
export function opsStatusChangeAllowed(current: EventStatus | null, next: EventStatus) {
  if (current === next) return true;
  if (next === "live") return false;
  // A running broadcast can be ended or canceled, never pushed back to scheduled.
  if (current === "live") return next === "ended" || next === "canceled";
  // ended and canceled are terminal. The one narrow exception is publishing a
  // replay after the event ended, which the console already treats as the
  // normal next step. Without this, reverting to scheduled would silently
  // re-enable tipping (TIPPABLE_STATUSES includes scheduled) and the
  // "starting soon" alert dispatch on a room that already closed.
  if (current === "ended") return next === "replay_available";
  if (current === "canceled") return false;
  // replay_available is exactly as terminal as ended for this purpose -- it
  // is what ended becomes once a replay is published, not a lesser state.
  // Leaving it covered by the fallthrough reopened the same gap one hop
  // later: ended -> replay_available -> scheduled reproduced the identical
  // impact this function exists to block.
  if (current === "replay_available") return false;
  return true;
}
