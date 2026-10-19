// Slice 1 of the nationwide geography catalog port
// (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Ported assertions from the
// source app's tests/us-state-catalog.test.mjs and
// tests/us-county-catalog.test.mjs, minus the source-manifest test (this
// repo has no nationwide-source-catalog.ts / nationwide-source-manifest.ts
// -- that is source-adapter scope for a later slice) and minus the
// live-Census-archive audit test (requires network access this repo's test
// environments do not have; the source itself gates that test behind
// RUN_LIVE_CENSUS_CATALOG_AUDIT=1 for the same reason).
import assert from "node:assert/strict";
import test from "node:test";

import {
  getUsStateCatalogEntry,
  US_STATE_AND_DISTRICT_FIPS,
  US_STATE_CATALOG,
} from "../src/lib/property-intelligence/us-state-catalog.ts";
import {
  CENSUS_COUNTY_CATALOG,
  CENSUS_COUNTY_CATALOG_METADATA,
  getCensusCountyCatalogEntry,
  getCensusCountyCatalogForState,
} from "../src/lib/property-intelligence/us-county-catalog.ts";

test("the federal geography contract covers all 50 states plus the District of Columbia exactly once", () => {
  assert.equal(US_STATE_CATALOG.length, 51);
  assert.equal(US_STATE_CATALOG.filter((entry) => !entry.isDistrict).length, 50);
  assert.equal(new Set(US_STATE_CATALOG.map((entry) => entry.stateCode)).size, 51);
  assert.equal(new Set(US_STATE_CATALOG.map((entry) => entry.stateFips)).size, 51);
  assert.deepEqual(US_STATE_AND_DISTRICT_FIPS[0], ["AL", "01", "Alabama"]);
  assert.deepEqual(US_STATE_AND_DISTRICT_FIPS.at(-1), ["WY", "56", "Wyoming"]);
  assert.deepEqual(getUsStateCatalogEntry("MS", "28"), {
    stateCode: "MS",
    stateFips: "28",
    stateName: "Mississippi",
    isDistrict: false,
  });
});

test("a mismatched state code / FIPS pair is rejected", () => {
  assert.throws(() => getUsStateCatalogEntry("MS", "29"), /does not match Census state FIPS/i);
  assert.throws(() => getUsStateCatalogEntry("ZZ", "01"), /does not match Census state FIPS/i);
});

const expectedStateCounts: Record<string, number> = {
  AK: 30,
  AL: 67,
  AR: 75,
  AZ: 15,
  CA: 58,
  CO: 64,
  CT: 9,
  DC: 1,
  DE: 3,
  FL: 67,
  GA: 159,
  HI: 5,
  IA: 99,
  ID: 44,
  IL: 102,
  IN: 92,
  KS: 105,
  KY: 120,
  LA: 64,
  MA: 14,
  MD: 24,
  ME: 16,
  MI: 83,
  MN: 87,
  MO: 115,
  MS: 82,
  MT: 56,
  NC: 100,
  ND: 53,
  NE: 93,
  NH: 10,
  NJ: 21,
  NM: 33,
  NV: 17,
  NY: 62,
  OH: 88,
  OK: 77,
  OR: 36,
  PA: 67,
  RI: 5,
  SC: 46,
  SD: 66,
  TN: 95,
  TX: 254,
  UT: 29,
  VA: 133,
  VT: 14,
  WA: 39,
  WI: 72,
  WV: 55,
  WY: 23,
};

test("the Census baseline contains every county equivalent in all 50 states plus D.C., with no duplicates", () => {
  assert.equal(CENSUS_COUNTY_CATALOG_METADATA.vintage, 2025);
  assert.equal(CENSUS_COUNTY_CATALOG_METADATA.scope, "fifty_states_and_district_of_columbia");
  assert.deepEqual(
    CENSUS_COUNTY_CATALOG_METADATA.coveredStateCodes,
    US_STATE_CATALOG.map((state) => state.stateCode),
  );
  assert.match(CENSUS_COUNTY_CATALOG_METADATA.sourceArchiveSha256, /^[0-9a-f]{64}$/);
  assert.match(CENSUS_COUNTY_CATALOG_METADATA.sourceEntrySha256, /^[0-9a-f]{64}$/);
  assert.equal(CENSUS_COUNTY_CATALOG_METADATA.sourceRowCount, 3_222);
  assert.equal(CENSUS_COUNTY_CATALOG_METADATA.includedRowCount, 3_144);
  assert.deepEqual(CENSUS_COUNTY_CATALOG_METADATA.excludedRows, [
    { stateCode: "PR", rowCount: 78, reason: "territory_not_in_v1_state_catalog" },
  ]);
  assert.equal(CENSUS_COUNTY_CATALOG.length, 3_144);
  assert.equal(new Set(CENSUS_COUNTY_CATALOG.map((county) => county.countyFips)).size, 3_144);
  assert.equal(new Set(CENSUS_COUNTY_CATALOG.map((county) => county.ansiCode)).size, 3_144);
  assert.deepEqual(
    Object.fromEntries(
      US_STATE_CATALOG.map((state) => [
        state.stateCode,
        getCensusCountyCatalogForState(state.stateCode).length,
      ]),
    ),
    expectedStateCounts,
  );
  assert.deepEqual(
    CENSUS_COUNTY_CATALOG.map((county) => county.countyFips),
    [...CENSUS_COUNTY_CATALOG].map((county) => county.countyFips).sort(),
  );
  assert.equal(getCensusCountyCatalogForState("PR").length, 0);
  assert.throws(() => getCensusCountyCatalogEntry("72001"), /not loaded/i);
});

test("county-equivalent legal types and display names remain explicit", () => {
  assert.deepEqual(getCensusCountyCatalogEntry("01001"), {
    stateCode: "AL",
    stateFips: "01",
    countyFips: "01001",
    countyName: "Autauga",
    countyLegalName: "Autauga County",
    countyEquivalentType: "county",
    ansiCode: "00161526",
    gazetteerVintage: 2025,
  });
  assert.deepEqual(
    {
      borough: getCensusCountyCatalogEntry("02013").countyEquivalentType,
      censusArea: getCensusCountyCatalogEntry("02016").countyEquivalentType,
      cityAndBorough: getCensusCountyCatalogEntry("02110").countyEquivalentType,
      municipality: getCensusCountyCatalogEntry("02020").countyEquivalentType,
      planningRegion: getCensusCountyCatalogEntry("09110").countyEquivalentType,
      district: getCensusCountyCatalogEntry("11001").countyEquivalentType,
      parish: getCensusCountyCatalogEntry("22071").countyEquivalentType,
      independentCity: getCensusCountyCatalogEntry("29510").countyEquivalentType,
    },
    {
      borough: "borough",
      censusArea: "census_area",
      cityAndBorough: "city_and_borough",
      municipality: "municipality",
      planningRegion: "planning_region",
      district: "district",
      parish: "parish",
      independentCity: "independent_city",
    },
  );
  // St. Louis, Missouri, and DeSoto/Rankin, Mississippi are the source
  // adapters' named target jurisdictions for the next slice -- confirming
  // their geography identity is correct here is load-bearing for that work.
  assert.equal(getCensusCountyCatalogEntry("28033").countyName, "DeSoto");
  assert.equal(getCensusCountyCatalogEntry("28149").countyName, "Warren");
  assert.equal(getCensusCountyCatalogEntry("28121").countyName, "Rankin");
  assert.equal(getCensusCountyCatalogEntry("29510").countyName, "St. Louis City");
  assert.equal(getCensusCountyCatalogEntry("29510").countyLegalName, "St. Louis city");
});
