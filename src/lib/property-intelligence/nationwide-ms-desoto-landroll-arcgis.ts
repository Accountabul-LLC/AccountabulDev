// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-ms-desoto-landroll-arcgis.ts:
// the discovery + batch-fetch shell for DeSoto County, Mississippi's
// preliminary 2026 land-roll ArcGIS FeatureServer layer, plus its
// geometry-part grouping (`groupStableFeatures`) -- the layer publishes one
// feature per geometry part of a multi-part parcel, all joined to the same
// land-roll PIN, and this reconciles them into one aggregate per parcel,
// failing closed on any mismatch between parts -- and its feature
// normalization (see nationwide-property-record-intake.ts).
//
// Same injected-`fetchImpl`-with-no-default, reviewed-origin-only shell as
// nationwide-st-louis-lra-arcgis.ts. Unlike St. Louis LRA, this source has
// no live-execution entrypoint wired: nationwide-live-st-louis-lra.server.ts
// binds only mo_st_louis_lra_inventory_v1 and leaves this source's binding
// an inert stub that throws if ever dispatched.
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import { stableSerialize, stableSha256 } from "./nationwide-fingerprint.ts";
import {
  normalizeMississippiDesotoLandrollProperty,
  type MississippiDesotoLandrollFeature,
} from "./nationwide-property-record-intake.ts";
import type { SourceDocumentReference } from "./nationwide-property-intake-types.ts";

export const MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL =
  "https://gis.desotocountyms.gov/arcgis/rest/services/Hosted/Landroll_Parcels_2026_Prelim/FeatureServer/0";

const REQUIRED_FIELDS = [
  "objectid",
  "pin",
  "pin_1",
  "desc_",
  "multipart",
  "acreage",
  "lrstid",
  "lrname",
  "lincof",
  "lrmadd",
  "lrcity",
  "lrstat",
  "lrzip",
  "lrsect",
  "lrtwn",
  "lrrnge",
  "lrimpr",
  "lraiv2",
  "lracul",
  "lrtot",
  "lrstot",
  "lrtacr",
  "lrsubc",
  "lrlocs",
  "lrlocn",
  "lrddbk",
  "lrddpg",
  "lrdddt",
  "sbname",
  "lrlot",
  "lrlocn2",
  "lrlocs3",
  "lrlocc",
  "lrexmt",
  "lrdist",
  "physical_address",
] as const;

const LANDROLL_INVARIANT_FIELDS = REQUIRED_FIELDS.filter(
  (field) => !["objectid", "pin", "pin_1", "desc_", "multipart", "acreage"].includes(field),
);

function hasLandrollCore(feature: MississippiDesotoLandrollFeature) {
  const stateId =
    typeof feature.lrstid === "string"
      ? feature.lrstid.trim()
      : String(feature.lrstid ?? "").trim();
  const nonnegativeNumber = (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0;
  };
  return (
    Boolean(stateId) &&
    nonnegativeNumber(feature.lrtacr) &&
    nonnegativeNumber(feature.lrtot) &&
    nonnegativeNumber(feature.lrstot)
  );
}

type ArcGisMetadata = {
  name?: unknown;
  type?: unknown;
  maxRecordCount?: unknown;
  fields?: Array<{ name?: unknown; type?: unknown }>;
  error?: unknown;
};

type ArcGisIdResponse = { objectIdFieldName?: unknown; objectIds?: unknown; error?: unknown };

type ArcGisFeatureResponse = {
  objectIdFieldName?: unknown;
  exceededTransferLimit?: unknown;
  features?: Array<{ attributes?: unknown }>;
  error?: unknown;
};

export type MississippiDesotoLandrollAggregate = MississippiDesotoLandrollFeature & {
  partObjectIds: number[];
  sourceFeatureCount: number;
  conflictFields: string[];
  geometryDescriptionVaries: boolean;
};

export type ArtifactBatch = {
  sha256: string;
  objectStorageKey: string;
  mimeType: "application/json";
  byteSize: number;
};

function responseObject(value: unknown, kind: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`official DeSoto land-roll ${kind} response is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function fetchArcGisJson(
  fetchImpl: typeof fetch,
  url: URL,
  kind: string,
  form?: URLSearchParams,
) {
  const reviewed = new URL(MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL);
  if (url.origin !== reviewed.origin || !url.pathname.startsWith(reviewed.pathname)) {
    throw new Error(
      "official DeSoto land-roll retrieval is restricted to the reviewed county ArcGIS layer",
    );
  }
  const response = await fetchImpl(url, {
    method: form ? "POST" : "GET",
    headers: {
      accept: "application/json",
      ...(form ? { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}),
    },
    ...(form ? { body: form.toString() } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`official DeSoto land-roll ${kind} request returned HTTP ${response.status}`);
  const body = responseObject(await response.json(), kind);
  if (body["error"])
    throw new Error(`official DeSoto land-roll ${kind} response reported a provider error`);
  return body;
}

function objectIdsFrom(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("official DeSoto land-roll discovery did not return objectIds");
  const ids = value
    .map((item) => {
      const parsed = typeof item === "number" ? item : Number(item);
      if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error("official DeSoto land-roll objectIds must be positive safe integers");
      return parsed;
    })
    .sort((left, right) => left - right);
  if (new Set(ids).size !== ids.length)
    throw new Error("official DeSoto land-roll discovery returned duplicate objectIds");
  return ids;
}

function featureObjectId(attributes: MississippiDesotoLandrollFeature) {
  const parsed =
    typeof attributes.objectid === "number" ? attributes.objectid : Number(attributes.objectid);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("official DeSoto preliminary land-roll feature is missing a positive objectid");
  return parsed;
}

function normalizedPin(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

function comparableFeature(feature: MississippiDesotoLandrollFeature, field: string) {
  const value = (feature as Record<string, unknown>)[field];
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim() || null;
  return value ?? null;
}

// Ported from the source's `groupStableFeatures`: the DeSoto layer publishes
// one feature per geometry part of a multi-part parcel. This groups by the
// joined land-roll PIN, records every conflict it finds instead of throwing
// eagerly (so a caller can decide per parcel), and always sorts the group's
// member features by objectid before picking a representative so the result
// is deterministic regardless of input order.
export function groupStableFeatures(features: MississippiDesotoLandrollFeature[]) {
  const parts = new Map<string, MississippiDesotoLandrollFeature[]>();
  for (const feature of features) {
    const objectId = featureObjectId(feature);
    const pin = normalizedPin(feature.pin_1);
    const key = pin ? `parcel:${pin}` : `unidentified:${objectId}`;
    const group = parts.get(key) ?? [];
    group.push(feature);
    parts.set(key, group);
  }
  const groups = new Map<string, MississippiDesotoLandrollAggregate>();
  for (const [key, group] of [...parts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    group.sort((left, right) => featureObjectId(left) - featureObjectId(right));
    const representative = group[0] as MississippiDesotoLandrollFeature;
    const conflictFields = key.startsWith("unidentified:") ? ["pin_1"] : [];
    const landrollPin = key.startsWith("parcel:") ? key.slice("parcel:".length) : null;
    if (landrollPin && group.some((feature) => normalizedPin(feature.pin) !== landrollPin))
      conflictFields.push("pin_join");
    if (landrollPin && group.some((feature) => !hasLandrollCore(feature)))
      conflictFields.push("landroll_core");
    for (const field of LANDROLL_INVARIANT_FIELDS) {
      const expected = stableSerialize(comparableFeature(representative, field));
      if (group.some((feature) => stableSerialize(comparableFeature(feature, field)) !== expected))
        conflictFields.push(field);
    }
    const geometryDescriptionVaries =
      new Set(group.map((feature) => stableSerialize(comparableFeature(feature, "desc_")))).size >
      1;
    groups.set(key, {
      ...representative,
      partObjectIds: group.map(featureObjectId),
      sourceFeatureCount: group.length,
      conflictFields: [...new Set(conflictFields)].sort(),
      geometryDescriptionVaries,
    });
  }
  return groups;
}

async function archiveJson(
  store: ImmutableJsonArtifactStore,
  objectStorageKey: string,
  value: unknown,
): Promise<ArtifactBatch> {
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
    mimeType: "application/json",
    byteSize: new TextEncoder().encode(canonicalJson).byteLength,
  };
}

function queryUrl() {
  return new URL(`${MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL}/query`);
}

export async function discoverMississippiDesotoLandrollObjectIds(input: {
  fetchImpl: typeof fetch;
  artifactStore: ImmutableJsonArtifactStore;
  runPrefix: string;
  retrievedAt: string;
  batchSize: number;
}) {
  const metadata = (await fetchArcGisJson(
    input.fetchImpl,
    new URL(`${MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL}?f=json`),
    "metadata",
  )) as ArcGisMetadata;
  if (metadata.type !== "Feature Layer")
    throw new Error("official DeSoto land-roll layer identity changed");
  const maximum = Number(metadata.maxRecordCount);
  if (!Number.isSafeInteger(maximum) || maximum < input.batchSize) {
    throw new Error("official DeSoto land-roll layer maximum is below the registered batch size");
  }
  const fields = new Map(
    (metadata.fields ?? []).map((field) => [String(field.name ?? ""), String(field.type ?? "")]),
  );
  for (const field of REQUIRED_FIELDS) {
    if (!fields.has(field))
      throw new Error(`official DeSoto land-roll layer is missing required field ${field}`);
  }
  const queryFields = [...REQUIRED_FIELDS].sort((left, right) => left.localeCompare(right));
  const idUrl = new URL(queryUrl());
  idUrl.searchParams.set("where", "1=1");
  idUrl.searchParams.set("returnIdsOnly", "true");
  idUrl.searchParams.set("f", "json");
  const first = (await fetchArcGisJson(
    input.fetchImpl,
    idUrl,
    "object-ID discovery",
  )) as ArcGisIdResponse;
  const second = (await fetchArcGisJson(
    input.fetchImpl,
    idUrl,
    "object-ID stabilization",
  )) as ArcGisIdResponse;
  if (first.objectIdFieldName !== "OBJECTID" && first.objectIdFieldName !== "objectid") {
    throw new Error("official DeSoto land-roll object-ID field changed");
  }
  const firstIds = objectIdsFrom(first.objectIds);
  const secondIds = objectIdsFrom(second.objectIds);
  if (
    firstIds.length !== secondIds.length ||
    firstIds.some((id, index) => id !== secondIds[index])
  ) {
    throw new Error(
      "official DeSoto land-roll membership changed between complete object-ID reads",
    );
  }
  const discoveryEvidence = {
    contract: "accountabul-ms-desoto-landroll-arcgis-v1",
    layerUrl: MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL,
    objectIdField: "OBJECTID",
    where: "1=1",
    maxRecordCount: maximum,
    queriedFields: queryFields,
    reportedCount: firstIds.length,
    objectIds: firstIds,
    stabilizationPasses: 2,
    retrievedAt: input.retrievedAt,
  };
  const artifact = await archiveJson(
    input.artifactStore,
    `${input.runPrefix}/discovery.json`,
    discoveryEvidence,
  );
  return { expectedIds: firstIds, reportedCount: firstIds.length, queryFields, artifact };
}

export async function fetchMississippiDesotoLandrollBatch(input: {
  fetchImpl: typeof fetch;
  artifactStore: ImmutableJsonArtifactStore;
  runPrefix: string;
  batchNumber: number;
  requestedIds: number[];
  queryFields: string[];
}) {
  const batchParameters = new URLSearchParams({
    where: "1=1",
    objectIds: input.requestedIds.join(","),
    outFields: input.queryFields.join(","),
    returnGeometry: "false",
    f: "json",
  });
  const rawBody = await fetchArcGisJson(
    input.fetchImpl,
    queryUrl(),
    "feature batch",
    batchParameters,
  );
  const body = rawBody as ArcGisFeatureResponse;
  if (body.exceededTransferLimit === true)
    throw new Error(
      "official DeSoto land-roll feature response exceeded the service transfer limit",
    );
  if (!Array.isArray(body.features))
    throw new Error("official DeSoto land-roll feature response did not return features");
  const features = body.features.map((feature) => {
    const attributes = responseObject(
      feature.attributes,
      "feature attributes",
    ) as MississippiDesotoLandrollFeature;
    featureObjectId(attributes);
    return attributes;
  });
  const returnedIds = features.map(featureObjectId);
  if (new Set(returnedIds).size !== returnedIds.length)
    throw new Error("official DeSoto land-roll feature response returned duplicate objectIds");
  const artifact = await archiveJson(
    input.artifactStore,
    `${input.runPrefix}/batch-${String(input.batchNumber).padStart(5, "0")}.json`,
    { ...rawBody, requestedIds: input.requestedIds, returnedIds },
  );
  return { artifact, features };
}

export function normalizeMississippiDesotoLandrollFeature(input: {
  document: SourceDocumentReference;
  aggregate: MississippiDesotoLandrollAggregate;
}) {
  return normalizeMississippiDesotoLandrollProperty({
    jurisdiction: { stateCode: "MS", countyName: "DeSoto", countyFips: "28033" },
    document: input.document,
    feature: input.aggregate,
  });
}
