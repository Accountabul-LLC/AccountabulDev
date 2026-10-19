// Live `fetchRows` for ms_desoto_county_landroll_2026_prelim_v1, the second
// nationwide source to come live after mo_st_louis_lra_inventory_v1.
//
// Like nationwide-st-louis-lra-live-fetch.server.ts, this module is only the
// wiring between two halves that were already reviewed and ported:
// nationwide-ms-desoto-landroll-arcgis.ts does every request, and that module
// pins each one to the official DeSoto County ArcGIS layer
// (MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL) and refuses any other origin or
// path. Nothing new about the source contract is decided here.
//
// One thing is genuinely different from the LRA source, and it is the reason
// this cannot simply be the LRA module with different names: a DeSoto parcel
// is published as SEVERAL land-roll rows, which `groupStableFeatures` folds
// into one aggregate per parcel. Those parts are not guaranteed to land in
// the same object-ID batch, so grouping can only run once every batch has
// been read -- grouping per batch would split a parcel into two half-built
// aggregates whose conflictFields disagree with each other. The features are
// therefore accumulated across the whole run and grouped at the end.
//
// Because an aggregate can span batches, the evidence document attached to a
// row is the batch artifact that carried that aggregate's representative part
// (`partObjectIds[0]`, the lowest object ID, which is the row
// `groupStableFeatures` builds the aggregate from). Attaching some other
// batch's artifact would point the row's evidence at bytes that do not
// contain it.
//
// Real HTTP happens by design once the returned function is invoked, never at
// import time and never at module scope: `createMississippiDesotoLandrollLiveFetchRows`
// only builds the zero-argument function that
// `nationwide-source-adapter-bindings.ts`'s
// `fetchRows.ms_desoto_county_landroll_2026_prelim_v1` requires.
import {
  discoverMississippiDesotoLandrollObjectIds,
  fetchMississippiDesotoLandrollBatch,
  groupStableFeatures,
  MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL,
  type MississippiDesotoLandrollAggregate,
} from "./nationwide-ms-desoto-landroll-arcgis.ts";
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import type { normalizeMississippiDesotoLandrollProperty } from "./nationwide-property-record-intake.ts";

const MISSISSIPPI_DESOTO_JURISDICTION = Object.freeze({
  stateCode: "MS",
  countyName: "DeSoto",
  countyFips: "28033",
});

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 5_000;

export type MississippiDesotoLandrollLiveFetchOptions = {
  // No default, for the same reason the LRA module gives none: the caller
  // supplies a real ImmutableJsonArtifactStore. This module never builds one.
  artifactStore: ImmutableJsonArtifactStore;
  // Only set by tests, which inject a fake that never reaches the network.
  fetchImpl?: typeof fetch;
  batchSize?: number;
};

type NormalizeInput = Parameters<typeof normalizeMississippiDesotoLandrollProperty>[0];

export type MississippiDesotoLandrollFetchRows = () => Promise<{
  rows: NormalizeInput[];
  sourceObjectIds: string[];
  reportedCount: number;
}>;

function boundedBatchSize(value: number | undefined) {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return batchSize;
}

function representativeObjectId(aggregate: MississippiDesotoLandrollAggregate) {
  const objectId = aggregate.partObjectIds[0];
  if (objectId === undefined) {
    throw new Error("official DeSoto land-roll aggregate carries no part object IDs");
  }
  return objectId;
}

export function createMississippiDesotoLandrollLiveFetchRows(
  options: MississippiDesotoLandrollLiveFetchOptions,
): MississippiDesotoLandrollFetchRows {
  if (!options.artifactStore || typeof options.artifactStore.putCanonicalJson !== "function") {
    throw new Error(
      "createMississippiDesotoLandrollLiveFetchRows requires an injected artifactStore",
    );
  }
  const artifactStore = options.artifactStore;
  const batchSize = boundedBatchSize(options.batchSize);

  return async function fetchMississippiDesotoLandrollRowsLive() {
    const fetchImpl = options.fetchImpl ?? fetch;
    const retrievedAt = new Date().toISOString();
    const runPrefix = `ms_desoto_county_landroll_2026_prelim_v1/${retrievedAt}-${crypto.randomUUID()}`;

    const discovery = await discoverMississippiDesotoLandrollObjectIds({
      fetchImpl,
      artifactStore,
      runPrefix,
      retrievedAt,
      batchSize,
    });

    // Accumulated across every batch: see the header -- a parcel's parts can
    // straddle a batch boundary, so nothing can be grouped until all of them
    // have been read.
    const features: Parameters<typeof groupStableFeatures>[0] = [];
    const documentByObjectId = new Map<number, NormalizeInput["document"]>();
    let batchNumber = 1;
    for (let start = 0; start < discovery.expectedIds.length; start += batchSize) {
      const requestedIds = discovery.expectedIds.slice(start, start + batchSize);
      const batch = await fetchMississippiDesotoLandrollBatch({
        fetchImpl,
        artifactStore,
        runPrefix,
        batchNumber,
        requestedIds,
        queryFields: discovery.queryFields,
      });
      const document = {
        url: `${MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL}/query`,
        title: "DeSoto County preliminary 2026 land roll (ArcGIS)",
        sha256: batch.artifact.sha256,
        retrievedAt,
        objectStorageKey: batch.artifact.objectStorageKey,
        mimeType: batch.artifact.mimeType,
        byteSize: batch.artifact.byteSize,
      };
      for (const feature of batch.features) {
        features.push(feature);
        const objectId =
          typeof feature.objectid === "number" ? feature.objectid : Number(feature.objectid);
        documentByObjectId.set(objectId, document);
      }
      batchNumber += 1;
    }

    const rows: NormalizeInput[] = [];
    for (const aggregate of groupStableFeatures(features).values()) {
      const document = documentByObjectId.get(representativeObjectId(aggregate));
      if (document === undefined) {
        throw new Error(
          "official DeSoto land-roll aggregate has no archived batch evidence for its representative part",
        );
      }
      rows.push({
        jurisdiction: MISSISSIPPI_DESOTO_JURISDICTION,
        document,
        feature: aggregate,
      });
    }

    return {
      rows,
      sourceObjectIds: discovery.expectedIds.map((objectId) => String(objectId)),
      reportedCount: discovery.reportedCount,
    };
  };
}
