export type MembershipStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type EventAccessMode = "public" | "subscriber" | "subscriber_or_pass";

export type MembershipSnapshot = {
  status: MembershipStatus;
  currentPeriodEnd?: string | null;
  graceExpiresAt?: string | null;
};

/** What the highest active event_passes row for this user and event grants. */
export type EventPassAccessType = "watch" | "watch_and_chat" | null;

export type EventEntitlementInput = {
  accessMode: EventAccessMode;
  membership?: MembershipSnapshot | null;
  passAccessType: EventPassAccessType;
  now?: Date;
};

export type EventEntitlement = {
  canWatch: boolean;
  canComment: boolean;
  canTakeStage: boolean;
  canRequestSpeaker: boolean;
  source: "public" | "membership" | "pass" | "none";
  reason: string;
};

/** A watch_and_chat pass outranks a watch pass; a purchase never expires into nothing. */
export function highestPassAccessType(types: readonly EventPassAccessType[]): EventPassAccessType {
  if (types.includes("watch_and_chat")) return "watch_and_chat";
  if (types.includes("watch")) return "watch";
  return null;
}

function passGrantsRoomAccess(accessMode: EventAccessMode, passAccessType: EventPassAccessType) {
  return (
    passAccessType !== null && (accessMode === "public" || accessMode === "subscriber_or_pass")
  );
}

export function hasActiveMembership(
  membership: MembershipSnapshot | null | undefined,
  now = new Date(),
) {
  if (!membership) return false;
  if (membership.status === "active" || membership.status === "trialing") {
    if (!membership.currentPeriodEnd) return false;
    return new Date(membership.currentPeriodEnd) > now;
  }
  if (membership.status === "past_due" && membership.graceExpiresAt) {
    return new Date(membership.graceExpiresAt) > now;
  }
  return false;
}

export const EVENT_PASS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function eventPassExpiresAt(from = new Date()) {
  return new Date(from.getTime() + EVENT_PASS_TTL_MS).toISOString();
}

export function eventPassIsActive(expiresAt: string | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  return new Date(expiresAt) > now;
}

export function resolveEventEntitlement(input: EventEntitlementInput): EventEntitlement {
  const member = hasActiveMembership(input.membership, input.now);
  const passAccess = passGrantsRoomAccess(input.accessMode, input.passAccessType);

  if (member) {
    return {
      canWatch: true,
      canComment: true,
      canTakeStage: true,
      canRequestSpeaker: true,
      source: "membership",
      reason: "Active Accountabul membership.",
    };
  }

  if (passAccess && input.passAccessType === "watch_and_chat") {
    return {
      canWatch: true,
      canComment: true,
      canTakeStage: true,
      canRequestSpeaker: false,
      source: "pass",
      reason: "Your event pass includes watching, commenting, and stage invites.",
    };
  }

  if (passAccess && input.passAccessType === "watch") {
    return {
      canWatch: true,
      canComment: false,
      canTakeStage: false,
      canRequestSpeaker: false,
      source: "pass",
      reason: "Your pass covers watching. Chat needs a watch + chat pass, or pay per comment.",
    };
  }

  if (input.accessMode === "public") {
    return {
      canWatch: true,
      canComment: false,
      canTakeStage: false,
      canRequestSpeaker: false,
      source: "public",
      reason: "Commenting requires a membership, an event pass, or a paid comment.",
    };
  }

  return {
    canWatch: false,
    canComment: false,
    canTakeStage: false,
    canRequestSpeaker: false,
    source: "none",
    reason:
      input.accessMode === "subscriber"
        ? "An active Accountabul membership is required."
        : "An active membership or event pass is required.",
  };
}
