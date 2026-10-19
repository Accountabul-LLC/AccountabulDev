// Slice 3 of the nationwide multi-state ingestion port. Behavioral contract
// ported from the source's tests/mississippi-sos-arcgis.test.mjs, focused on
// the injected `MississippiSosAuthorizedTransport` discovery/batch shell
// (no default implementation anywhere in this repo) and feature
// normalization this slice ports.
import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverMississippiSosSnapshot,
  fetchMississippiSosBatch,
  normalizeMississippiSosFeature,
  type MississippiSosAuthorizedTransport,
} from "../src/lib/property-intelligence/nationwide-ms-sos-arcgis.ts";

const sosInventoryDocument = {
  url: "https://gisserver.its.ms.gov/arcgis/rest/services/Hosted/Active_Tax_Forfeited_Properties/FeatureServer/0",
  title: "Mississippi SOS Active Tax Forfeited Properties API snapshot fixture",
  sha256: "f".repeat(64),
  retrievedAt: "2026-08-19T18:30:00.000Z",
};

const warrenJurisdiction = { stateCode: "MS", countyName: "Warren", countyFips: "28149" };

const sosActiveInventoryFeature = {
  objectid: 1,
  parcel_id: 754835,
  sosparid: 890086,
  parcel_number: "0943-19-0850-014600",
  sosparno: "0943190850014600",
  ppin_number: "17899",
  sosppin: "17899",
  county: "Warren",
  parcel_status_description: "Active",
  legal_description: "LOTS: 14 FOLKES OLD GARDEN PLAT BOOK 1-58 PAGE 125",
  certificate_number: "M454",
  sale_date: 1_188_172_800_000,
  certificatetaxyear: 2006,
  assessedownercompany: "% Larry D Fisher",
  market_value: 6_250,
  propertyaddress: "1719 South St. (Lot) Vicksburg MS 39180",
  city: "Vicksburg",
  state_abbreviation: "MS",
  zip: "39180",
  acres: 0.15746175,
  square_feet: 6_859.18509745,
  sumoftaxfees: 460.08,
  blighted: "0",
  tidelands: "0",
  soscontactname: "Renita Wright",
  link: "www.sos.ms.gov/tfsearch/default.aspx?parcel_id=754835",
};

function artifactStore() {
  const writes: unknown[] = [];
  return {
    writes,
    async putCanonicalJson(input: unknown) {
      writes.push(input);
    },
  };
}

function fakeTransport(
  options: { objectIds?: Array<string | number> } = {},
): MississippiSosAuthorizedTransport {
  return {
    async beginConsistentSnapshot() {
      return {
        handle: "snapshot-1",
        publicLayerUrl: sosInventoryDocument.url,
        layerName: "Active_Tax_Forfeited_Properties",
        objectIdField: "objectid",
        fields: ["objectid", "parcel_id", "county"],
        maxRecordCount: 2_000,
        reportedCount: (options.objectIds ?? [1]).length,
        objectIds: options.objectIds ?? [1],
        consistencyEvidence: "fixture-consistency-token",
        observedAt: "2026-08-19T18:30:00.000Z",
        publishedAt: null,
      };
    },
    async readSnapshotBatch({ requestedIds }) {
      return {
        status: "succeeded",
        features: requestedIds.map((id) => ({
          attributes: { ...sosActiveInventoryFeature, objectid: Number(id) },
        })),
        error: null,
      };
    },
  };
}

test("discovery archives the snapshot evidence and requires the objectIdField, parcel_id, and county fields", async () => {
  const store = artifactStore();
  const discovery = await discoverMississippiSosSnapshot({
    transport: fakeTransport(),
    artifactStore: store,
    artifactPrefix: "nationwide/mississippi/sos-active-inventory",
    scheduledFor: "2026-08-19T18:00:00.000Z",
    attempt: 1,
    batchSize: 100,
  });
  assert.equal(discovery.expectedIds.length, 1);
  assert.equal(store.writes.length, 1);

  const missingField: MississippiSosAuthorizedTransport = {
    ...fakeTransport(),
    async beginConsistentSnapshot() {
      const snapshot = await fakeTransport().beginConsistentSnapshot({
        scheduledFor: "x",
        attempt: 1,
      });
      return { ...snapshot, fields: ["objectid"] };
    },
  };
  await assert.rejects(
    discoverMississippiSosSnapshot({
      transport: missingField,
      artifactStore: artifactStore(),
      artifactPrefix: "test",
      scheduledFor: "2026-08-19T18:00:00.000Z",
      attempt: 1,
      batchSize: 100,
    }),
    /missing required ArcGIS field/i,
  );
});

test("fetchMississippiSosBatch surfaces a failed batch as a rejected promise", async () => {
  const failingTransport: MississippiSosAuthorizedTransport = {
    ...fakeTransport(),
    async readSnapshotBatch() {
      return { status: "failed", features: [], error: "upstream service unavailable" };
    },
  };
  await assert.rejects(
    fetchMississippiSosBatch({
      transport: failingTransport,
      handle: "snapshot-1",
      objectIdField: "objectid",
      requestedIds: ["1"],
      batchNumber: 1,
    }),
    /upstream service unavailable/i,
  );
});

test("normalizeMississippiSosFeature preserves company ownership, active lifecycle, and published tax fees", async () => {
  const bundle = await normalizeMississippiSosFeature({
    jurisdiction: warrenJurisdiction,
    document: sosInventoryDocument,
    feature: sosActiveInventoryFeature,
  });
  assert.equal(bundle.auction.status, "active_inventory");
  assert.equal(bundle.auction.lifecycle[0]?.eventType, "available_for_application");
  assert.equal(
    bundle.auction.parties.some(
      (party) => party.role === "assessed_owner" && party.publishedName === "% Larry D Fisher",
    ),
    true,
  );
  assert.equal(bundle.auction.amounts[0]?.amount, 460.08);
  assert.equal(
    bundle.propertyCandidate.observations.some(
      (observation) => observation.factType === "market_value" && observation.value === 6_250,
    ),
    true,
  );
  assert.equal(bundle.propertyCandidate.identifiers.length, 2);
  assert.equal(
    bundle.sourceRecord.sourceUrl,
    "https://www.sos.ms.gov/tfsearch/default.aspx?parcel_id=754835",
  );
});

test("normalizeMississippiSosFeature reflects a struck/removed lifecycle from a published strike date", async () => {
  const bundle = await normalizeMississippiSosFeature({
    jurisdiction: warrenJurisdiction,
    document: sosInventoryDocument,
    feature: {
      ...sosActiveInventoryFeature,
      parcel_status_description: "Removed",
      strike_date: "2027-01-01",
      strike_reason_description: "Redeemed",
    },
  });
  assert.equal(bundle.auction.lifecycle[0]?.eventType, "removed");
  assert.equal(bundle.auction.lifecycle[0]?.publishedStatusText, "Redeemed");
});
