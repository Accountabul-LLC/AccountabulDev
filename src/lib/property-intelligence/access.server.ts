import type { MembershipSnapshot } from "@/lib/conference/entitlements";
import { resolvePropertyIntelligenceAccess } from "@/lib/property-intelligence/access";

/** Server-side entitlement lookup for one signed-in user. */
export async function loadPropertyIntelligenceAccessFor(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [
    { data: settings, error: settingsError },
    { data: subscription, error: subError },
    { data: grant, error: grantError },
    { data: isAdmin, error: adminError },
  ] = await Promise.all([
    supabaseAdmin
      .from("property_intelligence_settings")
      .select("access_mode")
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin
      .from("membership_subscriptions")
      .select("status, current_period_end, grace_expires_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("property_intelligence_access_grants")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  if (settingsError) throw settingsError;
  if (subError) throw subError;
  if (grantError) throw grantError;
  if (adminError) throw adminError;

  const membership: MembershipSnapshot | null = subscription
    ? {
        status: subscription.status as MembershipSnapshot["status"],
        currentPeriodEnd: subscription.current_period_end,
        graceExpiresAt: subscription.grace_expires_at,
      }
    : null;

  return resolvePropertyIntelligenceAccess({
    accessMode: (settings?.access_mode as "members" | "open") ?? "members",
    isAdmin: isAdmin === true,
    membership,
    hasIndividualGrant: Boolean(grant),
  });
}
