import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeParcelResult,
  parcelSearchWhere,
} from "../src/lib/property-intelligence/parcel-search.ts";
import { isStale } from "../src/lib/property-intelligence/workspace.server.ts";

test("parcelSearchWhere accepts an 11-digit parcel ID as an exact match", () => {
  assert.equal(parcelSearchWhere("12345678901"), "ParcelId='12345678901'");
});

test("parcelSearchWhere tokenizes a street address and normalizes directionals", () => {
  const where = parcelSearchWhere("5253 North Maffitt Ave, St. Louis, MO 63113");
  assert.match(where, /UPPER\(SITEADDR\) LIKE '%5253%'/);
  assert.match(where, /UPPER\(SITEADDR\) LIKE '%N%'/);
  assert.match(where, /UPPER\(SITEADDR\) LIKE '%MAFFITT%'/);
  // The street suffix (AVE) is dropped; only house number + street name remain.
  assert.doesNotMatch(where, /LIKE '%AVE%'/);
});

test("parcelSearchWhere drops unit markers and everything after them", () => {
  const where = parcelSearchWhere("100 Main St Apt 4B");
  assert.doesNotMatch(where, /APT/);
  assert.doesNotMatch(where, /4B/);
});

test("parcelSearchWhere rejects input with no house number", () => {
  assert.throws(() => parcelSearchWhere("Maffitt Avenue"), /house number/);
});

test("normalizeParcelResult requires a valid 11-digit parcel id and an address", () => {
  assert.equal(normalizeParcelResult({ ParcelId: "123", SITEADDR: "1 MAIN ST" }), null);
  assert.equal(normalizeParcelResult({ ParcelId: "12345678901", SITEADDR: "" }), null);
  const result = normalizeParcelResult({
    ParcelId: "12345678901",
    SITEADDR: "1 MAIN ST",
    OWNERNAME: "JANE DOE",
    AsdTotal: 125000,
    IsAbatedProperty: 1,
  });
  assert.equal(result?.parcelId, "12345678901");
  assert.equal(result?.ownerName, "JANE DOE");
  assert.equal(result?.assessedTotalValue, 125000);
  assert.equal(result?.isTaxAbated, true);
});

test("normalizeParcelResult joins non-empty legal description lines only", () => {
  const result = normalizeParcelResult({
    ParcelId: "12345678901",
    SITEADDR: "1 MAIN ST",
    LegalDesc1: "LOT 5",
    LegalDesc2: "",
    LegalDesc3: "BLK 2",
  });
  assert.equal(result?.legalDescription, "LOT 5 BLK 2");
});

test("isStale treats a missing sync timestamp as stale and a fresh one as not", () => {
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  assert.equal(isStale(null, now), true);
  assert.equal(isStale("2026-09-23T05:00:00.000Z", now), true); // 7h old
  assert.equal(isStale("2026-09-23T11:00:00.000Z", now), false); // 1h old
});
