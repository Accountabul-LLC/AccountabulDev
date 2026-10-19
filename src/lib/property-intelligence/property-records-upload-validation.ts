// Pure request-boundary validation for the owner-document upload server
// functions (Phase 3 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). No
// framework or `@/` imports, so it can be unit tested under plain node,
// mirroring workspace-validation.ts's style.

import { SHA256_HEX, UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export { SHA256_HEX, UUID };

export const OWNER_DOCUMENT_CATEGORIES = [
  "tax_receipt",
  "repair_invoice",
  "insurance",
  "deed_or_title",
  "utility_bill",
  "inspection_report",
  "other",
] as const;
export type OwnerDocumentCategory = (typeof OWNER_DOCUMENT_CATEGORIES)[number];

export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type CreateOwnerDocumentInput = {
  threadId: string;
  category: OwnerDocumentCategory;
  title: string;
  description: string | null;
  occurredAt: string | null;
  amount: number | null;
  vendorName: string | null;
  referenceNumber: string | null;
  storagePath: string;
  originalFilename: string;
  contentType: (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number];
  byteSize: number;
  fileHash: string;
};

function nonEmptyString(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    ? value.trim()
    : null;
}

function optionalString(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && value.length <= max ? value : null;
}

/**
 * Validates the metadata + storage-object fields a client submits when
 * recording an owner document. Structurally drops every field the source
 * app's review pipeline owns (status, review_note, reviewed_by, reviewed_at)
 * — those can never arrive through this boundary, matching the DB's insert
 * policy (property_owner_documents_owner_insert), which is the real backstop.
 */
export function validateCreateOwnerDocumentInput(input: unknown): CreateOwnerDocumentInput {
  const data = (input ?? {}) as Record<string, unknown>;

  const threadId = typeof data["threadId"] === "string" ? data["threadId"] : "";
  if (!UUID.test(threadId)) throw new Error("A property workspace is required.");

  const category = data["category"];
  if (
    typeof category !== "string" ||
    !(OWNER_DOCUMENT_CATEGORIES as readonly string[]).includes(category)
  ) {
    throw new Error("Choose a valid document category.");
  }

  const title = nonEmptyString(data["title"], 200);
  if (!title) throw new Error("Give this record a title.");

  const storagePath = nonEmptyString(data["storagePath"], 512);
  if (!storagePath) throw new Error("The uploaded file is missing.");

  const originalFilename = nonEmptyString(data["originalFilename"], 255);
  if (!originalFilename) throw new Error("The uploaded file has no name.");

  const contentType = data["contentType"];
  if (
    typeof contentType !== "string" ||
    !(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType)
  ) {
    throw new Error("Upload a PDF, JPEG, PNG, or WebP file.");
  }

  const byteSize = data["byteSize"];
  if (
    typeof byteSize !== "number" ||
    !Number.isInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > MAX_DOCUMENT_BYTES
  ) {
    throw new Error("That file is too large (10 MB max).");
  }

  const fileHash = data["fileHash"];
  if (typeof fileHash !== "string" || !SHA256_HEX.test(fileHash)) {
    throw new Error("The file's integrity hash could not be verified.");
  }

  const amountRaw = data["amount"];
  const amount =
    amountRaw === null || amountRaw === undefined || amountRaw === ""
      ? null
      : typeof amountRaw === "number" && Number.isFinite(amountRaw) && amountRaw >= 0
        ? amountRaw
        : null;
  if (amountRaw !== null && amountRaw !== undefined && amountRaw !== "" && amount === null) {
    throw new Error("Enter a valid, non-negative amount.");
  }

  const occurredAtRaw = data["occurredAt"];
  const occurredAt =
    occurredAtRaw === null || occurredAtRaw === undefined || occurredAtRaw === ""
      ? null
      : typeof occurredAtRaw === "string" && !Number.isNaN(Date.parse(occurredAtRaw))
        ? occurredAtRaw.slice(0, 10)
        : null;

  return {
    threadId,
    category: category as OwnerDocumentCategory,
    title,
    description: optionalString(data["description"], 2000),
    occurredAt,
    amount,
    vendorName: optionalString(data["vendorName"], 200),
    referenceNumber: optionalString(data["referenceNumber"], 120),
    storagePath,
    originalFilename,
    contentType: contentType as (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number],
    byteSize,
    fileHash,
  };
}

export type ReviewOwnerDocumentInput = {
  submissionId: string;
  decision: "verified" | "rejected";
  note: string | null;
};

/** Validates an admin/moderator's review decision. Authority is checked separately. */
export function validateReviewOwnerDocumentInput(input: unknown): ReviewOwnerDocumentInput {
  const data = (input ?? {}) as Record<string, unknown>;
  const submissionId = typeof data["submissionId"] === "string" ? data["submissionId"] : "";
  if (!UUID.test(submissionId)) throw new Error("A property record is required.");

  const decision = data["decision"];
  if (decision !== "verified" && decision !== "rejected") {
    throw new Error("Choose verified or rejected.");
  }

  return { submissionId, decision, note: optionalString(data["note"], 2000) };
}

export type OwnerDocumentStatus = "submitted" | "verified" | "rejected";

/**
 * Non-negotiable from the source app and the port plan: only a `verified`
 * owner document may ever be surfaced as a "fact" anywhere in the property
 * timeline/UI. `submitted` and `rejected` documents must never render as if
 * they were verified data. Centralized here so every surface (timeline,
 * export, any future consumer) filters the same way instead of re-deriving
 * this rule ad hoc.
 */
export function isEligibleForTimeline<T extends { status: OwnerDocumentStatus }>(
  document: T,
): boolean {
  return document.status === "verified";
}

export function filterTimelineEligible<T extends { status: OwnerDocumentStatus }>(
  documents: readonly T[],
): T[] {
  return documents.filter(isEligibleForTimeline);
}
