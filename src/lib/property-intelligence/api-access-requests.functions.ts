import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  validateReviewApiAccessRequestInput,
  validateSubmitApiAccessRequestInput,
} from "@/lib/property-intelligence/api-access-requests-validation";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";

const SUBMIT_RATE_LIMIT = 5;
const SUBMIT_RATE_WINDOW_MS = 60_000;

/**
 * One request per account (property_api_access_requests.user_id is unique).
 * Submitting never itself grants credentials — the DB's insert policy
 * (property_api_access_requests_owner_insert) requires status = 'pending' and
 * there is no owner UPDATE policy at all, so this can never resubmit over an
 * existing row; a second submission is rejected with a friendly message
 * instead of a raw unique-constraint error.
 */
export const submitApiAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateSubmitApiAccessRequestInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-api-access-submit:${context.userId}`,
      SUBMIT_RATE_LIMIT,
      SUBMIT_RATE_WINDOW_MS,
    );

    const { error } = await context.supabase.from("property_api_access_requests").insert({
      user_id: context.userId,
      email: data.email,
      organization: data.organization,
      use_case: data.useCase,
      monthly_volume: data.monthlyVolume,
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("You already have an API access request on file.");
      }
      throw error;
    }
    return { submitted: true as const };
  });

/** The signed-in user's own request, if any. Never lets the client see anyone else's. */
export const getOwnApiAccessRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("property_api_access_requests")
      .select("id, email, organization, use_case, monthly_volume, status, created_at, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

/** Admin-only: approve or deny a pending request. */
export const reviewApiAccessRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateReviewApiAccessRequestInput)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin, error: roleError } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    if (!isAdmin) {
      throw new Error("Only Accountabul admins can review API access requests.");
    }

    const { data: updated, error } = await context.supabase
      .from("property_api_access_requests")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.requestId)
      .select("id, status")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("That request was not found.");
    return updated;
  });
