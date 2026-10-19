import {
  highestPassAccessType,
  resolveEventEntitlement,
  type EventEntitlement,
  type MembershipSnapshot,
} from "@/lib/conference/entitlements";

/**
 * Server-side entitlement lookup for a specific person and event.
 *
 * Stage invites are authorized here rather than in the browser: the host picks
 * a name, but whether that person may actually take the stage is decided by
 * this check against the database.
 */
export async function loadEventEntitlementFor(
  eventId: string,
  userId: string,
): Promise<EventEntitlement> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("id, access_mode, status")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  const nowIso = new Date().toISOString();

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("membership_subscriptions")
    .select("status, current_period_end, grace_expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  const membership: MembershipSnapshot | null = subscription
    ? {
        status: subscription.status as MembershipSnapshot["status"],
        currentPeriodEnd: subscription.current_period_end,
        graceExpiresAt: subscription.grace_expires_at,
      }
    : null;

  const { data: passes, error: passError } = await supabaseAdmin
    .from("event_passes")
    .select("access_type")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", nowIso);
  if (passError) throw passError;

  return resolveEventEntitlement({
    accessMode: event.access_mode,
    membership,
    passAccessType: highestPassAccessType((passes ?? []).map((pass) => pass.access_type)),
  });
}

/**
 * Whether the host removed this person from the event. Applies the same rule as
 * public.is_chat_banned (see isRemovedFromEvent), read directly so the rule is
 * unit tested in TypeScript rather than only in SQL.
 */
export async function isRemovedFromLiveRoom(eventId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isRemovedFromEvent } = await import("@/lib/conference/live-session");
  const { data, error } = await supabaseAdmin
    .from("chat_moderation_actions")
    .select("action, event_id, expires_at")
    .eq("target_user_id", userId)
    .eq("action", "ban");
  if (error) throw error;
  return isRemovedFromEvent(
    (data ?? []).map((row) => ({
      action: row.action,
      eventId: row.event_id,
      expiresAt: row.expires_at,
    })),
    eventId,
  );
}
