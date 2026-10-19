// Slice 3 of the nationwide multi-state ingestion port. Behavioral contract
// ported from the source's tests/st-louis-official-lra-arcgis.test.mjs,
// focused on the discovery/batch-fetch shell (reviewed-origin restriction,
// membership-drift fail-closed, duplicate-feature collapse via normalization)
// and feature normalization this slice ports.
import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverStLouisOfficialLraObjectIds,
  fetchStLouisOfficialLraBatch,
  normalizeStLouisOfficialLraFeature,
  ST_LOUIS_OFFICIAL_LRA_LAYER_URL,
} from "../src/lib/property-intelligence/nationwide-st-louis-lra-arcgis.ts";

const requiredFields = [
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
];

const features = new Map<string, Record<string, unknown>>([
  [
    "1",
    {
      OBJECTID: 1,
      ParcelId: "10010000010",
      ADDRESS: "100 TEST AV",
      Status: "Available",
      Usage: "Residential",
      Class: "Improved",
      LegalDescription: "CITY BLOCK 100 LOT 1",
      PropertyType: "Building",
      WARD: 3,
      NEIGHBORHOOD_NUM: 16,
      ZipCode: 63118,
      SQFT: 5_000,
      Frontage: 40,
      NbrOfUnits: 2,
      LRA_PRICING: 12_500,
      AssessorsTotal: 8_000,
      Featured: "Yes",
      PublicNotice: "Fixture public notice",
      Environmental: "No known environmental finding",
      Irregular_Lot: "No",
      BuriedMaterials: "No",
      SideLotEligible: "No",
      Description: "Improved residential building",
    },
  ],
]);

function artifactStore() {
  const writes: unknown[] = [];
  return {
    writes,
    async putCanonicalJson(input: unknown) {
      writes.push(input);
    },
  };
}

function cityFetch(
  options: { driftMembership?: boolean; onRequest?: () => void } = {},
): typeof fetch {
  let discoveryRead = 0;
  return (async (request: RequestInfo | URL, init: RequestInit = {}) => {
    options.onRequest?.();
    const url = new URL(request as string);
    const parameters =
      init.method === "POST" ? new URLSearchParams(init.body as string) : url.searchParams;
    if (!url.pathname.endsWith("/query")) {
      return new Response(
        JSON.stringify({
          name: "LRA_Real_Estate",
          type: "Feature Layer",
          maxRecordCount: 2_000,
          fields: requiredFields.map((name) => ({
            name,
            type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString",
          })),
        }),
      );
    }
    if (parameters.get("returnIdsOnly") === "true") {
      discoveryRead += 1;
      const objectIds = options.driftMembership && discoveryRead === 2 ? [1, 2] : [1];
      return new Response(JSON.stringify({ objectIdFieldName: "OBJECTID", objectIds }));
    }
    const requested = (parameters.get("objectIds") ?? "").split(",").filter(Boolean);
    const outFields = (parameters.get("outFields") ?? "").split(",").filter(Boolean);
    return new Response(
      JSON.stringify({
        objectIdFieldName: "OBJECTID",
        exceededTransferLimit: false,
        features: requested.map((id) => ({
          attributes: Object.fromEntries(
            outFields.map((field) => [field, features.get(id)?.[field] ?? null]),
          ),
        })),
      }),
    );
  }) as typeof fetch;
}

test("every retrieval this adapter issues targets only the reviewed city ArcGIS layer URL", async () => {
  const requestedUrls: string[] = [];
  const recordingFetch = (async (request: RequestInfo | URL, init: RequestInit = {}) => {
    requestedUrls.push(new URL(request as string).toString());
    return cityFetch()(request, init);
  }) as typeof fetch;
  await discoverStLouisOfficialLraObjectIds({
    fetchImpl: recordingFetch,
    artifactStore: artifactStore(),
    runPrefix: "test",
    retrievedAt: "2026-08-20T16:00:01.000Z",
    batchSize: 100,
  });
  assert.ok(requestedUrls.every((url) => url.startsWith(ST_LOUIS_OFFICIAL_LRA_LAYER_URL)));
});

test("discovery reads object-ID membership twice and archives discovery evidence", async () => {
  const store = artifactStore();
  const discovery = await discoverStLouisOfficialLraObjectIds({
    fetchImpl: cityFetch(),
    artifactStore: store,
    runPrefix: "nationwide/missouri/st-louis/lra-official/run-1",
    retrievedAt: "2026-08-20T16:00:01.000Z",
    batchSize: 100,
  });
  assert.deepEqual(discovery.expectedIds, ["1"]);
  assert.equal(discovery.reportedCount, 1);
  assert.equal(store.writes.length, 1);
  assert.equal(
    discovery.artifact.objectStorageKey,
    "nationwide/missouri/st-louis/lra-official/run-1/discovery.json",
  );
});

test("membership drift between the two stabilization reads fails before archival", async () => {
  const store = artifactStore();
  await assert.rejects(
    discoverStLouisOfficialLraObjectIds({
      fetchImpl: cityFetch({ driftMembership: true }),
      artifactStore: store,
      runPrefix: "test",
      retrievedAt: "2026-08-20T16:00:01.000Z",
      batchSize: 100,
    }),
    /membership changed/i,
  );
  assert.equal(store.writes.length, 0);
});

test("fetchStLouisOfficialLraBatch archives the raw feature response and returns parsed attributes", async () => {
  const store = artifactStore();
  const discovery = await discoverStLouisOfficialLraObjectIds({
    fetchImpl: cityFetch(),
    artifactStore: store,
    runPrefix: "test",
    retrievedAt: "2026-08-20T16:00:01.000Z",
    batchSize: 100,
  });
  const batch = await fetchStLouisOfficialLraBatch({
    fetchImpl: cityFetch(),
    artifactStore: store,
    runPrefix: "test",
    batchNumber: 1,
    requestedIds: discovery.expectedIds,
    queryFields: discovery.queryFields,
  });
  assert.equal(batch.features.length, 1);
  assert.equal(batch.features[0]?.ParcelId, "10010000010");
  assert.equal(store.writes.length, 2);
});

test("normalizeStLouisOfficialLraFeature produces a resolvable land-bank listing with a published asking price", async () => {
  const bundle = await normalizeStLouisOfficialLraFeature({
    document: {
      url: ST_LOUIS_OFFICIAL_LRA_LAYER_URL,
      title: "City of St. Louis official LRA ArcGIS inventory snapshot",
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-20T16:00:01.000Z",
      publishedAt: null,
    },
    feature: features.get("1") as Record<string, unknown>,
  });
  assert.equal(bundle.listing.recordKind, "land_bank_inventory_item");
  assert.equal(bundle.listing.lifecycleState, "available");
  assert.equal(bundle.listing.publishedAmount, 12_500);
  assert.equal(bundle.listing.publishedAmountType, "asking_price");
  assert.equal(bundle.propertyCandidate.identifiers[0]?.isAuthoritative, true);
  assert.equal(bundle.propertyCandidate.identifiers[0]?.rawValue, "10010000010");
});

test("normalizeStLouisOfficialLraFeature rejects a feature with no OBJECTID", async () => {
  await assert.rejects(
    normalizeStLouisOfficialLraFeature({
      document: {
        url: ST_LOUIS_OFFICIAL_LRA_LAYER_URL,
        title: "fixture",
        sha256: "d".repeat(64),
        retrievedAt: "2026-08-20T16:00:01.000Z",
      },
      feature: { ...(features.get("1") as Record<string, unknown>), OBJECTID: null },
    }),
    /positive/i,
  );
});
