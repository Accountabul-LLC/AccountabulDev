import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";
import type { PropertyIntelligenceNoticeAction } from "@/lib/property-intelligence/property-intelligence-notice";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

// Server-function surface for the property intake claims and the Property
// Intelligence notice, ported from the source app's
// app/api/property-intake/route.ts and
// app/api/property-intelligence-notice/route.ts.
//
// The underlying modules (property-intake-notice.server.ts) were ported and
// tested but had NO caller anywhere in src/, so nothing in the application
// could reach them -- the same unwired-half pattern found in the dispatch
// worker and the health monitor. This is the half that makes them reachable.
//
// Two things stay server-side on purpose:
//
//   * The thread is always checked against the signed-in user before any
//     claim is read or written. A claim row is keyed by (threadId, userId),
//     so accepting a caller-supplied threadId without confirming ownership
//     would let one account read or overwrite another's intake answers.
//   * The notice's three-acknowledgment dismissal gate is enforced by the
//     server module and by a table check constraint; this layer only passes
//     the action through, so a client cannot dismiss early by asking twice
//     in one request.

const WRITE_RATE_LIMIT = 30;
const WRITE_RATE_WINDOW_MS = 60_000;

function requireThreadId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("A workspace id is required.");
  }
  return value;
}

/**
 * Confirms the signed-in user owns this workspace before any intake row is
 * touched. Returns nothing useful; it throws when the thread is not theirs.
 */
async function assertOwnsThread(supabase: { from: (table: string) => never }, threadId: string) {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          is: (
            column: string,
            value: null,
          ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
        };
      };
    };
  };
  const { data, error } = await client
    .from("property_analysis_threads")
    .select("id")
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That workspace was not found.");
}

/** The signed-in user's saved intake answers for one workspace. */
export const getPropertyIntake = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => ({ threadId: requireThreadId(input?.threadId) }))
  .handler(async ({ data, context }) => {
    await assertOwnsThread(context.supabase as never, data.threadId);
    const { getPropertyIntakeClaims } =
      await import("@/lib/property-intelligence/property-intake-notice.server");
    return getPropertyIntakeClaims(context.supabase as never, data.threadId, context.userId);
  });

/** Saves intake answers for one workspace. Claims are normalized server-side. */
export const savePropertyIntake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string; claims: unknown }) => ({
    threadId: requireThreadId(input?.threadId),
    claims: input?.claims ?? null,
  }))
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-intake-save:${context.userId}`,
      WRITE_RATE_LIMIT,
      WRITE_RATE_WINDOW_MS,
    );
    await assertOwnsThread(context.supabase as never, data.threadId);
    const { savePropertyIntakeClaims } =
      await import("@/lib/property-intelligence/property-intake-notice.server");
    // property_intake_claims is service-role write only (20260924200000;
    // ACC-20260924-003) -- the caller's own client has no INSERT/UPDATE grant
    // on it, so the write goes through the service-role client instead.
    // Ownership of threadId was already confirmed against the caller above.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return savePropertyIntakeClaims(
      supabaseAdmin as never,
      data.threadId,
      context.userId,
      data.claims,
    );
  });

/** The signed-in user's Property Intelligence notice state. */
export const getPropertyIntelligenceNotice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getPropertyIntelligenceNoticePreference } =
      await import("@/lib/property-intelligence/property-intake-notice.server");
    return getPropertyIntelligenceNoticePreference(context.supabase as never, context.userId);
  });

/**
 * Records one acknowledgment of the notice, optionally requesting dismissal.
 * The server module refuses to dismiss before the third acknowledgment, and
 * the table repeats that as a check constraint.
 */
export const acknowledgePropertyIntelligenceNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { action: string }) => {
    // Narrowed to the union here, not cast at the call site: the server
    // module's parameter type is the union, and a bare string would let a
    // future edit pass an unchecked value straight through.
    if (input?.action === "acknowledge" || input?.action === "acknowledge-and-dismiss") {
      return { action: input.action as PropertyIntelligenceNoticeAction };
    }
    throw new Error("Choose a valid warning acknowledgment action.");
  })
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-notice-ack:${context.userId}`,
      WRITE_RATE_LIMIT,
      WRITE_RATE_WINDOW_MS,
    );
    const { acknowledgePropertyIntelligenceNotice: acknowledge } =
      await import("@/lib/property-intelligence/property-intake-notice.server");
    // property_intelligence_notice_preferences is service-role write only
    // (20260924200000; ACC-20260924-003) -- the caller's own client has no
    // INSERT/UPDATE grant on it at all, so the service-role client is what
    // actually performs the write the server module above decided on.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return acknowledge(supabaseAdmin as never, context.userId, data.action);
  });
