// Persistence for Property Intelligence intake claims and the pre-offer
// warning preference, ported from property-intelligence-app's
// app/lib/property-intake-repository.ts and
// property-intelligence-notice-repository.ts and refactored from Cloudflare D1
// onto Supabase (20260924200000).
//
// Both tables are service-role write only (20260924200000): `authenticated`
// holds select but no insert/update grant on either, so these functions are
// the single path that may write them, and the two controls they carry are
// enforced here rather than trusted from the client:
//
//   * Intake claims always pass normalizePropertyIntakeClaims first, so an
//     out-of-range or fractional count can never reach storage or a deal
//     calculation.
//   * The warning may only be dismissed once three separate reviews are
//     recorded. Asking to dismiss earlier is refused, and the count is capped
//     at the required number so repeated acknowledgments cannot overshoot.
//
// The database is a parameter with no module-scope default, matching
// property-dossier.server.ts, so importing this file never reads a
// credential. The caller (property-intake-notice.functions.ts,
// ACC-20260924-003) must supply the service-role client -- lazy-imported
// there the same way withPropertyDossierClient does for the dossier refresh
// -- to savePropertyIntakeClaims and acknowledgePropertyIntelligenceNotice,
// since the caller's own RLS-scoped client cannot perform either write. The
// read-only functions below may still be called with that RLS-scoped client,
// since `authenticated` does hold select on both tables.
import type { PropertyIntakeClaims } from "./analysis-types.ts";
import { normalizePropertyIntakeClaims } from "./property-intake.ts";
import {
  REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
  type PropertyIntelligenceNoticeAction,
  type PropertyIntelligenceNoticePreference,
} from "./property-intelligence-notice.ts";
import type { DossierDatabase } from "./property-dossier.server.ts";

const DEFAULT_CLAIMS: PropertyIntakeClaims = {
  propertyUse: "unknown",
  bedrooms: null,
  bathrooms: null,
  interiorSquareFeet: null,
  currentOccupancy: "unknown",
  condition: "unknown",
  notes: "",
  updatedAt: null,
};

export function defaultPropertyIntakeClaims(): PropertyIntakeClaims {
  return { ...DEFAULT_CLAIMS };
}

/**
 * Derives the preference from a stored count, clamped to the required range.
 * A stored value outside it (an older row, a manual edit) can never report
 * more reviews than the policy requires, nor a negative number.
 */
export function noticePreferenceFromCount(
  count: unknown,
  dismissedAt: unknown,
): PropertyIntelligenceNoticePreference {
  const acknowledgmentCount = Math.max(
    0,
    Math.min(REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS, Number(count) || 0),
  );
  return {
    acknowledgmentCount,
    requiredAcknowledgments: REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
    canDismiss: acknowledgmentCount >= REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
    dismissed: typeof dismissedAt === "string" && dismissedAt.length > 0,
  };
}

export async function getPropertyIntakeClaims(
  database: DossierDatabase,
  threadId: string,
  userId: string,
): Promise<PropertyIntakeClaims> {
  const { data } = await database
    .from("property_intake_claims")
    .select("claims, updated_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return defaultPropertyIntakeClaims();
  try {
    const stored = data["claims"];
    const updatedAt = data["updated_at"];
    return {
      ...DEFAULT_CLAIMS,
      // Re-normalized on read as well as write: a row stored by an older
      // version of the validator is bounded before it reaches a caller.
      ...normalizePropertyIntakeClaims(stored),
      updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    };
  } catch {
    // A stored payload that no longer validates degrades to the defaults
    // rather than propagating an unbounded figure.
    return defaultPropertyIntakeClaims();
  }
}

export async function savePropertyIntakeClaims(
  database: DossierDatabase,
  threadId: string,
  userId: string,
  input: unknown,
): Promise<PropertyIntakeClaims> {
  const claims = normalizePropertyIntakeClaims(input);
  const updatedAt = new Date().toISOString();

  await database.from("property_intake_claims").upsert(
    {
      thread_id: threadId,
      user_id: userId,
      claims,
      updated_at: updatedAt,
    },
    { onConflict: "thread_id" },
  );

  return { ...claims, updatedAt };
}

export async function getPropertyIntelligenceNoticePreference(
  database: DossierDatabase,
  userId: string,
): Promise<PropertyIntelligenceNoticePreference> {
  const { data } = await database
    .from("property_intelligence_notice_preferences")
    .select("acknowledgment_count, dismissed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return noticePreferenceFromCount(0, null);
  return noticePreferenceFromCount(data["acknowledgment_count"], data["dismissed_at"]);
}

export async function acknowledgePropertyIntelligenceNotice(
  database: DossierDatabase,
  userId: string,
  action: PropertyIntelligenceNoticeAction,
): Promise<PropertyIntelligenceNoticePreference> {
  if (action !== "acknowledge" && action !== "acknowledge-and-dismiss") {
    throw new Error("Choose a valid warning acknowledgment action.");
  }

  const current = await getPropertyIntelligenceNoticePreference(database, userId);
  const nextCount = Math.min(
    REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
    current.acknowledgmentCount + 1,
  );

  if (
    action === "acknowledge-and-dismiss" &&
    nextCount < REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS
  ) {
    throw new Error("Complete three warning reviews before turning off future reminders.");
  }

  const acknowledgedAt = new Date().toISOString();
  const dismissing =
    action === "acknowledge-and-dismiss" &&
    nextCount >= REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS;

  await database.from("property_intelligence_notice_preferences").upsert(
    {
      user_id: userId,
      acknowledgment_count: nextCount,
      last_acknowledged_at: acknowledgedAt,
      // Dismissal is sticky once earned: an already-dismissed row keeps its
      // original timestamp rather than being reset by a later acknowledgment.
      ...(dismissing && !current.dismissed ? { dismissed_at: acknowledgedAt } : {}),
      updated_at: acknowledgedAt,
    },
    { onConflict: "user_id" },
  );

  return getPropertyIntelligenceNoticePreference(database, userId);
}
