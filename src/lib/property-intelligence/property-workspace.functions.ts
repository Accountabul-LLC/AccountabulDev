import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ParcelSearchResult } from "@/lib/property-intelligence/analysis-types";
import { validateOpenWorkspaceInput } from "@/lib/property-intelligence/workspace-validation";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export { validateOpenWorkspaceInput } from "@/lib/property-intelligence/workspace-validation";

// The city ArcGIS lookup is the expensive external call; generous enough for
// real use (typos, re-searching) but bounded per account.
const ASSESSOR_LOOKUP_RATE_LIMIT = 20;
const ASSESSOR_LOOKUP_RATE_WINDOW_MS = 60_000;

function normalizedQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Address or 11-digit parcel ID -> ranked official Assessor matches. Read-only. */
export const searchParcels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { query: string }) => ({ query: normalizedQuery(input?.query) }))
  .handler(async ({ data, context }) => {
    if (!data.query) {
      return { results: [] as ParcelSearchResult[], error: null as string | null };
    }
    await throwIfRateLimited(
      `property-parcel-search:${context.userId}`,
      ASSESSOR_LOOKUP_RATE_LIMIT,
      ASSESSOR_LOOKUP_RATE_WINDOW_MS,
    );
    const { searchAssessorParcels } = await import("@/lib/property-intelligence/workspace.server");
    try {
      return { results: await searchAssessorParcels(data.query), error: null as string | null };
    } catch (error) {
      return {
        results: [] as ParcelSearchResult[],
        error: error instanceof Error ? error.message : "Parcel search failed.",
      };
    }
  });

/**
 * Opens (or reopens) the signed-in user's permanent workspace for a parcel.
 *
 * ACC-20260923-006: the client only ever names *which* parcel id to open.
 * The Assessor dossier written to the shared, all-users-readable
 * property_intel_parcels/property_intel_profiles tables is always re-fetched
 * here from the live Assessor service — never taken from client-supplied
 * fields — so a forged submission cannot poison canonical, cross-account data.
 */
export const openPropertyWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateOpenWorkspaceInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-workspace-open:${context.userId}`,
      ASSESSOR_LOOKUP_RATE_LIMIT,
      ASSESSOR_LOOKUP_RATE_WINDOW_MS,
    );
    const { searchAssessorParcels, resolveOrCreateWorkspace } =
      await import("@/lib/property-intelligence/workspace.server");
    const [verified] = await searchAssessorParcels(data.parcelId);
    if (!verified || verified.parcelId !== data.parcelId) {
      throw new Error("That parcel could not be confirmed against the official Assessor index.");
    }
    return resolveOrCreateWorkspace(context.userId, verified);
  });

/** The signed-in user's open workspaces, most recently opened first. */
export const listPropertyWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("property_analysis_threads")
      .select(
        "id, title, status, last_opened_at, updated_at, property_intel_parcels(asr_parcel_id, current_address)",
      )
      .is("deleted_at", null)
      .order("last_opened_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

/** One workspace's full dossier: the thread plus its Assessor profile. */
export const getPropertyWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => {
    if (typeof input?.threadId !== "string" || !UUID.test(input.threadId)) {
      throw new Error("A workspace id is required.");
    }
    return { threadId: input.threadId };
  })
  .handler(async ({ data, context }) => {
    const { data: thread, error } = await context.supabase
      .from("property_analysis_threads")
      .select(
        "id, title, status, parcel_id, property_intel_parcels(asr_parcel_id, current_address, last_intelligence_sync_at, property_intel_profiles(*))",
      )
      .eq("id", data.threadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!thread) throw new Error("That workspace was not found.");

    const { isStale, searchAssessorParcels, resolveOrCreateWorkspace } =
      await import("@/lib/property-intelligence/workspace.server");
    const parcel = thread.property_intel_parcels;
    const syncedAt = parcel?.last_intelligence_sync_at ?? null;
    if (!isStale(syncedAt) || !parcel?.asr_parcel_id) return thread;

    // Stale (or was never fully synced): refresh from the live Assessor
    // layer and re-read so the caller always sees fresh-enough facts.
    try {
      const [match] = await searchAssessorParcels(parcel.asr_parcel_id);
      if (match) await resolveOrCreateWorkspace(context.userId, match);
    } catch {
      // Refresh best-effort: serve the last-known dossier if the city service is down.
    }
    const { data: refreshed, error: refreshError } = await context.supabase
      .from("property_analysis_threads")
      .select(
        "id, title, status, parcel_id, property_intel_parcels(asr_parcel_id, current_address, last_intelligence_sync_at, property_intel_profiles(*))",
      )
      .eq("id", data.threadId)
      .maybeSingle();
    if (refreshError) throw refreshError;
    return refreshed ?? thread;
  });

/** Soft-deletes a workspace; canonical parcel and Assessor facts are untouched. */
export const closePropertyWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => {
    if (typeof input?.threadId !== "string" || !UUID.test(input.threadId)) {
      throw new Error("A workspace id is required.");
    }
    return { threadId: input.threadId };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("property_analysis_threads")
      .delete()
      .eq("id", data.threadId);
    if (error) throw error;
    return { deleted: true };
  });
