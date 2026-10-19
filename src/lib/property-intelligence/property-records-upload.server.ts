import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type {
  CreateOwnerDocumentInput,
  ReviewOwnerDocumentInput,
} from "./property-records-upload-validation.ts";

type Client = SupabaseClient<Database>;

function toSnakeCreate(userId: string, input: CreateOwnerDocumentInput) {
  return {
    thread_id: input.threadId,
    user_id: userId,
    category: input.category,
    title: input.title,
    description: input.description,
    occurred_at: input.occurredAt,
    amount: input.amount,
    vendor_name: input.vendorName,
    reference_number: input.referenceNumber,
    storage_path: input.storagePath,
    original_filename: input.originalFilename,
    content_type: input.contentType,
    byte_size: input.byteSize,
    file_hash: input.fileHash,
  };
}

/**
 * Records a client-uploaded document (the file itself is already in the
 * private `property-owner-records` storage bucket, written directly by the
 * signed-in client under storage RLS — see property-owner-documents.tsx).
 * Runs with the caller's own RLS-scoped client so the DB's owner-insert
 * policy (property_owner_documents_owner_insert) is the actual authority,
 * not application logic: the row can only ever land as `status = 'submitted'`
 * with no review fields set, regardless of what this function does.
 */
export async function createOwnerDocument(
  supabase: Client,
  userId: string,
  input: CreateOwnerDocumentInput,
) {
  const { data, error } = await supabase
    .from("property_owner_documents")
    .insert(toSnakeCreate(userId, input))
    .select(
      "id, thread_id, category, title, description, occurred_at, amount, vendor_name, reference_number, original_filename, content_type, byte_size, status, created_at, updated_at",
    )
    .single();
  if (error) throw error;
  return data;
}

/** The signed-in user's own documents for one workspace, newest first. */
export async function listOwnerDocuments(supabase: Client, threadId: string) {
  const { data, error } = await supabase
    .from("property_owner_documents")
    .select(
      "id, thread_id, category, title, description, occurred_at, amount, vendor_name, reference_number, storage_path, original_filename, content_type, byte_size, status, review_note, reviewed_at, created_at, updated_at",
    )
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Writes an admin/moderator review decision. Runs with the caller's own
 * RLS-scoped client: property_owner_documents_review_update and
 * property_record_reviews_reviewer_insert both require has_role(admin) or
 * has_role(moderator), so an account without that role gets a policy
 * rejection here even if this function were ever called for one — the
 * caller (property-records-upload.functions.ts) additionally checks the
 * role up front so the failure is a clean error, not a raw RLS 403.
 */
export async function reviewOwnerDocument(
  supabase: Client,
  reviewerId: string,
  input: ReviewOwnerDocumentInput,
) {
  const status = input.decision === "verified" ? "verified" : "rejected";
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("property_owner_documents")
    .update({
      status,
      review_note: input.note,
      reviewed_by: reviewerId,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", input.submissionId)
    .select("id, status, review_note, reviewed_at")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new Error("That record was not found.");

  const { error: reviewError } = await supabase.from("property_record_reviews").insert({
    submission_id: input.submissionId,
    reviewer_id: reviewerId,
    decision: input.decision,
    note: input.note,
  });
  if (reviewError) throw reviewError;

  return updated;
}
