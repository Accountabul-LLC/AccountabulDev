// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-st-louis-lra-arcgis.ts: the
// discovery + batch-fetch shell for the City of St. Louis's official LRA
// (Land Reutilization Authority) inventory ArcGIS FeatureServer layer, plus
// its feature normalization (see nationwide-property-record-intake.ts).
//
// The source's version wires `discover`/`fetchBatch`/`normalizeRecord` into
// `executeNationwideSnapshotIngestion`, the DB-writing orchestrator loop.
// This module instead exposes `discoverStLouisOfficialLraObjectIds` and
// `fetchStLouisOfficialLraBatch` as standalone functions an orchestrator
// calls -- Slice 4's nationwide-source-adapter-bindings.ts is that caller,
// and it writes property_ingest.source_records / property_core.properties
// through nationwide-postgres-writer.ts. Both take an injected `fetchImpl: typeof fetch`
// with NO default and reject any URL outside the reviewed ArcGIS layer, so
// this module cannot reach the network unless a caller explicitly supplies
// a real fetch -- the same injected-dependency-with-no-default pattern
// Slice 2 used for the health delivery sink and the Supabase artifact
// store's storage bucket.
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import { stableSerialize, stableSha256 } from "./nationwide-fingerprint.ts";
import {
  normalizeStLouisOfficialLraProperty,
  type StLouisOfficialLraFeature,
} from "./nationwide-property-record-intake.ts";
import type { SourceDocumentReference } from "./nationwide-property-intake-types.ts";

export const ST_LOUIS_OFFICIAL_LRA_LAYER_URL =
  "https://maps8.stlouis-mo.gov/arcgis/rest/services/SLDC/LRA_PIEA_LCRA_Real_Estate/MapServer/0";

const REQUIRED_FIELDS = [
  "OBJECTID",
  "ParcelId",
  "ADDRESS",
  "Status",
  "Usage",
  "Class",
  "LegalDescription",
  "PropertyType",
  "WARD",
  "NEIGHBORHOOD_NUM",
  "ZipCode",
  "SQFT",
  "Frontage",
  "NbrOfUnits",
  "LRA_PRICING",
  "AssessorsTotal",
  "Featured",
  "PublicNotice",
  "Environmental",
  "Irregular_Lot",
  "BuriedMaterials",
  "SideLotEligible",
  "Description",
] as const;

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

export type ArtifactBatch = {
  sha256: string;
  objectStorageKey: string;
  mimeType: "application/json";
  byteSize: number;
};

function responseObject(value: unknown, kind: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`official LRA ${kind} response is not a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function fetchArcGisJson(
  fetchImpl: typeof fetch,
  url: URL,
  kind: string,
  form?: URLSearchParams,
) {
  const reviewed = new URL(ST_LOUIS_OFFICIAL_LRA_LAYER_URL);
  if (url.origin !== reviewed.origin || !url.pathname.startsWith(reviewed.pathname)) {
    throw new Error("official LRA retrieval is restricted to the reviewed city ArcGIS layer");
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
    throw new Error(`official LRA ${kind} request returned HTTP ${response.status}`);
  const body = responseObject(await response.json(), kind);
  if (body["error"]) throw new Error(`official LRA ${kind} response reported a provider error`);
  return body;
}

function idsFrom(value: unknown) {
  if (!Array.isArray(value)) throw new Error("official LRA discovery did not return objectIds");
  const ids = value
    .map((item) => {
      const parsed = typeof item === "number" ? item : Number(item);
      if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error("official LRA objectIds must be positive safe integers");
      return String(parsed);
    })
    .sort((left, right) => Number(left) - Number(right));
  if (new Set(ids).size !== ids.length)
    throw new Error("official LRA discovery returned duplicate objectIds");
  return ids;
}

function featureObjectId(attributes: StLouisOfficialLraFeature) {
  const parsed =
    typeof attributes.OBJECTID === "number" ? attributes.OBJECTID : Number(attributes.OBJECTID);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("official LRA feature is missing a positive OBJECTID");
  return String(parsed);
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

function queryUrl(parameters: Record<string, string>) {
  const url = new URL(`${ST_LOUIS_OFFICIAL_LRA_LAYER_URL}/query`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

// Ported from the source adapter's `discover`: reads the layer's field
// metadata once, then reads the complete objectId membership TWICE (the
// ArcGIS service publishes no transaction snapshot) and fails closed if the
// two reads disagree, before archiving the discovery evidence.
export async function discoverStLouisOfficialLraObjectIds(input: {
  fetchImpl: typeof fetch;
  artifactStore: ImmutableJsonArtifactStore;
  runPrefix: string;
  retrievedAt: string;
  batchSize: number;
}) {
  const metadata = (await fetchArcGisJson(
    input.fetchImpl,
    new URL(`${ST_LOUIS_OFFICIAL_LRA_LAYER_URL}?f=json`),
    "metadata",
  )) as ArcGisMetadata;
  if (metadata.name !== "LRA_Real_Estate" || metadata.type !== "Feature Layer") {
    throw new Error("official LRA layer identity changed");
  }
  const maximum = Number(metadata.maxRecordCount);
  if (!Number.isSafeInteger(maximum) || maximum < input.batchSize) {
    throw new Error("official LRA layer maximum is below the registered batch size");
  }
  const fields = new Map(
    (metadata.fields ?? []).map((field) => [String(field.name ?? ""), String(field.type ?? "")]),
  );
  for (const field of REQUIRED_FIELDS) {
    if (!fields.has(field))
      throw new Error(`official LRA layer is missing required field ${field}`);
  }
  const queryFields = [...REQUIRED_FIELDS].sort((left, right) => left.localeCompare(right));
  const idUrl = queryUrl({ where: "1=1", returnIdsOnly: "true", f: "json" });
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
  if (first.objectIdFieldName !== "OBJECTID" || second.objectIdFieldName !== "OBJECTID") {
    throw new Error("official LRA object-ID field changed");
  }
  const firstIds = idsFrom(first.objectIds);
  const secondIds = idsFrom(second.objectIds);
  if (
    firstIds.length !== secondIds.length ||
    firstIds.some((id, index) => id !== secondIds[index])
  ) {
    throw new Error("official LRA membership changed between complete object-ID reads");
  }
  const discoveryEvidence = {
    contract: "accountabul-st-louis-official-lra-arcgis-v1",
    layerUrl: ST_LOUIS_OFFICIAL_LRA_LAYER_URL,
    layerName: metadata.name,
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

// Ported from the source adapter's `fetchBatch`.
export async function fetchStLouisOfficialLraBatch(input: {
  fetchImpl: typeof fetch;
  artifactStore: ImmutableJsonArtifactStore;
  runPrefix: string;
  batchNumber: number;
  requestedIds: string[];
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
    new URL(`${ST_LOUIS_OFFICIAL_LRA_LAYER_URL}/query`),
    "feature batch",
    batchParameters,
  );
  const body = rawBody as ArcGisFeatureResponse;
  if (body.objectIdFieldName !== undefined && body.objectIdFieldName !== "OBJECTID") {
    throw new Error("official LRA feature response object-ID field changed");
  }
  if (body.exceededTransferLimit === true)
    throw new Error("official LRA feature response exceeded the service transfer limit");
  if (!Array.isArray(body.features))
    throw new Error("official LRA feature response did not return features");
  const features = body.features.map((feature) => {
    const attributes = responseObject(
      feature.attributes,
      "feature attributes",
    ) as StLouisOfficialLraFeature;
    featureObjectId(attributes);
    return attributes;
  });
  const returnedIds = features.map(featureObjectId);
  if (new Set(returnedIds).size !== returnedIds.length)
    throw new Error("official LRA feature response returned duplicate OBJECTIDs");
  const artifact = await archiveJson(
    input.artifactStore,
    `${input.runPrefix}/batch-${String(input.batchNumber).padStart(5, "0")}.json`,
    { ...rawBody, requestedIds: input.requestedIds, returnedIds },
  );
  return { artifact, features };
}

export function normalizeStLouisOfficialLraFeature(input: {
  document: SourceDocumentReference;
  feature: StLouisOfficialLraFeature;
}) {
  return normalizeStLouisOfficialLraProperty({
    jurisdiction: { stateCode: "MO", countyName: "St. Louis City", countyFips: "29510" },
    document: input.document,
    feature: input.feature,
  });
}
