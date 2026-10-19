import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  UUID,
  validateCreateOwnerDocumentInput,
  validateReviewOwnerDocumentInput,
} from "@/lib/property-intelligence/property-records-upload-validation";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";

const UPLOAD_RATE_LIMIT = 30;
const UPLOAD_RATE_WINDOW_MS = 60_000;
const REVIEW_RATE_LIMIT = 60;
const REVIEW_RATE_WINDOW_MS = 60_000;

/** Server-side role check for the review-only functions below. RLS is the
 * real backstop (property_owner_documents_review_update,
 * property_record_reviews_reviewer_insert); this just turns a non-privileged
 * caller's attempt into a clean error instead of a raw policy rejection. */
async function requireReviewerRole(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [admin, moderator] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "moderator" }),
  ]);
  if (admin.error) throw admin.error;
  if (moderator.error) throw moderator.error;
  if (!admin.data && !moderator.data) {
    throw new Error("Only Accountabul admins and moderators can review property records.");
  }
}

/**
 * Records a document the signed-in user already uploaded to the private
 * `property-owner-records` bucket (see property-owner-documents.tsx). The
 * workspace lookup below relies on property_analysis_threads' owner-only
 * RLS policy to confirm the thread is really this user's own: a threadId for
 * someone else's workspace resolves to nothing under RLS, not their data.
 */
export const createOwnerDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateCreateOwnerDocumentInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-owner-document-create:${context.userId}`,
      UPLOAD_RATE_LIMIT,
      UPLOAD_RATE_WINDOW_MS,
    );

    const { data: thread, error: threadError } = await context.supabase
      .from("property_analysis_threads")
      .select("id")
      .eq("id", data.threadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) throw new Error("That property workspace was not found.");

    const { createOwnerDocument: create } =
      await import("@/lib/property-intelligence/property-records-upload.server");
    return create(context.supabase, context.userId, data);
  });

/** The signed-in user's own documents for one workspace. */
export const listOwnerDocuments = createServerFn({ method: "GET" })
  .validator((input: { threadId: string }) => {
    if (typeof input?.threadId !== "string" || !UUID.test(input.threadId)) {
      throw new Error("A property workspace is required.");
    }
    return { threadId: input.threadId };
  })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { listOwnerDocuments: list } =
      await import("@/lib/property-intelligence/property-records-upload.server");
    return list(context.supabase, data.threadId);
  });

/**
 * Admin/moderator-only: verify or reject a submitted document. Never
 * reachable by the document's own owner — see requireReviewerRole above and
 * the DB policies in 20260924110000_property_owner_documents.sql.
 */
export const reviewOwnerDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateReviewOwnerDocumentInput)
  .handler(async ({ data, context }) => {
    await requireReviewerRole(context.userId);
    await throwIfRateLimited(
      `property-owner-document-review:${context.userId}`,
      REVIEW_RATE_LIMIT,
      REVIEW_RATE_WINDOW_MS,
    );
    const { reviewOwnerDocument: review } =
      await import("@/lib/property-intelligence/property-records-upload.server");
    return review(context.supabase, context.userId, data);
  });
