import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  validateCreateApiKeyInput,
  validateRevokeApiKeyInput,
} from "@/lib/property-intelligence/property-api-keys-validation";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";

const CREATE_RATE_LIMIT = 5;
const CREATE_RATE_WINDOW_MS = 60_000;
const REVOKE_RATE_LIMIT = 20;
const REVOKE_RATE_WINDOW_MS = 60_000;

/** The signed-in user's own sandbox API keys. Never exposes key_hash. */
export const listSandboxApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listSandboxApiKeys: list } =
      await import("@/lib/property-intelligence/property-api-keys.server");
    return list(context.supabase);
  });

/**
 * Mints a new sandbox key. Requires an approved property_api_access_requests
 * row (Phase 5) -- enforced again at the database level by the
 * property_api_keys_quota trigger, so this can never succeed for a pending
 * or denied requester even if this check were somehow bypassed. Returns the
 * raw secret once; it is never stored or retrievable again.
 */
export const createSandboxApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateCreateApiKeyInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-api-key-create:${context.userId}`,
      CREATE_RATE_LIMIT,
      CREATE_RATE_WINDOW_MS,
    );
    const { createSandboxApiKey: create } =
      await import("@/lib/property-intelligence/property-api-keys.server");
    return create(context.supabase, context.userId, data.label);
  });

/** Revokes one of the caller's own active keys. Never another account's. */
export const revokeSandboxApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateRevokeApiKeyInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-api-key-revoke:${context.userId}`,
      REVOKE_RATE_LIMIT,
      REVOKE_RATE_WINDOW_MS,
    );
    const { revokeSandboxApiKey: revoke } =
      await import("@/lib/property-intelligence/property-api-keys.server");
    return revoke(context.supabase, context.userId, data.keyId);
  });
