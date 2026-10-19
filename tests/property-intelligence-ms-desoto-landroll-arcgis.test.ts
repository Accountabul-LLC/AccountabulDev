// Slice 3 of the nationwide multi-state ingestion port. Behavioral contract
// ported from the source's tests/mississippi-desoto-landroll-arcgis.test.mjs,
// focused on the geometry-part grouping (`groupStableFeatures`) and feature
// normalization this slice ports.
import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverMississippiDesotoLandrollObjectIds,
  fetchMississippiDesotoLandrollBatch,
  groupStableFeatures,
  MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL,
  normalizeMississippiDesotoLandrollFeature,
  type MississippiDesotoLandrollAggregate,
} from "../src/lib/property-intelligence/nationwide-ms-desoto-landroll-arcgis.ts";
import type { MississippiDesotoLandrollFeature } from "../src/lib/property-intelligence/nationwide-property-record-intake.ts";

const requiredFields = [
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
];

function baseFeature(
  objectid: number,
  overrides: Partial<MississippiDesotoLandrollFeature> = {},
): MississippiDesotoLandrollFeature {
  return {
    objectid,
    pin: "0123456789012",
    pin_1: "0123456789012",
    desc_: "PT SEC 12",
    multipart: "Y",
    acreage: 1.2,
    lrstid: "STATE123",
    lrname: "SMITH JOHN",
    lincof: null,
    lrmadd: "100 OWNER LN",
    lrcity: "HERNANDO",
    lrstat: "MS",
    lrzip: "38632",
    lrsect: "12",
    lrtwn: "1S",
    lrrnge: "8W",
    lrtot: 10_000,
    lrstot: 8_000,
    lrtacr: 1.2,
    lrddbk: "100",
    lrddpg: "200",
    sbname: null,
    lrlot: null,
    lrexmt: null,
    lrdist: "01",
    physical_address: "123 MAIN ST",
    ...overrides,
  };
}

function artifactStore() {
  const writes: unknown[] = [];
  return {
    writes,
    async putCanonicalJson(input: unknown) {
      writes.push(input);
    },
  };
}

function fixtureFetch(
  options: {
    objectIds?: number[];
    driftMembership?: boolean;
    featuresByGroup?: MississippiDesotoLandrollFeature[];
  } = {},
): typeof fetch {
  let discoveryRead = 0;
  return (async (request: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(request as string);
    const parameters =
      init.method === "POST" ? new URLSearchParams(init.body as string) : url.searchParams;
    if (!url.pathname.endsWith("/query")) {
      return new Response(
        JSON.stringify({
          type: "Feature Layer",
          maxRecordCount: 2_000,
          fields: requiredFields.map((name) => ({ name, type: "esriFieldTypeString" })),
        }),
      );
    }
    if (parameters.get("returnIdsOnly") === "true") {
      discoveryRead += 1;
      const objectIds =
        options.driftMembership && discoveryRead === 2 ? [1, 2, 3] : (options.objectIds ?? [1, 2]);
      return new Response(JSON.stringify({ objectIdFieldName: "OBJECTID", objectIds }));
    }
    const requested = (parameters.get("objectIds") ?? "").split(",").filter(Boolean).map(Number);
    const byId = new Map(
      (options.featuresByGroup ?? []).map((feature) => [Number(feature.objectid), feature]),
    );
    return new Response(
      JSON.stringify({
        exceededTransferLimit: false,
        features: requested.map((id) => ({ attributes: byId.get(id) ?? { objectid: id } })),
      }),
    );
  }) as typeof fetch;
}

test("groupStableFeatures joins two geometry parts of the same parcel into one aggregate with no conflicts", () => {
  const partOne = baseFeature(1);
  const partTwo = baseFeature(2, { desc_: "PT SEC 12 PART 2" });
  const groups = groupStableFeatures([partOne, partTwo]);
  assert.equal(groups.size, 1);
  const aggregate = groups.get("parcel:0123456789012") as MississippiDesotoLandrollAggregate;
  assert.deepEqual(aggregate.partObjectIds, [1, 2]);
  assert.equal(aggregate.sourceFeatureCount, 2);
  assert.deepEqual(aggregate.conflictFields, []);
  assert.equal(aggregate.geometryDescriptionVaries, true);
});

test("groupStableFeatures records a conflict when the geometry PIN does not equal the joined land-roll PIN", () => {
  const partOne = baseFeature(1);
  const partTwo = baseFeature(2, { pin: "9999999999999" });
  const groups = groupStableFeatures([partOne, partTwo]);
  const aggregate = groups.get("parcel:0123456789012") as MississippiDesotoLandrollAggregate;
  assert.ok(aggregate.conflictFields.includes("pin_join"));
});

test("groupStableFeatures records a conflict when land-roll invariant fields disagree across parts", () => {
  const partOne = baseFeature(1);
  const partTwo = baseFeature(2, { lrname: "DIFFERENT OWNER" });
  const groups = groupStableFeatures([partOne, partTwo]);
  const aggregate = groups.get("parcel:0123456789012") as MississippiDesotoLandrollAggregate;
  assert.ok(aggregate.conflictFields.includes("lrname"));
});

test("groupStableFeatures groups a feature with no land-roll PIN under an unidentified key with a pin_1 conflict", () => {
  const orphan = baseFeature(9, { pin_1: null });
  const groups = groupStableFeatures([orphan]);
  const aggregate = groups.get("unidentified:9") as MississippiDesotoLandrollAggregate;
  assert.deepEqual(aggregate.conflictFields, ["pin_1"]);
});

test("discovery reads object-ID membership twice and fails closed on drift", async () => {
  const store = artifactStore();
  const discovery = await discoverMississippiDesotoLandrollObjectIds({
    fetchImpl: fixtureFetch(),
    artifactStore: store,
    runPrefix: "test",
    retrievedAt: "2026-08-20T16:00:01.000Z",
    batchSize: 100,
  });
  assert.deepEqual(discovery.expectedIds, [1, 2]);
  assert.equal(store.writes.length, 1);

  await assert.rejects(
    discoverMississippiDesotoLandrollObjectIds({
      fetchImpl: fixtureFetch({ driftMembership: true }),
      artifactStore: artifactStore(),
      runPrefix: "test",
      retrievedAt: "2026-08-20T16:00:01.000Z",
      batchSize: 100,
    }),
    /membership changed/i,
  );
});

test("fetchMississippiDesotoLandrollBatch returns the two geometry-part features and archives the batch", async () => {
  const store = artifactStore();
  const partOne = baseFeature(1);
  const partTwo = baseFeature(2, { desc_: "PT SEC 12 PART 2" });
  const batch = await fetchMississippiDesotoLandrollBatch({
    fetchImpl: fixtureFetch({ featuresByGroup: [partOne, partTwo] }),
    artifactStore: store,
    runPrefix: "test",
    batchNumber: 1,
    requestedIds: [1, 2],
    queryFields: requiredFields,
  });
  assert.equal(batch.features.length, 2);
  assert.equal(store.writes.length, 1);
  const grouped = groupStableFeatures(batch.features);
  assert.equal(grouped.size, 1);
});

test("normalizeMississippiDesotoLandrollFeature accepts a joined, conflict-free aggregate and rejects a conflicting one", async () => {
  const partOne = baseFeature(1);
  const partTwo = baseFeature(2, { desc_: "PT SEC 12 PART 2" });
  const [aggregate] = [...groupStableFeatures([partOne, partTwo]).values()];
  const document = {
    url: MISSISSIPPI_DESOTO_LANDROLL_LAYER_URL,
    title: "DeSoto County land-roll snapshot fixture",
    sha256: "e".repeat(64),
    retrievedAt: "2026-08-20T16:00:01.000Z",
    publishedAt: null,
  };
  const bundle = await normalizeMississippiDesotoLandrollFeature({
    document,
    aggregate: aggregate as MississippiDesotoLandrollAggregate,
  });
  assert.equal(bundle.listing.recordKind, "assessor_property");
  assert.equal(bundle.propertyCandidate.identifiers[0]?.isAuthoritative, true);
  assert.equal(
    bundle.propertyCandidate.addresses.some(
      (address) => address.role === "owner_mailing" && address.rawAddress === "100 OWNER LN",
    ),
    true,
  );

  const conflicting = {
    ...(aggregate as MississippiDesotoLandrollAggregate),
    conflictFields: ["pin_join"],
  };
  await assert.rejects(
    normalizeMississippiDesotoLandrollFeature({ document, aggregate: conflicting }),
    /missing, mismatched, or conflicting/i,
  );
});
