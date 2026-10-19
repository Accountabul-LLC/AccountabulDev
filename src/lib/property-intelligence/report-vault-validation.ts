// Pure request-boundary validation + content-hash logic for the PDF Vault
// (Phase 4 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). No framework or `@/`
// imports (only Node's built-in `node:crypto`), so this can be unit tested
// under plain node without node_modules, mirroring
// property-records-upload-validation.ts's style. Deliberately kept separate
// from report-pdf.server.ts, which imports `pdf-lib` and therefore cannot
// run in this environment -- see that file's header comment.

import { createHash } from "node:crypto";
import { SHA256_HEX, UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

export { SHA256_HEX, UUID };

export const DELIVERY_ACTIONS = ["print", "download", "share", "delete"] as const;
export type DeliveryAction = (typeof DELIVERY_ACTIONS)[number];

/**
 * The data a report PDF is built from: the parcel workspace's Assessor
 * profile, the caller's own verified owner records for that workspace
 * (Phase 3), and their most recent Deal Analyst scenario for the parcel, if
 * any. There is deliberately no `conversation`/`transcript` field -- this
 * repo has no AI-chat workspace (see
 * docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md), so a report never fabricates
 * one; it only ever covers real data that exists in this repo.
 */
export type ReportSnapshotPayload = {
  schemaVersion: 1;
  generatedAt: string;
  workspace: {
    threadId: string;
    parcelId: string;
    address: string;
    status: string;
  };
  property: {
    profile: Record<string, unknown> | null;
    verifiedOwnerRecords: Array<{
      id: string;
      category: string;
      title: string;
      amount: number | null;
      occurredAt: string | null;
      vendorName: string | null;
      referenceNumber: string | null;
    }>;
  };
  deal: {
    scenarioId: string;
    label: string;
    inputs: Record<string, unknown>;
    results: Record<string, unknown>;
  } | null;
};

// Bump whenever report-pdf.server.ts's layout changes. It is part of the
// content hash, so unchanged property data still gets a fresh PDF in the new
// layout instead of the vault handing back the old one.
export const REPORT_LAYOUT_VERSION = 2;

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Strips the fields that vary purely with *when* a report is captured or
 * with the workspace's own mutable status, not with the underlying
 * property/deal content -- so regenerating a report from an unchanged
 * scenario + workspace hashes identically and reuses the existing PDF
 * instead of duplicating it (the port plan's Phase 4 non-negotiable).
 * Mirrors the source app's records-repository.ts `comparableSnapshot`.
 */
export function comparableSnapshotJson(payload: ReportSnapshotPayload): string {
  const { generatedAt: _generatedAt, ...rest } = payload;
  return JSON.stringify({
    layoutVersion: REPORT_LAYOUT_VERSION,
    ...rest,
    workspace: { ...payload.workspace, status: "content" },
  });
}

export function contentHashOf(payload: ReportSnapshotPayload): string {
  return sha256Hex(comparableSnapshotJson(payload));
}

export function snapshotHashOf(payload: ReportSnapshotPayload): string {
  return sha256Hex(JSON.stringify(payload));
}

export type GenerateReportInput = { threadId: string };

export function validateGenerateReportInput(input: unknown): GenerateReportInput {
  const data = (input ?? {}) as Record<string, unknown>;
  const threadId = typeof data["threadId"] === "string" ? data["threadId"] : "";
  if (!UUID.test(threadId)) throw new Error("A property workspace is required.");
  return { threadId };
}

export type RecordDeliveryInput = { reportId: string; action: DeliveryAction };

export function validateRecordDeliveryInput(input: unknown): RecordDeliveryInput {
  const data = (input ?? {}) as Record<string, unknown>;
  const reportId = typeof data["reportId"] === "string" ? data["reportId"] : "";
  if (!UUID.test(reportId)) throw new Error("A report is required.");

  const action = data["action"];
  if (typeof action !== "string" || !(DELIVERY_ACTIONS as readonly string[]).includes(action)) {
    throw new Error("Choose a valid delivery action.");
  }

  return { reportId, action: action as DeliveryAction };
}
