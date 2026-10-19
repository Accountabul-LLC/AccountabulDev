// Live `fetchRows` for ms_sos_active_tax_forfeited_inventory_v1.
//
// This source differs from the two ArcGIS county layers in a way that is
// deliberate, and that this module does not get to soften: it is NOT reached
// with a bare `fetch`. nationwide-ms-sos-arcgis.ts models retrieval as a
// `MississippiSosAuthorizedTransport` -- an injected, credentialed transport
// that opens a CONSISTENT snapshot (`beginConsistentSnapshot`) and then reads
// batches against that snapshot handle. The consistency handle is the point:
// the statewide inventory changes under a reader, and a run that paged it
// with independent queries would mix two different inventories together and
// call the result one snapshot. So this module takes the transport as a
// dependency and never constructs one, exactly as it never constructs an
// artifact store. Supplying that transport (and its credentials) is the
// caller's job.
//
// The jurisdiction is injected for a related reason. A run writes under ONE
// registered `jurisdictionId` (see `runSnapshotIngestion` in
// nationwide-source-adapter-bindings.ts), but the statewide inventory
// publishes lots for all 82 Mississippi counties. Rather than guess a county
// FIPS from the published `county` string, this module attaches the
// registered county the caller names and lets
// nationwide-ms-sos-normalize.ts do what it already does: warn when a
// feature's published county disagrees with the registered jurisdiction.
// Features for other counties are left out of the run rather than written
// under the wrong jurisdiction.
//
// Unlike the county layers, batches are not separately archived here because
// `fetchMississippiSosBatch` does not archive them: the discovery artifact is
// the evidence for the snapshot, so it is the document every row cites.
import {
  discoverMississippiSosSnapshot,
  fetchMississippiSosBatch,
  type MississippiSosAuthorizedTransport,
} from "./nationwide-ms-sos-arcgis.ts";
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import type { normalizeMississippiSosInventory } from "./nationwide-ms-sos-normalize.ts";

const DEFAULT_BATCH_SIZE = 1_000;
const MAX_BATCH_SIZE = 5_000;

type NormalizeInput = Parameters<typeof normalizeMississippiSosInventory>[0];

export type MississippiSosLiveFetchOptions = {
  // No defaults for either: both are real, credential-bearing or
  // storage-bearing dependencies the caller owns.
  transport: MississippiSosAuthorizedTransport;
  artifactStore: ImmutableJsonArtifactStore;
  // The single registered county this run writes under. See the header.
  jurisdiction: NormalizeInput["jurisdiction"];
  batchSize?: number;
  // Defaults to the moment the returned function is invoked, never to a
  // timestamp captured when this factory ran.
  scheduledFor?: string;
  attempt?: number;
};

export type MississippiSosFetchRows = () => Promise<{
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

function boundedAttempt(value: number | undefined) {
  const attempt = value ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new Error("attempt must be an integer between 1 and 100");
  }
  return attempt;
}

function countyOf(feature: NormalizeInput["feature"]) {
  const published = feature.county;
  return typeof published === "string" ? published.trim().toLowerCase() : "";
}

export function createMississippiSosLiveFetchRows(
  options: MississippiSosLiveFetchOptions,
): MississippiSosFetchRows {
  if (!options.transport || typeof options.transport.beginConsistentSnapshot !== "function") {
    throw new Error("createMississippiSosLiveFetchRows requires an injected authorized transport");
  }
  if (!options.artifactStore || typeof options.artifactStore.putCanonicalJson !== "function") {
    throw new Error("createMississippiSosLiveFetchRows requires an injected artifactStore");
  }
  const jurisdiction = options.jurisdiction;
  if (!jurisdiction || jurisdiction.stateCode !== "MS") {
    throw new Error("createMississippiSosLiveFetchRows requires a Mississippi jurisdiction");
  }
  const transport = options.transport;
  const artifactStore = options.artifactStore;
  const batchSize = boundedBatchSize(options.batchSize);
  const attempt = boundedAttempt(options.attempt);

  return async function fetchMississippiSosRowsLive() {
    const scheduledFor = options.scheduledFor ?? new Date().toISOString();
    const discovery = await discoverMississippiSosSnapshot({
      transport,
      artifactStore,
      artifactPrefix: "nationwide/mississippi/sos/active-tax-forfeited-inventory",
      scheduledFor,
      attempt,
      batchSize,
    });

    const document = {
      url: discovery.snapshot.publicLayerUrl,
      title: "Mississippi Secretary of State active tax-forfeited inventory (ArcGIS)",
      sha256: discovery.artifact.sha256,
      retrievedAt: discovery.snapshot.observedAt,
      publishedAt: discovery.snapshot.publishedAt,
      objectStorageKey: discovery.artifact.objectStorageKey,
      mimeType: discovery.artifact.mimeType,
      byteSize: discovery.artifact.byteSize,
    };

    const registeredCounty = jurisdiction.countyName.trim().toLowerCase();
    const rows: NormalizeInput[] = [];
    let batchNumber = 1;
    for (let start = 0; start < discovery.expectedIds.length; start += batchSize) {
      const requestedIds = discovery.expectedIds.slice(start, start + batchSize);
      const batch = await fetchMississippiSosBatch({
        transport,
        handle: discovery.snapshot.handle,
        objectIdField: discovery.objectIdField,
        requestedIds,
        batchNumber,
      });
      // A "partial" batch means the authorized service returned fewer lots
      // than the snapshot promised. Accepting it would publish a short
      // inventory as if it were the whole one, and the run's completeness
      // reconciliation downstream would have nothing to catch it against.
      if (batch.status !== "succeeded") {
        throw new Error(
          "Mississippi SOS snapshot batch returned a partial result; the snapshot is incomplete",
        );
      }
      for (const feature of batch.features) {
        if (countyOf(feature) !== registeredCounty) continue;
        rows.push({ jurisdiction, document, feature });
      }
      batchNumber += 1;
    }

    return {
      rows,
      sourceObjectIds: discovery.expectedIds.map((objectId) => String(objectId)),
      reportedCount: discovery.reportedCount,
    };
  };
}
