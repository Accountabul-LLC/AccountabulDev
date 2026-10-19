// Sandbox API key management, run under the caller's own authenticated
// Supabase client (RLS-governed, mirroring report-vault.server.ts). The
// approved-access-request gate and the 3-active-key quota are enforced at
// the database level (property_api_keys_quota trigger,
// 20260924160000_property_api_platform.sql) -- this module just shapes the
// request/response and surfaces the raw key exactly once.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { createPropertyApiKeyMaterial } from "@/lib/property-intelligence/property-api-contract";

type Supabase = SupabaseClient<Database>;

const KEY_COLUMNS = "id, label, key_prefix, status, scopes, last_used_at, created_at, revoked_at";

export type PropertyApiKeyMetadata = {
  id: string;
  label: string;
  keyPrefix: string;
  status: "active" | "revoked";
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

function toMetadata(row: {
  id: string;
  label: string;
  key_prefix: string;
  status: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}): PropertyApiKeyMetadata {
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    status: row.status as "active" | "revoked",
    scopes: row.scopes,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/** The signed-in user's own sandbox keys, newest active first. Never returns key_hash. */
export async function listSandboxApiKeys(supabase: Supabase): Promise<PropertyApiKeyMetadata[]> {
  const { data, error } = await supabase
    .from("property_api_keys")
    .select(KEY_COLUMNS)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toMetadata);
}

/**
 * Mints a new sandbox key for `userId`. Requires an approved
 * property_api_access_requests row and fewer than 3 active keys -- both
 * re-checked by the property_api_keys_quota database trigger, which is the
 * actual authority here; this is friendly error surfacing on top of it.
 * Returns the raw secret once; only its hash is ever stored.
 */
export async function createSandboxApiKey(
  supabase: Supabase,
  userId: string,
  label: string,
): Promise<{ key: PropertyApiKeyMetadata; rawKey: string }> {
  const { data: accessRequest, error: accessError } = await supabase
    .from("property_api_access_requests")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (accessError) throw accessError;
  if (accessRequest?.status !== "approved") {
    throw new Error("An approved API access request is required before creating a sandbox key.");
  }

  const { count, error: countError } = await supabase
    .from("property_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if (countError) throw countError;
  if ((count ?? 0) >= 3) {
    throw new Error("Revoke an existing key before creating more than 3 active keys.");
  }

  const material = await createPropertyApiKeyMaterial();
  const { data: inserted, error } = await supabase
    .from("property_api_keys")
    .insert({
      user_id: userId,
      label,
      key_prefix: material.keyPrefix,
      key_hash: material.keyHash,
    })
    .select(KEY_COLUMNS)
    .single();
  if (error) throw error;
  return { key: toMetadata(inserted), rawKey: material.rawKey };
}

/** Revokes one of the caller's own active keys. The immutable-fields trigger
 * guarantees this can never rewrite key_hash/key_prefix/label/scopes. */
export async function revokeSandboxApiKey(
  supabase: Supabase,
  userId: string,
  keyId: string,
): Promise<PropertyApiKeyMetadata[]> {
  const { data, error } = await supabase
    .from("property_api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select(KEY_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The active API key was not found.");
  return listSandboxApiKeys(supabase);
}
