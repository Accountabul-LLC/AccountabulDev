// Client-side upload helper for the private "property-owner-records" bucket
// (supabase/migrations/20260924110000_property_owner_documents.sql), mirroring
// the uploadImage/resolveMediaUrl pattern in src/lib/media.ts. The object key
// is "<userId>/<uuid>.<ext>" so the bucket's storage RLS
// (property_owner_records_owner_insert) can scope writes to the caller's own
// folder purely from the path, the same idiom business-media/property-media use.

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
} from "./property-records-upload-validation.ts";

export const OWNER_RECORDS_BUCKET = "property-owner-records";

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateOwnerDocumentFile(file: File) {
  if (!(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return "Upload a PDF, JPEG, PNG, or WebP file.";
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return "Files must be 10 MB or smaller.";
  }
  return null;
}

async function sha256Hex(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Uploads a file into `<userId>/<random>.<ext>` and returns everything
 * createOwnerDocument needs to record it. The SHA-256 is computed client-side
 * over the exact bytes being uploaded; the server validates its format but,
 * like the rest of this table's content, trusts the caller's own storage
 * write for its own folder rather than re-downloading the object to verify it
 * — a deliberate scope call, since this is the owner attesting to their own
 * document, not shared/canonical data (contrast with the Assessor re-fetch in
 * workspace.server.ts, which exists because that data is cross-account).
 */
export async function uploadOwnerDocumentFile(userId: string, file: File) {
  const problem = validateOwnerDocumentFile(file);
  if (problem) throw new Error(problem);

  const fileHash = await sha256Hex(file);
  const ext = EXT_BY_TYPE[file.type] ?? "bin";
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(OWNER_RECORDS_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return {
    storagePath,
    originalFilename: file.name.slice(0, 255),
    contentType: file.type as (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number],
    byteSize: file.size,
    fileHash,
  };
}

export async function removeOwnerDocumentFile(path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(OWNER_RECORDS_BUCKET).remove([path]);
}

const SIGNED_URL_TTL = 60 * 5;

/** Owner documents are private, reviewed evidence: short-lived signed URLs only. */
export async function resolveOwnerDocumentUrl(path: string | null | undefined) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(OWNER_RECORDS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export function useOwnerDocumentUrl(path: string | null | undefined) {
  const query = useQuery({
    queryKey: ["owner-document-url", path],
    enabled: Boolean(path),
    staleTime: (SIGNED_URL_TTL - 30) * 1000,
    queryFn: () => resolveOwnerDocumentUrl(path),
  });
  return query.data ?? null;
}
