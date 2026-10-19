// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-ms-sos-arcgis.ts: the
// discovery + batch-fetch shell for the Mississippi Secretary of State's
// active tax-forfeited-property ArcGIS inventory, plus its feature
// normalization (nationwide-ms-sos-normalize.ts).
//
// Unlike the LRA and DeSoto land-roll layers (public, unauthenticated
// ArcGIS FeatureServers reached with a plain injected `fetch`), the source
// models the SOS retrieval behind an `MississippiSosAuthorizedTransport`
// interface -- `beginConsistentSnapshot` / `readSnapshotBatch` -- because
// the real integration requires authorization this repo does not hold. That
// interface has NO default implementation anywhere in this module (or this
// repo): a caller must construct and inject a real transport for any
// network access to happen at all, the same "injected, no default" pattern
// Slice 2 used for the health delivery sink.
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import { stableSerialize, stableSha256 } from "./nationwide-fingerprint.ts";
import {
  normalizeMississippiSosInventory,
  type MississippiSosFeature,
} from "./nationwide-ms-sos-normalize.ts";
import type {
  JurisdictionReference,
  SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";

export type ArcGisFeature = {
  attributes: Record<string, unknown>;
  geometry?: Record<string, unknown> | null;
};

export type MississippiSosSnapshotHandle = {
  handle: string;
  publicLayerUrl: string;
  layerName: string;
  objectIdField: string;
  fields: string[];
  maxRecordCount: number;
  reportedCount: number;
  objectIds: Array<string | number>;
  consistencyEvidence: string;
  observedAt: string;
  publishedAt: string | null;
};

export type MississippiSosAuthorizedTransport = {
  beginConsistentSnapshot(input: {
    scheduledFor: string;
    attempt: number;
  }): Promise<MississippiSosSnapshotHandle>;
  readSnapshotBatch(input: {
    handle: string;
    objectIdField: string;
    requestedIds: string[];
    batchNumber: number;
  }): Promise<{
    status: "succeeded" | "partial" | "failed";
    features: ArcGisFeature[];
    error: string | null;
  }>;
};

function required(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function canonicalIso(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function safePublicUrl(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("publicLayerUrl must use HTTP(S)");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("publicLayerUrl cannot contain credentials, query parameters, or fragments");
  }
  return parsed.toString().replace(/\/$/, "");
}

function safeArtifactPrefix(value: string) {
  const prefix = required(value, "artifactPrefix").replace(/^\/+|\/+$/g, "");
  if (
    prefix.includes("\\") ||
    prefix.includes("..") ||
    prefix.includes("://") ||
    prefix.includes("?")
  ) {
    throw new Error(
      "artifactPrefix must be a relative object-storage prefix without traversal, URLs, or query parameters",
    );
  }
  return prefix;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function objectId(attributes: Record<string, unknown>, objectIdField: string) {
  const field = Object.keys(attributes).find(
    (key) => key.toLowerCase() === objectIdField.toLowerCase(),
  );
  const value = field ? attributes[field] : null;
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`ArcGIS feature is missing ${objectIdField}`);
  return normalized;
}

function featureForNormalization(raw: ArcGisFeature, objectIdField: string): MississippiSosFeature {
  return { ...raw.attributes, objectid: objectId(raw.attributes, objectIdField) };
}

async function archiveJson(
  store: ImmutableJsonArtifactStore,
  objectStorageKey: string,
  value: unknown,
) {
  const canonicalJson = stableSerialize(value);
  const sha256 = await stableSha256(value);
  await store.putCanonicalJson({
    objectStorageKey,
    canonicalJson,
    sha256,
    mimeType: "application/json",
  });
  return {
    sha256,
    objectStorageKey,
    mimeType: "application/json" as const,
    byteSize: new TextEncoder().encode(canonicalJson).byteLength,
  };
}

// Ported from the source adapter's `discover`.
export async function discoverMississippiSosSnapshot(input: {
  transport: MississippiSosAuthorizedTransport;
  artifactStore: ImmutableJsonArtifactStore;
  artifactPrefix: string;
  scheduledFor: string;
  attempt: number;
  batchSize: number;
}) {
  const artifactPrefix = safeArtifactPrefix(input.artifactPrefix);
  const opened = await input.transport.beginConsistentSnapshot({
    scheduledFor: input.scheduledFor,
    attempt: input.attempt,
  });
  const publicLayerUrl = safePublicUrl(opened.publicLayerUrl);
  canonicalIso(opened.observedAt, "snapshot observedAt");
  if (opened.publishedAt !== null) canonicalIso(opened.publishedAt, "snapshot publishedAt");
  required(opened.handle, "snapshot handle");
  const consistencyEvidence = required(opened.consistencyEvidence, "snapshot consistencyEvidence");
  const consistencyEvidenceSha256 = await stableSha256(consistencyEvidence);
  const objectIdField = required(opened.objectIdField, "snapshot objectIdField");
  const fields = new Set(opened.fields.map((field) => field.trim().toLowerCase()));
  for (const requiredField of [objectIdField.toLowerCase(), "parcel_id", "county"]) {
    if (!fields.has(requiredField))
      throw new Error(`Mississippi SOS snapshot is missing required ArcGIS field ${requiredField}`);
  }
  const maxRecordCount = positiveInteger(opened.maxRecordCount, "snapshot maxRecordCount");
  if (input.batchSize > maxRecordCount)
    throw new Error("requested batchSize exceeds the authorized snapshot service maximum");
  if (!Number.isInteger(opened.reportedCount) || opened.reportedCount < 0) {
    throw new Error("snapshot reportedCount must be a nonnegative integer");
  }
  const snapshot: MississippiSosSnapshotHandle = {
    ...opened,
    publicLayerUrl,
    layerName: required(opened.layerName, "snapshot layerName"),
    maxRecordCount,
  };
  const discoveryEvidence = {
    contract: "accountabul-ms-sos-arcgis-v1",
    scheduledFor: input.scheduledFor,
    attempt: input.attempt,
    publicLayerUrl,
    layerName: snapshot.layerName,
    objectIdField,
    fields: [...fields].sort(),
    maxRecordCount,
    reportedCount: opened.reportedCount,
    objectIds: opened.objectIds.map((value) => String(value).trim()),
    consistencyEvidenceSha256,
    observedAt: opened.observedAt,
    publishedAt: opened.publishedAt,
  };
  const artifact = await archiveJson(
    input.artifactStore,
    `${artifactPrefix}/${input.scheduledFor.replace(/[:.]/g, "-")}/a${input.attempt}/discovery.json`,
    discoveryEvidence,
  );
  return {
    snapshot,
    objectIdField,
    expectedIds: discoveryEvidence.objectIds,
    reportedCount: opened.reportedCount,
    artifact,
  };
}

// Ported from the source adapter's `fetchBatch`.
export async function fetchMississippiSosBatch(input: {
  transport: MississippiSosAuthorizedTransport;
  handle: string;
  objectIdField: string;
  requestedIds: string[];
  batchNumber: number;
}) {
  const result = await input.transport.readSnapshotBatch({
    handle: input.handle,
    objectIdField: input.objectIdField,
    requestedIds: input.requestedIds,
    batchNumber: input.batchNumber,
  });
  if (result.status === "failed")
    throw new Error(result.error ?? "Mississippi SOS batch retrieval failed");
  const features = result.features.map((feature) =>
    featureForNormalization(feature, input.objectIdField),
  );
  return { status: result.status, features };
}

export function normalizeMississippiSosFeature(input: {
  jurisdiction: JurisdictionReference;
  document: SourceDocumentReference;
  feature: MississippiSosFeature;
}) {
  return normalizeMississippiSosInventory(input);
}
