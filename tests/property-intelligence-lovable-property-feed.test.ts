// Slice 5 (final) of the nationwide multi-state ingestion port. Covers
// lovable-property-feed.ts, matching property-intelligence-app's
// tests/lovable-property-feed.test.mjs contract ("legacy LRA rows become
// complete Property Records rows"). `fetchImpl` is always injected here --
// this module has no default fetch implementation (see its header) -- and
// no request in this file leaves the process.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getLovablePropertyPayload,
  mapLegacyLraProperty,
  mapLegacyTaxSaleProperty,
} from "../src/lib/property-intelligence/lovable-property-feed.ts";

const config = {
  supabaseUrl: "https://example.supabase.co",
  anonKey: "public-test-key",
};

test("legacy LRA rows become complete searchable Property Records rows", () => {
  const property = mapLegacyLraProperty({
    id: "lra-row-1",
    parcel_id: "00209030000",
    parcel_status: "Available",
    usage: "Side Lot",
    property_source: "LRA",
    address: "10 ASHLEY ST",
    zip: "63147",
    ward: 8,
    neighborhood_number: 79,
    property_type: "Lot",
    side_lot_eligible: true,
    nbr_of_units: "1 Family",
    sqft: 53051,
    frontage: 90,
    updated_at: "2026-08-19T12:01:00.000Z",
  });

  assert.equal(property.id, "lovable-lra:lra-row-1");
  assert.equal(property.parcelId, "00209030000");
  assert.equal(property.address, "10 ASHLEY ST");
  assert.equal(property.city, "St. Louis");
  assert.equal(property.stateCode, "MO");
  assert.equal(property.countyFips, "29510");
  assert.equal(property.price, null);
  assert.equal(property.units, 1);
  assert.equal(property.squareFeet, 53051);
  assert.ok(property.notices.includes("Side-lot eligible"));
});

test("legacy tax-sale rows preserve the sale reference without inventing a parcel ID", () => {
  const property = mapLegacyTaxSaleProperty({
    id: "tax-row-1",
    sale_number: "236",
    land_tax_number: "236-119",
    owner: "SECOND STREET SANDWICHES INC",
    address: "3150 S GRAND BLVD",
    total_amount: "378,379.00",
    zip: "63118",
  });

  assert.equal(property.id, "lovable-tax:236:236-119");
  assert.equal(property.recordNumber, "236-119");
  assert.equal(property.parcelId, null);
  assert.equal(property.price, 378379);
  assert.match(property.notices.join(" "), /not treated as a verified assessor parcel ID/i);
});

test("the legacy feed retrieves every page before reporting rows as loaded", async () => {
  const lraRows = Array.from({ length: 1001 }, (_, index) => ({
    id: `lra-${index + 1}`,
    parcel_id: String(index + 1).padStart(11, "0"),
    parcel_status: "Available",
    address: `${index + 1} TEST ST`,
  }));
  const taxRows = [
    {
      id: "tax-1",
      sale_number: "239",
      land_tax_number: "239-001",
      address: "1 TAX ST",
      total_amount: 1200,
    },
  ];
  const requestedOffsets: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const request = new URL(url);
    const offset = Number(request.searchParams.get("offset"));
    requestedOffsets.push(`${request.pathname}:${offset}`);
    const source = request.pathname.endsWith("lra_properties") ? lraRows : taxRows;
    const rows = source.slice(offset, offset + 1000);
    return new Response(JSON.stringify(rows), {
      status: 206,
      headers: { "content-range": `${offset}-${offset + rows.length - 1}/${source.length}` },
    });
  }) as typeof fetch;

  const payload = await getLovablePropertyPayload(config, fetchImpl);

  assert.equal(payload.properties.length, 1002);
  assert.equal(payload.sources.find((source) => source.key === "LRA")?.loaded, 1001);
  assert.equal(payload.sources.find((source) => source.key === "Tax auction")?.loaded, 1);
  assert.ok(requestedOffsets.includes("/rest/v1/lra_properties:1000"));
  assert.equal(new Set(payload.properties.map((property) => property.id)).size, 1002);
});

test("a truncated legacy page fails instead of claiming complete ingestion", async () => {
  const fetchImpl = (async (url: string | URL) => {
    const request = new URL(url);
    const isLra = request.pathname.endsWith("lra_properties");
    const offset = Number(request.searchParams.get("offset"));
    const total = isLra ? 1001 : 0;
    const rows =
      isLra && offset === 0
        ? Array.from({ length: 1000 }, (_, index) => ({
            id: `lra-${index}`,
            address: `${index} TEST ST`,
          }))
        : [];
    return new Response(JSON.stringify(rows), {
      status: 206,
      headers: {
        "content-range": `${offset}-${Math.max(offset, offset + rows.length - 1)}/${total}`,
      },
    });
  }) as typeof fetch;

  await assert.rejects(
    getLovablePropertyPayload(config, fetchImpl),
    /returned 1000 of 1001 lra_properties rows/,
  );
});
