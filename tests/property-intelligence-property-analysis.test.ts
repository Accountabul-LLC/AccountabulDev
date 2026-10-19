// Contract for the Property Analysis engine, property memory, and the City of
// St. Louis source adapters, ported from property-intelligence-app@785747d
// (app/lib/property-analysis.ts, property-memory.ts and property-intelligence.ts,
// the last landing here as city-sources.ts).
//
// Assertions are ported from the source's tests/property-analysis.test.mjs,
// tests/property-records-usability.test.mjs and tests/ingestion-policy.test.mjs.
// What these pin down is the product's central promise: the analysis answers
// only what the connected records actually establish, and says so plainly when
// they do not -- it never infers a fact the source did not publish.
import assert from "node:assert/strict";
import test from "node:test";

import {
  answerPropertyQuestion,
  buildPropertyReport,
} from "../src/lib/property-intelligence/property-analysis.ts";
import { sortMemoryRecordsNewest } from "../src/lib/property-intelligence/property-memory.ts";
import {
  CITY_SOURCES,
  fetchCitySource,
  normalizeCityRecord,
} from "../src/lib/property-intelligence/city-sources.ts";
import type { PropertyProfile } from "../src/lib/property-intelligence/analysis-types.ts";
import type { PropertyDossier } from "../src/lib/property-intelligence/dossier-types.ts";

const profile = {
  lotSquareFeet: 3530,
  ward: 13,
  taxBalance: 0,
  priorTaxAmount: null,
  propertyClassCode: 17,
  isTaxAbated: false,
  abatementStartYear: null,
  abatementEndYear: null,
  webMercatorX: null,
  webMercatorY: null,
  cityBlock: 5293,
  parcelNumber: 941,
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
  sourceUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=82",
  observedAt: "2026-08-11T18:00:00.000Z",
} as unknown as PropertyProfile;

const dossier = {
  property: {
    id: "property:52939410000",
    asrParcelId: "52939410000",
    handle: null,
    currentAddress: "4921 EMERSON AV",
    matchStatus: "canonical",
    lastIntelligenceSyncAt: "2026-08-11T18:00:00.000Z",
    updatedAt: "2026-08-11T18:00:00.000Z",
    intelligenceSchemaVersion: 2,
  },
  events: [
    {
      id: "event:1",
      sourceKey: "electrical_permit",
      eventType: "Electrical permit",
      occurredAt: "2023-06-01T00:00:00.000Z",
      recordedAt: "2026-08-11T18:00:00.000Z",
      title: "Electrical permit",
      summary: "Service upgrade",
      actorName: null,
      status: "Finaled",
      amount: 7400,
      sourceUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=51",
      verificationStatus: "official-record",
    },
  ],
  sources: Array.from({ length: 8 }, (_, index) => ({
    sourceKey: `source-${index}`,
    status: "success",
    recordsSeen: index === 0 ? 1 : 0,
    unmatchedCount: 0,
    completedAt: "2026-08-11T18:00:00.000Z",
    error: null,
  })),
  unresolvedRecordCount: 0,
  freshness: {
    mode: "automatic",
    state: "fresh",
    lastSyncedAt: "2026-08-11T18:00:00.000Z",
    nextRefreshAt: null,
  },
  titleEvidence: [],
  disclaimer: "Public records are not a title opinion.",
} as unknown as PropertyDossier;

test("the property report is anchored to the parcel and every fact is provider-sourced", () => {
  const report = buildPropertyReport(dossier, profile);
  assert.match(report.overview, /ASR parcel 52939410000/);
  assert.ok(report.strengths.some((item) => /permit-related/i.test(item)));
  assert.ok(report.nextChecks.some((item) => /title search or commitment/i.test(item)));
  assert.ok(
    report.facts.every((fact) => fact.verification === "trusted-provider"),
    "no published Assessor fact may be labeled Accountabul-verified",
  );
  assert.ok(report.facts.every((fact) => fact.source === "Trusted data provider"));
});

test("the analysis refuses to imply clear title or completed work from permits", () => {
  const report = buildPropertyReport(dossier, profile);
  assert.match(
    answerPropertyQuestion("Is the title clear?", report, dossier),
    /do not establish clear or insurable title/i,
  );
  assert.match(
    answerPropertyQuestion("What permits were pulled?", report, dossier),
    /permit proves authorization, not completed work/i,
  );
});

test("property memory orders published records newest first and leaves undated evidence last", () => {
  const base = {
    kind: "status",
    title: "Vacant building status",
    detail: null,
    status: null,
    amount: null,
    observedAt: "2026-08-12T01:00:00.000Z",
    sourceUrl: "https://example.com",
    count: 1,
  };
  const records = sortMemoryRecordsNewest([
    { ...base, id: "undated", occurredAt: null },
    { ...base, id: "older", occurredAt: "2024-04-10T00:00:00.000Z" },
    { ...base, id: "newest", occurredAt: "2026-06-01T00:00:00.000Z" },
  ] as never);
  assert.deepEqual(
    (records as { id: string }[]).map((record) => record.id),
    ["newest", "older", "undated"],
  );
});

test("city source registry has unique parcel-filtered adapters", () => {
  assert.equal(CITY_SOURCES.length, 8);
  assert.equal(new Set(CITY_SOURCES.map((source) => source.key)).size, CITY_SOURCES.length);
  assert.ok(CITY_SOURCES.every((source) => source.endpoint.startsWith("/API/")));
});

test("normalization keeps exact parcel identity and provenance", () => {
  const source = CITY_SOURCES[0]!;
  const normalized = normalizeCityRecord(
    source,
    {
      PermitID: 42,
      ProjectASRParcelID: "52939410000",
      ProjectAddress: "4921 EMERSON",
      PermitType: "Electrical",
      CurrentStatus: "Finaled",
      ProjectCost: 7400,
    },
    "52939410000",
  );
  assert.equal(normalized.asrParcelId, "52939410000");
  assert.equal(normalized.status, "Finaled");
  assert.equal(normalized.amount, 7400);
  assert.equal(normalized.sourceUrl, source.datasetUrl);
});

test("a source mismatch is quarantined and a failed source stays isolated", async () => {
  const source = CITY_SOURCES[0]!;
  const mismatchFetch = async () =>
    new Response(
      JSON.stringify([
        { PermitID: 9, ProjectASRParcelID: "11111111111", ProjectAddress: "OTHER PARCEL" },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const mismatch = await fetchCitySource(source, "52939410000", mismatchFetch);
  assert.equal(mismatch.status, "success");
  assert.equal(mismatch.records.length, 0, "a record for another parcel is never adopted");
  assert.equal(mismatch.unmatched.length, 1);

  const failure = await fetchCitySource(
    source,
    "52939410000",
    async () => new Response("down", { status: 503 }),
  );
  assert.equal(failure.status, "failed");
  assert.equal(failure.records.length, 0);
  assert.match(failure.error ?? "", /503/);
});

test("vacant-building adapter expands conditions, dated statuses, and fee records", async () => {
  const source = CITY_SOURCES.find((item) => item.key === "vacant_building")!;
  const result = await fetchCitySource(
    source,
    "12499130000",
    async () =>
      new Response(
        JSON.stringify([
          {
            VacantBuildingID: 4971,
            ASRParcelID: "12499130000",
            PropertyAddress: "2614 NATURAL BRIDGE AV",
            Violations: [
              {
                ViolationItem: "Roof covering",
                ViolationAnswer: "Defective",
                ViolationText: "Repair roof",
                ViolationSeverity: "Major",
              },
            ],
            Results: [{ CurrentResult: "VB Letter", CurrentResultDate: "2026-06-01T00:00:00" }],
            FeesAndPenalties: [
              {
                FeeDescription: "Vacancy Penalty",
                FeeDollarAmount: 250,
                FeeLetterDate: "2026-06-01T00:00:00",
                InvoiceStatus: "Open",
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  assert.equal(result.status, "success");
  assert.equal(result.records.length, 4);
  const condition = result.records.find((record) => record.sourceRecordId.endsWith("violations-0"));
  assert.match(condition?.description ?? "", /Roof covering.*Defective.*Repair roof/);
  assert.equal(condition?.status, "Major");
  assert.equal(condition?.amount, null);
  const status = result.records.find((record) => record.sourceRecordId.endsWith("results-0"));
  assert.equal(status?.recordType, "Vacant building status");
  assert.equal(status?.occurredAt, "2026-06-01T00:00:00");
  const fee = result.records.find((record) => record.sourceRecordId.endsWith("feesandpenalties-0"));
  assert.equal(fee?.recordType, "Vacancy Penalty");
  assert.equal(fee?.amount, 250);
  assert.equal(fee?.status, "Open");
});
