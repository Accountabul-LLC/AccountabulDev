import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleMapsUrl } from "../src/lib/property-intelligence/google-maps.ts";

test("Google Maps searches the exact tax-sale address in St. Louis", () => {
  const url = buildGoogleMapsUrl({ address: "4736 ST LOUIS AV", zipCode: null });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.google.com");
  assert.equal(parsed.pathname, "/maps/search/");
  assert.equal(parsed.searchParams.get("api"), "1");
  assert.equal(parsed.searchParams.get("query"), "4736 ST LOUIS AV, St. Louis, MO");
});

test("Google Maps includes the city-owned property ZIP code when published", () => {
  const url = buildGoogleMapsUrl({ address: "1520 MARKET ST", zipCode: "63103" });

  assert.ok(url);
  assert.equal(new URL(url).searchParams.get("query"), "1520 MARKET ST, St. Louis, MO 63103");
});

test("Google Maps is not offered for a missing property address", () => {
  assert.equal(buildGoogleMapsUrl({ address: "  ", zipCode: null }), null);
  assert.equal(buildGoogleMapsUrl({ address: "Address not published", zipCode: "63101" }), null);
});
