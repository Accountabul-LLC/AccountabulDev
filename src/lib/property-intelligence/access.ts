import { hasActiveMembership, type MembershipSnapshot } from "../conference/entitlements.ts";

export type PropertyIntelligenceAccessMode = "members" | "open";

export type PropertyIntelligenceAccessInput = {
  accessMode: PropertyIntelligenceAccessMode;
  isAdmin: boolean;
  membership: MembershipSnapshot | null;
  hasIndividualGrant: boolean;
  now?: Date;
};

export type PropertyIntelligenceAccess = {
  allowed: boolean;
  reason: "admin" | "open_mode" | "active_membership" | "individual_grant" | "members_only";
};

/**
 * Property Intelligence defaults to active-membership-only (ACC-20260923-004).
 * An admin-flippable switch (`access_mode = 'open'`) opens it to any signed-in
 * account; an individual grant always allows access regardless of mode or
 * membership, independent of the other checks — mirrors
 * `resolveEventEntitlement`'s layering for Live events.
 */
export function resolvePropertyIntelligenceAccess(
  input: PropertyIntelligenceAccessInput,
): PropertyIntelligenceAccess {
  if (input.isAdmin) return { allowed: true, reason: "admin" };
  if (input.accessMode === "open") return { allowed: true, reason: "open_mode" };
  if (input.hasIndividualGrant) return { allowed: true, reason: "individual_grant" };
  if (hasActiveMembership(input.membership, input.now)) {
    return { allowed: true, reason: "active_membership" };
  }
  return { allowed: false, reason: "members_only" };
}
