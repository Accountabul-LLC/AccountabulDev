// DB orchestration for the PDF Vault (Phase 4 of
// docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Builds the report's snapshot
// payload from real data already in this repo (no chat/voice transcripts --
// see report-pdf.server.ts's header), computes the content hash used for
// dedup, and either reuses the latest report for a workspace (identical
// content) or renders + uploads a new one. Runs with the caller's own
// RLS-scoped client for every read/write against property_reports /
// property_report_deliveries -- those tables' owner-scoped policies
// (20260924130000_property_report_vault.sql) are the real authority, this is
// just orchestration. The PDF upload itself uses the service-role admin
// client because generation is server-triggered only (never a client-side
// render, so content_hash/pdf_hash can never diverge from the stored
// bytes) -- see that migration's storage-policy comment.

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  contentHashOf,
  snapshotHashOf,
  type DeliveryAction,
  type ReportSnapshotPayload,
} from "./report-vault-validation.ts";

type Client = SupabaseClient<Database>;

const VAULT_BUCKET = "property-report-vault";
const SIGNED_URL_TTL = 60 * 5;

async function buildSnapshotPayload(
  supabase: Client,
  threadId: string,
  userId: string,
): Promise<ReportSnapshotPayload> {
  const { data: thread, error: threadError } = await supabase
    .from("property_analysis_threads")
    .select("id, title, status, property_intel_parcels(asr_parcel_id, property_intel_profiles(*))")
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (threadError) throw threadError;
  if (!thread) throw new Error("That property workspace was not found.");

  const parcel = thread.property_intel_parcels;
  const profile = parcel?.property_intel_profiles ?? null;
  const asrParcelId = parcel?.asr_parcel_id ?? "";

  const { data: docs, error: docsError } = await supabase
    .from("property_owner_documents")
    .select("id, category, title, amount, occurred_at, vendor_name, reference_number")
    .eq("thread_id", threadId)
    .eq("status", "verified")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (docsError) throw docsError;

  let deal: ReportSnapshotPayload["deal"] = null;
  if (asrParcelId) {
    const { data: scenarios, error: scenarioError } = await supabase
      .from("property_deal_scenarios")
      .select("id, label, inputs, results")
      .eq("user_id", userId)
      .eq("parcel_id", asrParcelId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (scenarioError) throw scenarioError;
    const scenario = scenarios?.[0];
    if (scenario) {
      deal = {
        scenarioId: scenario.id,
        label: scenario.label,
        inputs: scenario.inputs as Record<string, unknown>,
        results: scenario.results as Record<string, unknown>,
      };
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workspace: {
      threadId: thread.id,
      parcelId: asrParcelId,
      address: thread.title,
      status: thread.status,
    },
    property: {
      profile: profile as Record<string, unknown> | null,
      verifiedOwnerRecords: (docs ?? []).map((doc) => ({
        id: doc.id,
        category: doc.category,
        title: doc.title,
        amount: doc.amount,
        occurredAt: doc.occurred_at,
        vendorName: doc.vendor_name,
        referenceNumber: doc.reference_number,
      })),
    },
    deal,
  };
}

/**
 * Generates (or reuses) the latest report for a workspace. Content-hash
 * dedup: if the newly built payload hashes identically to the most recent
 * stored report for this thread, that existing row is returned untouched --
 * no new row, no new PDF, no duplicate storage object.
 */
export async function generateReportSnapshot(supabase: Client, userId: string, threadId: string) {
  const payload = await buildSnapshotPayload(supabase, threadId, userId);
  const contentHash = contentHashOf(payload);

  const { data: latest, error: latestError } = await supabase
    .from("property_reports")
    .select("id, version, content_hash, storage_path, pdf_hash, pdf_size, created_at")
    .eq("thread_id", threadId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  if (latest && latest.content_hash === contentHash) {
    return { report: latest, reused: true };
  }

  const { buildReportPdf } = await import("./report-pdf.server.ts");
  const pdfBytes = await buildReportPdf(payload);
  const { sha256Hex } = await import("./report-vault-validation.ts");
  const pdfHash = sha256Hex(pdfBytes);
  const version = (latest?.version ?? 0) + 1;
  const storagePath = `${userId}/${threadId}/${version}-${randomUUID()}.pdf`;
  const snapshotHash = snapshotHashOf(payload);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: uploadError } = await supabaseAdmin.storage
    .from(VAULT_BUCKET)
    .upload(storagePath, Buffer.from(pdfBytes), { contentType: "application/pdf", upsert: false });
  if (uploadError) throw uploadError;

  // ACC-20260924-002: the property_reports row must be written by the
  // service role, not the caller's own RLS-scoped client. `authenticated`
  // has no INSERT grant on this table at all (20260924180000) precisely so
  // that "a row exists here" always means a real PDF was generated by this
  // function -- threadId/userId were already re-verified as the caller's
  // own above (buildSnapshotPayload), so this remains scoped to the caller,
  // it just can no longer be forged via a direct REST call.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("property_reports")
    .insert({
      thread_id: threadId,
      user_id: userId,
      deal_scenario_id: payload.deal?.scenarioId ?? null,
      version,
      snapshot_hash: snapshotHash,
      content_hash: contentHash,
      snapshot_json: JSON.parse(JSON.stringify(payload)),
      storage_path: storagePath,
      pdf_hash: pdfHash,
      pdf_size: pdfBytes.byteLength,
    })
    .select("id, version, content_hash, storage_path, pdf_hash, pdf_size, created_at")
    .single();
  if (insertError) {
    await supabaseAdmin.storage.from(VAULT_BUCKET).remove([storagePath]);
    throw insertError;
  }

  return { report: inserted, reused: false };
}

/** The signed-in user's current report for each workspace, newest first. */
export async function listReportVault(supabase: Client) {
  const { data, error } = await supabase
    .from("property_reports")
    .select(
      "id, thread_id, pdf_size, pdf_hash, storage_path, created_at, property_analysis_threads(title, property_intel_parcels(asr_parcel_id))",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const seen = new Set<string>();
  return (data ?? []).filter((report) => !seen.has(report.thread_id) && seen.add(report.thread_id));
}

/** Short-lived signed URL for one of the caller's own reports. */
export async function resolveReportDownloadUrl(supabase: Client, reportId: string) {
  const { data: report, error } = await supabase
    .from("property_reports")
    .select("storage_path")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw new Error("That report was not found.");

  const { data: signed, error: signError } = await supabase.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(report.storage_path, SIGNED_URL_TTL);
  if (signError) throw signError;
  return signed?.signedUrl ?? null;
}

/** Appends one action to the append-only delivery history for a report. */
export async function recordReportDelivery(
  supabase: Client,
  userId: string,
  reportId: string,
  action: DeliveryAction,
) {
  const { error } = await supabase.from("property_report_deliveries").insert({
    report_id: reportId,
    user_id: userId,
    action,
  });
  if (error) throw error;
  return { recorded: true };
}
