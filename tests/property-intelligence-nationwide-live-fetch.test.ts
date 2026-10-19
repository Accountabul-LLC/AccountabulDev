// Contract for the five nationwide live `fetchRows` implementations that
// follow mo_st_louis_lra_inventory_v1 into live execution.
//
// These modules are wiring, so what the tests pin is the behavior that the
// wiring itself decides and that the underlying source modules cannot check
// for themselves: that nothing reaches the network until the returned
// function is actually called, that every real dependency is injected rather
// than defaulted, and that each source's particular failure mode is treated
// as a failure instead of as an empty run.
import assert from "node:assert/strict";
import test from "node:test";

import { createMississippiDesotoLandrollLiveFetchRows } from "../src/lib/property-intelligence/nationwide-ms-desoto-landroll-live-fetch.server.ts";
import { createMississippiDesotoTaxSaleLiveFetchRows } from "../src/lib/property-intelligence/nationwide-ms-desoto-tax-sale-live-fetch.server.ts";
import { createMississippiRankinLiveFetchRows } from "../src/lib/property-intelligence/nationwide-ms-rankin-live-fetch.server.ts";
import { createMississippiSosLiveFetchRows } from "../src/lib/property-intelligence/nationwide-ms-sos-live-fetch.server.ts";
import { createStLouisSheriffLiveFetchRows } from "../src/lib/property-intelligence/nationwide-st-louis-sheriff-live-fetch.server.ts";

const LANDROLL_FIELDS = [
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

function fakeArtifactStore() {
  const json: string[] = [];
  const bytes: string[] = [];
  return {
    json,
    bytes,
    store: {
      putCanonicalJson: async (input: { objectStorageKey: string }) => {
        json.push(input.objectStorageKey);
      },
      putBytes: async (input: { objectStorageKey: string }) => {
        bytes.push(input.objectStorageKey);
      },
    },
  };
}

function landrollFeature(objectId: number, pin: string) {
  const attributes: Record<string, unknown> = { objectid: objectId, pin, pin_1: pin };
  for (const field of LANDROLL_FIELDS) {
    if (!(field in attributes)) attributes[field] = null;
  }
  return { attributes };
}

// A fake DeSoto land-roll ArcGIS layer. `features` is keyed by objectid, so a
// test can decide which batch each part lands in purely via batchSize.
function fakeLandrollService(features: Map<number, { attributes: Record<string, unknown> }>) {
  const requests: string[] = [];
  const impl = (async (url: URL | string, init: RequestInit) => {
    const target = new URL(String(url));
    requests.push(`${init.method ?? "GET"} ${target.pathname}${target.search}`);
    if (!target.pathname.endsWith("/query")) {
      return Response.json({
        type: "Feature Layer",
        maxRecordCount: 2_000,
        fields: LANDROLL_FIELDS.map((name) => ({ name, type: "esriFieldTypeString" })),
      });
    }
    if (target.searchParams.get("returnIdsOnly") === "true") {
      return Response.json({ objectIdFieldName: "objectid", objectIds: [...features.keys()] });
    }
    const body = new URLSearchParams(String(init.body));
    const requested = (body.get("objectIds") ?? "").split(",").map(Number);
    return Response.json({
      features: requested.map((objectId) => features.get(objectId)).filter(Boolean),
    });
  }) as unknown as typeof fetch;
  return { requests, impl };
}

test("a land-roll parcel whose parts straddle a batch boundary still becomes one aggregate", async () => {
  // Both parts share pin_1, but batchSize 1 puts them in separate batches.
  // Grouping per batch would emit two half-built aggregates for one parcel.
  const service = fakeLandrollService(
    new Map([
      [1, landrollFeature(1, "1234-5678")],
      [2, landrollFeature(2, "1234-5678")],
    ]),
  );
  const artifacts = fakeArtifactStore();
  const fetchRows = createMississippiDesotoLandrollLiveFetchRows({
    artifactStore: artifacts.store,
    fetchImpl: service.impl,
    batchSize: 1,
  });
  const result = await fetchRows();

  assert.equal(result.rows.length, 1, "one parcel, not one row per published part");
  const row = result.rows[0]!;
  assert.deepEqual(row.feature.partObjectIds, [1, 2], "both parts belong to the aggregate");
  assert.equal(row.feature.sourceFeatureCount, 2);
  assert.equal(row.jurisdiction.countyFips, "28033");
  assert.deepEqual(result.sourceObjectIds, ["1", "2"]);
  assert.equal(result.reportedCount, 2);
});

test("an aggregate cites the batch artifact that carried its representative part", async () => {
  const service = fakeLandrollService(
    new Map([
      [1, landrollFeature(1, "aaa")],
      [2, landrollFeature(2, "bbb")],
    ]),
  );
  const artifacts = fakeArtifactStore();
  const fetchRows = createMississippiDesotoLandrollLiveFetchRows({
    artifactStore: artifacts.store,
    fetchImpl: service.impl,
    batchSize: 1,
  });
  const result = await fetchRows();

  assert.equal(result.rows.length, 2);
  const keys = result.rows.map((row) => row.document.objectStorageKey);
  assert.equal(
    new Set(keys).size,
    2,
    "two parcels read in two separate batches must not share one batch's evidence",
  );
  for (const row of result.rows) {
    assert.match(row.document.objectStorageKey, /batch-\d{5}\.json$/);
  }
});

test("the land-roll fetcher reaches the network only once its returned function runs", () => {
  let called = false;
  const impl = (async () => {
    called = true;
    return Response.json({});
  }) as unknown as typeof fetch;
  createMississippiDesotoLandrollLiveFetchRows({
    artifactStore: fakeArtifactStore().store,
    fetchImpl: impl,
  });
  assert.equal(called, false, "building the fetcher must not perform I/O");
});

test("the land-roll fetcher refuses to invent an artifact store or an unbounded batch", () => {
  assert.throws(
    () => createMississippiDesotoLandrollLiveFetchRows({} as never),
    /requires an injected artifactStore/,
  );
  assert.throws(
    () =>
      createMississippiDesotoLandrollLiveFetchRows({
        artifactStore: fakeArtifactStore().store,
        batchSize: 50_000,
      }),
    /batchSize must be an integer/,
  );
});

function sosTransport(
  features: Array<Record<string, unknown>>,
  status: "succeeded" | "partial" = "succeeded",
) {
  return {
    beginConsistentSnapshot: async () => ({
      handle: "snapshot-1",
      publicLayerUrl: "https://gis.example.gov/arcgis/rest/services/inventory/FeatureServer/0",
      layerName: "inventory",
      objectIdField: "objectid",
      fields: ["objectid", "parcel_id", "county"],
      maxRecordCount: 2_000,
      reportedCount: features.length,
      objectIds: features.map((feature) => String(feature["objectid"])),
      consistencyEvidence: "etag-abc",
      observedAt: "2026-09-24T12:00:00.000Z",
      publishedAt: null,
    }),
    readSnapshotBatch: async () => ({
      status,
      features: features.map((attributes) => ({ attributes })),
      error: null,
    }),
  };
}

const RANKIN_JURISDICTION = { stateCode: "MS", countyName: "Rankin", countyFips: "28121" };

test("a partial SOS snapshot batch is a failure, not a short inventory", async () => {
  const fetchRows = createMississippiSosLiveFetchRows({
    transport: sosTransport([{ objectid: 1, parcel_id: "p-1", county: "Rankin" }], "partial"),
    artifactStore: fakeArtifactStore().store,
    jurisdiction: RANKIN_JURISDICTION,
  });
  await assert.rejects(fetchRows(), /partial result; the snapshot is incomplete/);
});

test("SOS lots outside the registered county are left out rather than written under it", async () => {
  const fetchRows = createMississippiSosLiveFetchRows({
    transport: sosTransport([
      { objectid: 1, parcel_id: "p-1", county: "Rankin" },
      { objectid: 2, parcel_id: "p-2", county: "DeSoto" },
      { objectid: 3, parcel_id: "p-3", county: "rankin" },
    ]),
    artifactStore: fakeArtifactStore().store,
    jurisdiction: RANKIN_JURISDICTION,
  });
  const result = await fetchRows();
  assert.equal(result.rows.length, 2, "DeSoto's lot must not be written under Rankin");
  for (const row of result.rows) {
    assert.equal(row.jurisdiction.countyFips, "28121");
  }
  assert.equal(result.reportedCount, 3, "the snapshot's own reported count is unchanged");
});

test("the SOS fetcher requires the authorized transport and a Mississippi jurisdiction", () => {
  assert.throws(
    () =>
      createMississippiSosLiveFetchRows({
        artifactStore: fakeArtifactStore().store,
        jurisdiction: RANKIN_JURISDICTION,
      } as never),
    /requires an injected authorized transport/,
  );
  assert.throws(
    () =>
      createMississippiSosLiveFetchRows({
        transport: sosTransport([]),
        artifactStore: fakeArtifactStore().store,
        jurisdiction: { stateCode: "MO", countyName: "St. Louis City", countyFips: "29510" },
      }),
    /requires a Mississippi jurisdiction/,
  );
});

const SHERIFF_LANDING = `<html><body>
  <h1>Current Land Tax Sale Properties</h1>
  <p>The Land Tax Sale Properties List is posted two weeks prior to the sale.</p>
  ${"<!-- padding -->".repeat(60)}
</body></html>`;

test("a week with no published sale is an empty run, and never fetches a PDF", async () => {
  const requested: string[] = [];
  const impl = (async (url: URL | string) => {
    requested.push(String(url));
    return new Response(SHERIFF_LANDING, { status: 200 });
  }) as unknown as typeof fetch;

  const fetchRows = createStLouisSheriffLiveFetchRows({
    artifactStore: fakeArtifactStore().store,
    extractPages: async () => [],
    fetchImpl: impl,
  });
  const result = await fetchRows();

  assert.deepEqual(result, { rows: [], sourceObjectIds: [], reportedCount: 0 });
  assert.equal(requested.length, 1, "only the landing page is fetched");
  assert.match(requested[0]!, /current-land-tax-sale-properties\.cfm$/);
});

test("a landing page that fails to load is a failure rather than an empty sale", async () => {
  const impl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const fetchRows = createStLouisSheriffLiveFetchRows({
    artifactStore: fakeArtifactStore().store,
    extractPages: async () => [],
    fetchImpl: impl,
  });
  await assert.rejects(fetchRows(), /landing page returned HTTP 500/);
});

test("the Sheriff fetcher requires an injected PDF text extractor", () => {
  assert.throws(
    () => createStLouisSheriffLiveFetchRows({ artifactStore: fakeArtifactStore().store } as never),
    /requires an injected extractPages/,
  );
});

test("a Rankin report URL outside the reviewed county path fails at wiring time", () => {
  assert.throws(
    () =>
      createMississippiRankinLiveFetchRows({
        reportUrl: "https://evil.example.com/egov/documents/1.pdf",
        artifactStore: fakeArtifactStore().store,
        extractPages: async () => [],
      }),
    /outside the reviewed official PDF path/,
  );
  assert.throws(
    () =>
      createMississippiRankinLiveFetchRows({
        reportUrl: "https://www.rankincounty.org/egov/documents/1.pdf?x=1",
        artifactStore: fakeArtifactStore().store,
        extractPages: async () => [],
      }),
    /outside the reviewed official PDF path/,
  );
});

test("an operator-asserted Rankin digest that disagrees with the bytes stops the run", async () => {
  const impl = (async () =>
    new Response(new TextEncoder().encode("%PDF-1.7\nrankin\n") as unknown as BodyInit, {
      status: 200,
    })) as unknown as typeof fetch;
  const fetchRows = createMississippiRankinLiveFetchRows({
    reportUrl: "https://www.rankincounty.org/egov/documents/1786644245_63219.pdf",
    artifactStore: fakeArtifactStore().store,
    extractPages: async () => [],
    fetchImpl: impl,
    expectedSha256: "0".repeat(64),
  });
  await assert.rejects(fetchRows(), /do not match the operator-asserted SHA-256/);
});

test("the DeSoto tax-sale fetcher will not run without a reviewed retrieval contract", () => {
  // This repository carries no host/path contract for the DeSoto tax-sale
  // report, so the guard is the caller's to supply; defaulting one would mean
  // inventing the contract that decides what gets archived as official.
  assert.throws(
    () =>
      createMississippiDesotoTaxSaleLiveFetchRows({
        reportUrl: "https://www.desotocountyms.gov/DocumentCenter/View/1/report.pdf",
        artifactStore: fakeArtifactStore().store,
        extractPages: async () => [],
      } as never),
    /requires a reviewed assertUrl guard/,
  );
});
