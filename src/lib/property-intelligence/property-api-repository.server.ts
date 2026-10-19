// Service-role backing for the public property API route
// (src/routes/api/public/property-intelligence.v1.parcels.ts): bearer key
// authentication, sliding-window rate limiting, and usage logging. Always
// uses supabaseAdmin -- the caller of that route authenticates with a bearer
// API key, not a Supabase session, so there is no authenticated context to
// run these under RLS. Ported from property-intelligence-app's
// `property-api-repository.ts` (Cloudflare D1) onto Postgres.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PROPERTY_API_KEY_SCOPE,
  PROPERTY_API_MINUTE_LIMIT,
  constantTimeEqual,
  sha256Hex,
} from "@/lib/property-intelligence/property-api-contract";

export type AuthenticatedPropertyApiKey = {
  id: string;
  userId: string;
  scopes: string[];
};

/** Looks the presented key up by its prefix, then verifies the full raw key
 * against the stored hash in constant time. A revoked or scope-less key
 * never authenticates, even with a byte-for-byte correct raw key. */
export async function authenticatePropertyApiKey(
  rawKey: string,
  keyPrefix: string,
): Promise<AuthenticatedPropertyApiKey | null> {
  const { data: row, error } = await supabaseAdmin
    .from("property_api_keys")
    .select("id, user_id, key_hash, status, scopes")
    .eq("key_prefix", keyPrefix)
    .maybeSingle();
  if (error || !row || row.status !== "active") return null;

  const presentedHash = await sha256Hex(rawKey);
  if (!constantTimeEqual(presentedHash, row.key_hash)) return null;

  const scopes = row.scopes ?? [];
  if (!scopes.includes(PROPERTY_API_KEY_SCOPE)) return null;

  return { id: row.id, userId: row.user_id, scopes };
}

export type RateLimitReservation = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

/** Atomically reserves one request against the current 60-second window. */
export async function reservePropertyApiRequest(
  keyId: string,
  now = Date.now(),
): Promise<RateLimitReservation> {
  const windowStartedAt = Math.floor(now / 60_000) * 60;
  const { data, error } = await supabaseAdmin.rpc("property_api_reserve_rate_limit", {
    p_key_id: keyId,
    p_window_started_at: windowStartedAt,
    p_limit: PROPERTY_API_MINUTE_LIMIT,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const allowed = Boolean(row?.allowed);
  const requestCount = Number(row?.request_count ?? PROPERTY_API_MINUTE_LIMIT);
  return {
    allowed,
    limit: PROPERTY_API_MINUTE_LIMIT,
    remaining: allowed ? Math.max(0, PROPERTY_API_MINUTE_LIMIT - requestCount) : 0,
    resetAt: windowStartedAt + 60,
  };
}

/** Records one usage event (success or failure) and bumps the key's
 * last_used_at. Swallowed by the caller on failure -- a usage-logging
 * failure must never take down the actual API response. */
export async function recordPropertyApiUsage(input: {
  keyId: string;
  requestId: string;
  route: string;
  statusCode: number;
  durationMs: number;
  rateLimited: boolean;
}) {
  await supabaseAdmin.from("property_api_usage_events").insert({
    key_id: input.keyId,
    request_id: input.requestId,
    route: input.route,
    status_code: input.statusCode,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    rate_limited: input.rateLimited,
  });
  await supabaseAdmin
    .from("property_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", input.keyId);
}
