// Behavioral contract for the pure analysis modules ported from
// property-intelligence-app: arv-analysis, owner-research,
// property-record-summary, property-intake, property-activity-display,
// ingestion-policy and property-intelligence-notice.
//
// The assertions below are ported from the source app's own
// tests/property-analysis.test.mjs, tests/property-records-usability.test.mjs,
// tests/ingestion-policy.test.mjs and tests/property-intelligence-notice.test.mjs,
// keeping the exact expected values. The source's assertions that read
// Next.js component files (app/property-intake.tsx, app/property-explorer.tsx)
// are not ported -- those files do not exist in this repo's TanStack Start
// structure, and the module-level contract is what governs behavior.
import assert from "node:assert/strict";
import test from "node:test";

import { calculateArv, isArvQuestion } from "../src/lib/property-intelligence/arv-analysis.ts";
import {
  buildOwnerResearchQuestion,
  normalizedStreetAddress,
  selectOwnerResearchParcel,
} from "../src/lib/property-intelligence/owner-research.ts";
import { buildPropertyRecordSummary } from "../src/lib/property-intelligence/property-record-summary.ts";
import { normalizePropertyIntakeClaims } from "../src/lib/property-intelligence/property-intake.ts";
import { propertyActivityLabel } from "../src/lib/property-intelligence/property-activity-display.ts";
import {
  INTELLIGENCE_FRESHNESS_MS,
  intelligenceFreshness,
  intelligenceNeedsRefresh,
} from "../src/lib/property-intelligence/ingestion-policy.ts";
import {
  defaultPropertyIntelligenceNoticePreference,
  propertyIntelligenceNoticeReviewNumber,
  REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
} from "../src/lib/property-intelligence/property-intelligence-notice.ts";
import type { PropertyProfile } from "../src/lib/property-intelligence/analysis-types.ts";

const profile: PropertyProfile = {
  lotSquareFeet: null,
  ward: null,
  taxBalance: null,
  priorTaxAmount: null,
  propertyClassCode: null,
  isTaxAbated: null,
  abatementStartYear: null,
  abatementEndYear: null,
  webMercatorX: null,
  webMercatorY: null,
  cityBlock: null,
  parcelNumber: null,
  ownerName: null,
  ownerName2: null,
  legalDescription: null,
  assessorClassCode: null,
  landUseCode: null,
  vacantLot: null,
  numberOfUnits: null,
  numberOfApartments: null,
  frontageFeet: null,
  landArea: null,
  assessedLandValue: null,
  assessedImprovementValue: null,
  assessedTotalValue: null,
  appraisedLandValue: null,
  appraisedImprovementValue: null,
  zoning: null,
  residentialBuildingCount: null,
  commercialBuildingCount: null,
  firstYearBuilt: null,
  lastYearBuilt: null,
  lastResidentialSalePrice: null,
  lastResidentialSaleDate: null,
  vacantBuildingYear: null,
  neighborhoodCode: null,
  zipCode: null,
  ownerOccupied: null,
  assessorHandle: null,
  sourceUrl: "https://example.com",
  observedAt: "2026-08-12T01:00:00.000Z",
};

test("ARV math time-adjusts at least six qualified comps and returns a median range", () => {
  const comps = [100, 110, 120, 130, 140, 150].map((pricePerSquareFoot, index) => ({
    id: `comp:${index}`,
    salePrice: pricePerSquareFoot * 1000,
    finishedSquareFeet: 1000,
    hpiAtSale: 200,
  }));
  const result = calculateArv(1200, 220, comps);
  assert.equal(result.complete, true);
  assert.equal(result.comparableCount, 6);
  assert.equal(result.medianAdjustedPricePerSquareFoot, 137.5);
  assert.equal(result.estimatedArv, 165000);
  assert.equal(result.lowArv, 148500);
  assert.equal(result.highArv, 181500);
});

test("ARV refuses to produce a figure without a qualified comp set", () => {
  assert.equal(isArvQuestion("what the arv of this property?"), true);
  assert.equal(isArvQuestion("after repair value?"), true);
  assert.equal(isArvQuestion("what is the roof condition?"), false);

  const incomplete = calculateArv(1200, 220, []);
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingInputs, ["at least 6 qualified comparable sales"]);
  assert.equal(incomplete.estimatedArv, null);
  assert.equal(incomplete.lowArv, null);
  assert.equal(incomplete.highArv, null);
});

test("ARV reports every missing input, not just the first", () => {
  const missingEverything = calculateArv(null, null, []);
  assert.equal(missingEverything.complete, false);
  assert.deepEqual(missingEverything.missingInputs, [
    "subject finished living area",
    "latest published local house-price index",
    "at least 6 qualified comparable sales",
  ]);
});

test("owner research resolves only an exact parcel identity or exact normalized address", () => {
  const results = [
    { ...profile, parcelId: "11111111111", address: "3952 ALDINE AV" },
    { ...profile, parcelId: "22222222222", address: "3952 ALDINE PL" },
  ];
  assert.equal(normalizedStreetAddress("3952 Aldine Avenue, St. Louis, MO"), "3952 ALDINE AV");
  assert.equal(
    selectOwnerResearchParcel({ parcelId: "11111111111", address: "ignored" }, results)?.parcelId,
    "11111111111",
  );
  assert.equal(
    selectOwnerResearchParcel({ parcelId: null, address: "3952 Aldine Avenue" }, results)?.parcelId,
    "11111111111",
  );
  assert.equal(
    selectOwnerResearchParcel({ parcelId: null, address: "3952 Aldine" }, results),
    null,
  );
});

test("owner research question names the owner and always demands a registry or title search", () => {
  const ownerQuestion = buildOwnerResearchQuestion("EXAMPLE OWNER LLC");
  assert.match(ownerQuestion, /EXAMPLE OWNER LLC/);
  assert.match(ownerQuestion, /entity-registry or title search/);
  assert.match(buildOwnerResearchQuestion(null), /entity-registry or title search/);
});

test("property record summary uses plain-language document labels", () => {
  const sections = buildPropertyRecordSummary("2614 NATURAL BRIDGE AV", {
    ...profile,
    ownerName: "FIRST OWNER LLC",
    ownerName2: "SECOND OWNER LLC",
    legalDescription: "CITY BLOCK 1249 LOT 4",
    priorTaxAmount: 2100,
    taxBalance: 147.57,
  });
  const ownership = sections.find((section) => section.title === "Property and ownership");
  assert.deepEqual(ownership?.lines.slice(0, 4), [
    {
      label: "Site address",
      value: "2614 Natural Bridge Avenue",
      verification: "trusted-provider",
    },
    {
      label: "Current owner of record",
      value: "FIRST OWNER LLC",
      verification: "trusted-provider",
    },
    {
      label: "Additional owner of record",
      value: "SECOND OWNER LLC",
      verification: "trusted-provider",
    },
    {
      label: "Legal description",
      value: "CITY BLOCK 1249 LOT 4",
      verification: "trusted-provider",
    },
  ]);
  const tax = sections.find((section) => section.title === "Tax and vacancy indicators");
  assert.deepEqual(tax?.lines[0], {
    label: "Prior-year property tax",
    value: "$2,100.00",
    verification: "trusted-provider",
  });
  assert.deepEqual(tax?.lines[1], {
    label: "Current tax balance",
    value: "$147.57",
    verification: "trusted-provider",
  });
});

test("property record summary distinguishes an absent field from a zero value", () => {
  const sections = buildPropertyRecordSummary("2614 NATURAL BRIDGE AV", profile);
  const ownership = sections.find((section) => section.title === "Property and ownership");
  assert.equal(
    ownership?.lines.find((line) => line.label === "Current owner of record")?.value,
    "Not published",
  );
  const land = sections.find((section) => section.title === "Land and location");
  assert.equal(land?.lines.find((line) => line.label === "Lot size")?.value, "Not published");
  assert.deepEqual(buildPropertyRecordSummary("2614 NATURAL BRIDGE AV", null), []);
  assert.ok(
    sections.every((section) =>
      section.lines.every((line) => line.verification === "trusted-provider"),
    ),
    "every published Assessor field is trusted-provider, never Accountabul-verified",
  );
});

test("property intake keeps bounded user claims separate from verified parcel facts", () => {
  const claims = normalizePropertyIntakeClaims({
    propertyUse: "single-family",
    bedrooms: 3,
    bathrooms: 1.5,
    interiorSquareFeet: 1180,
    currentOccupancy: "vacant",
    condition: "moderate-rehab",
    notes: "  Needs roof review.  ",
  });
  assert.deepEqual(claims, {
    propertyUse: "single-family",
    bedrooms: 3,
    bathrooms: 1.5,
    interiorSquareFeet: 1180,
    currentOccupancy: "vacant",
    condition: "moderate-rehab",
    notes: "Needs roof review.",
  });
  assert.throws(
    () => normalizePropertyIntakeClaims({ bedrooms: 2.5 }),
    /outside the supported range/i,
  );
  assert.throws(() => normalizePropertyIntakeClaims({ notes: "x".repeat(5001) }), /5,000/);
});

test("property intake falls back to unknown for an unrecognized enum rather than throwing", () => {
  const claims = normalizePropertyIntakeClaims({
    propertyUse: "castle",
    currentOccupancy: "haunted",
    condition: "pristine",
  });
  assert.equal(claims.propertyUse, "unknown");
  assert.equal(claims.currentOccupancy, "unknown");
  assert.equal(claims.condition, "unknown");
  assert.equal(claims.notes, "");
  assert.equal(normalizePropertyIntakeClaims(null).propertyUse, "unknown");
});

test("Property Records names acquisition inventory activity by its public agency", () => {
  assert.equal(
    propertyActivityLabel({ eventType: "acquisition_inventory", sourceKey: "lra" }),
    "LRA",
  );
  assert.equal(
    propertyActivityLabel({ eventType: "acquisition_inventory", sourceKey: "lcra" }),
    "LCRA",
  );
  assert.equal(
    propertyActivityLabel({
      eventType: "acquisition_inventory",
      sourceKey: "mo_st_louis_lra_inventory_v1",
    }),
    "LRA",
  );
  assert.equal(
    propertyActivityLabel({ eventType: "acquisition_inventory", sourceKey: " LRA " }),
    "LRA",
  );
  assert.equal(
    propertyActivityLabel({ eventType: "acquisition_inventory", sourceKey: "unknown" }),
    "Property inventory",
  );
  assert.equal(
    propertyActivityLabel({ eventType: "vacant_building_status", sourceKey: "vacancy" }),
    "Vacant building status",
  );
});

test("automatic intelligence refreshes only when missing or six hours old", () => {
  const now = Date.parse("2026-08-11T18:00:00.000Z");
  assert.equal(intelligenceNeedsRefresh(null, now), true);
  assert.equal(
    intelligenceNeedsRefresh(new Date(now - INTELLIGENCE_FRESHNESS_MS + 1).toISOString(), now),
    false,
  );
  assert.equal(
    intelligenceNeedsRefresh(new Date(now - INTELLIGENCE_FRESHNESS_MS).toISOString(), now),
    true,
  );
  assert.equal(intelligenceFreshness(new Date(now - 1000).toISOString(), now).state, "fresh");
});

test("intelligence freshness reports an unparseable timestamp as stale, never fresh", () => {
  const now = Date.parse("2026-08-11T18:00:00.000Z");
  assert.equal(intelligenceFreshness(null, now).state, "not-ingested");
  assert.equal(intelligenceFreshness("not a date", now).state, "stale");
  assert.equal(intelligenceNeedsRefresh("not a date", now), true);
  const fresh = intelligenceFreshness(new Date(now - 1000).toISOString(), now);
  assert.equal(fresh.nextRefreshAt, new Date(now - 1000 + INTELLIGENCE_FRESHNESS_MS).toISOString());
});

test("Property Intelligence warning requires three account-level reviews", () => {
  const initial = defaultPropertyIntelligenceNoticePreference();
  assert.equal(REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS, 3);
  assert.equal(propertyIntelligenceNoticeReviewNumber(initial), 1);
  assert.equal(propertyIntelligenceNoticeReviewNumber({ ...initial, acknowledgmentCount: 1 }), 2);
  assert.equal(propertyIntelligenceNoticeReviewNumber({ ...initial, acknowledgmentCount: 2 }), 3);
  assert.equal(
    propertyIntelligenceNoticeReviewNumber({
      ...initial,
      acknowledgmentCount: 3,
      canDismiss: true,
    }),
    3,
  );
  assert.equal(initial.canDismiss, false, "a fresh account may not dismiss the warning");
  assert.equal(initial.dismissed, false);
});
