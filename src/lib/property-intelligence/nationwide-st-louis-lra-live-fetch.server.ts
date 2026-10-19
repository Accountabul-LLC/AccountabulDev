// Live-execution proof, step 2 (owner-approved staged rollout: apply the
// nationwide migrations to the live Supabase project -> bring ONE adapter
// live first -> St. Louis LRA only, source key mo_st_louis_lra_inventory_v1,
// contract version 3). Real `fetchRows` implementation for that source,
// wired against Slice 3's nationwide-st-louis-lra-arcgis.ts
// (discoverStLouisOfficialLraObjectIds / fetchStLouisOfficialLraBatch),
// which already restricts every request to the reviewed, official City of
// St. Louis ArcGIS layer (ST_LOUIS_OFFICIAL_LRA_LAYER_URL -- see that
// module's own header/comments) and rejects any other origin or path.
//
// This module performs real HTTP by design once invoked, using the global
// `fetch` (no new dependency needed). It matches this repo's lazy-init
// convention: nothing here runs, and no network call is ever attempted, at
// import time or at module scope -- `createStLouisLraLiveFetchRows` only
// returns a zero-argument fetch function (the exact shape
// `nationwide-source-adapter-bindings.ts`'s `fetchRows.mo_st_louis_lra_inventory_v1`
// requires); the HTTP calls happen only when a caller later invokes that
// returned function.
//
// This is the ONLY live fetch implementation this slice adds. The other
// five nationwide source keys are intentionally left exactly as inert as
// Slice 4 left them -- see nationwide-live-st-louis-lra.server.ts's header.
import {
  discoverStLouisOfficialLraObjectIds,
  fetchStLouisOfficialLraBatch,
  ST_LOUIS_OFFICIAL_LRA_LAYER_URL,
} from "./nationwide-st-louis-lra-arcgis.ts";
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import type { normalizeStLouisOfficialLraProperty } from "./nationwide-property-record-intake.ts";

const ST_LOUIS_LRA_JURISDICTION = Object.freeze({
  stateCode: "MO",
  countyName: "St. Louis City",
  countyFips: "29510",
});

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 5_000;

export type StLouisLraLiveFetchOptions = {
  // No default: the caller supplies a real ImmutableJsonArtifactStore, e.g.
  // createNationwideSupabaseArtifactStore(bucket) from
  // nationwide-supabase-artifact-store.ts backed by a real Supabase Storage
  // bucket client. This module never constructs one itself.
  artifactStore: ImmutableJsonArtifactStore;
  // No default: only set for tests, which inject a fake fetch that never
  // reaches the network. Real callers omit this and get the global `fetch`.
  fetchImpl?: typeof fetch;
  batchSize?: number;
};

type NormalizeInput = Parameters<typeof normalizeStLouisOfficialLraProperty>[0];

export type StLouisLraFetchRows = () => Promise<{
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

// Returns a zero-argument `fetchRows` function matching
// `NationwideSourceAdapterDependencies["fetchRows"]["mo_st_louis_lra_inventory_v1"]`.
// Every real HTTP request and every timestamp is generated when that
// returned function is CALLED, never here.
export function createStLouisLraLiveFetchRows(
  options: StLouisLraLiveFetchOptions,
): StLouisLraFetchRows {
  if (!options.artifactStore || typeof options.artifactStore.putCanonicalJson !== "function") {
    throw new Error("createStLouisLraLiveFetchRows requires an injected artifactStore");
  }
  const artifactStore = options.artifactStore;
  const batchSize = boundedBatchSize(options.batchSize);

  return async function fetchStLouisLraRowsLive() {
    const fetchImpl = options.fetchImpl ?? fetch;
    const retrievedAt = new Date().toISOString();
    const runPrefix = `mo_st_louis_lra_inventory_v1/${retrievedAt}-${crypto.randomUUID()}`;

    const discovery = await discoverStLouisOfficialLraObjectIds({
      fetchImpl,
      artifactStore,
      runPrefix,
      retrievedAt,
      batchSize,
    });

    const rows: NormalizeInput[] = [];
    let batchNumber = 1;
    for (let start = 0; start < discovery.expectedIds.length; start += batchSize) {
      const requestedIds = discovery.expectedIds.slice(start, start + batchSize);
      const batch = await fetchStLouisOfficialLraBatch({
        fetchImpl,
        artifactStore,
        runPrefix,
        batchNumber,
        requestedIds,
        queryFields: discovery.queryFields,
      });
      const document = {
        url: `${ST_LOUIS_OFFICIAL_LRA_LAYER_URL}/query`,
        title: "City of St. Louis LRA/PIEA/LCRA real estate inventory (ArcGIS)",
        sha256: batch.artifact.sha256,
        retrievedAt,
        objectStorageKey: batch.artifact.objectStorageKey,
        mimeType: batch.artifact.mimeType,
        byteSize: batch.artifact.byteSize,
      };
      for (const feature of batch.features) {
        rows.push({ jurisdiction: ST_LOUIS_LRA_JURISDICTION, document, feature });
      }
      batchNumber += 1;
    }

    return {
      rows,
      sourceObjectIds: discovery.expectedIds,
      reportedCount: discovery.reportedCount,
    };
  };
}
