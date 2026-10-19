import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  validateGenerateReportInput,
  validateRecordDeliveryInput,
} from "@/lib/property-intelligence/report-vault-validation";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

// Rendering a PDF and uploading it is the expensive operation here; generous
// enough for real use (re-checking after edits) but bounded per account.
const GENERATE_RATE_LIMIT = 12;
const GENERATE_RATE_WINDOW_MS = 60_000;
const DOWNLOAD_RATE_LIMIT = 60;
const DOWNLOAD_RATE_WINDOW_MS = 60_000;
const DELIVERY_RATE_LIMIT = 60;
const DELIVERY_RATE_WINDOW_MS = 60_000;

/**
 * Generates (or reuses) the latest report for one of the caller's own
 * property workspaces. Content-hash dedup happens inside
 * report-vault.server.ts: identical inputs return the existing report
 * instead of creating a duplicate row/PDF.
 */
export const generateReportSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateGenerateReportInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-report-generate:${context.userId}`,
      GENERATE_RATE_LIMIT,
      GENERATE_RATE_WINDOW_MS,
    );
    const { generateReportSnapshot: generate } =
      await import("@/lib/property-intelligence/report-vault.server");
    return generate(context.supabase, context.userId, data.threadId);
  });

/** The signed-in user's own vault contents, newest first. */
export const listReportVault = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listReportVault: list } =
      await import("@/lib/property-intelligence/report-vault.server");
    return list(context.supabase);
  });

/** A short-lived signed URL for one of the caller's own reports. */
export const getReportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { reportId: string }) => {
    if (typeof input?.reportId !== "string" || !UUID.test(input.reportId)) {
      throw new Error("A report is required.");
    }
    return { reportId: input.reportId };
  })
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-report-download:${context.userId}`,
      DOWNLOAD_RATE_LIMIT,
      DOWNLOAD_RATE_WINDOW_MS,
    );
    const { resolveReportDownloadUrl } =
      await import("@/lib/property-intelligence/report-vault.server");
    const url = await resolveReportDownloadUrl(context.supabase, data.reportId);
    return { url };
  });

/** Appends one print/download/share/delete action to a report's history. */
export const recordReportDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateRecordDeliveryInput)
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-report-delivery:${context.userId}`,
      DELIVERY_RATE_LIMIT,
      DELIVERY_RATE_WINDOW_MS,
    );
    const { recordReportDelivery: record } =
      await import("@/lib/property-intelligence/report-vault.server");
    return record(context.supabase, context.userId, data.reportId, data.action);
  });
