// Slice 2 of the nationwide multi-state ingestion port
// (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Ported behavioral contracts
// from the source's tests/nationwide-ingestion-schedule.test.mjs, adapted to
// this repo's trimmed pure-only planNationwideSchedule (no
// NATIONWIDE_PILOT_SOURCE_MANIFESTS catalog here -- a hand-built fixture
// manifest against the ported Census catalogs stands in for it).
import assert from "node:assert/strict";
import test from "node:test";

import { planNationwideSchedule } from "../src/lib/property-intelligence/nationwide-ingestion-schedule.ts";
import {
  validateNationwideSourceManifest,
  type NationwideSourceManifest,
} from "../src/lib/property-intelligence/nationwide-source-manifest.ts";

function baseManifest(overrides: Partial<NationwideSourceManifest> = {}): NationwideSourceManifest {
  return {
    sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
    contractVersion: 3,
    mappingVersion: 1,
    jurisdiction: {
      jurisdictionType: "county_equivalent",
      name: "St. Louis City",
      legalName: null,
      stateName: "Missouri",
      stateLegalName: null,
      stateCode: "MO",
      stateFips: "29",
      countyFips: "29510",
      countyName: null,
      countyLegalName: null,
      placeFips: null,
      gnisId: null,
      timezone: "America/Chicago",
    },
    publisherName: "St. Louis Sheriff's Office",
    publishingAgency: null,
    sourceFamily: "county_sheriff_tax_sale",
    assetClass: "real_property",
    landingPageUrl: "https://example.gov/tax-sale",
    retrievalMethod: "scheduled_html_scrape",
    sourceFormat: "html",
    parserName: "st-louis-sheriff-tax-sale",
    parserVersion: "1",
    authoritativeIdentifierTypes: [],
    identityEstablishmentMode: "match_only",
    recordLane: "auction",
    withdrawalMode: "complete_snapshot",
    serviceMaximum: 5_000,
    batchSize: 500,
    leaseSeconds: 300,
    schedulePolicy: { mode: "manual" },
    expectedUpdateFrequency: "weekly",
    schedulerOwner: "ingestion-team",
    knownLimitations: null,
    active: false,
    ...overrides,
  };
}

test("inactive and manual sources never produce scheduled work", () => {
  const inactive = baseManifest({
    active: false,
    schedulePolicy: {
      mode: "interval",
      anchorUtc: "2026-08-15T05:00:00.000Z",
      intervalMinutes: 1_440,
      catchUpLimit: 2,
    },
  });
  assert.deepEqual(
    planNationwideSchedule({ manifest: inactive, now: "2026-08-19T05:30:00.000Z" }),
    { sourceKey: inactive.sourceKey, dueScheduledFor: [], backlogRemaining: 0 },
  );
  const manual = baseManifest({ active: true, schedulePolicy: { mode: "manual" } });
  assert.deepEqual(
    planNationwideSchedule({ manifest: manual, now: "2026-08-19T05:30:00.000Z" }).dueScheduledFor,
    [],
  );
});

test("an interval source plans canonical UTC slots and bounded chronological catch-up", () => {
  const manifest = baseManifest({
    active: true,
    schedulePolicy: {
      mode: "interval",
      anchorUtc: "2026-08-15T05:00:00.000Z",
      intervalMinutes: 1_440,
      catchUpLimit: 2,
    },
  });
  const initial = planNationwideSchedule({ manifest, now: "2026-08-19T05:30:00.000Z" });
  assert.deepEqual(initial.dueScheduledFor, ["2026-08-19T05:00:00.000Z"]);
  assert.equal(initial.backlogRemaining, 0);

  const catchUp = planNationwideSchedule({
    manifest,
    now: "2026-08-19T05:30:00.000Z",
    lastScheduledFor: "2026-08-15T05:00:00.000Z",
  });
  assert.deepEqual(catchUp.dueScheduledFor, [
    "2026-08-16T05:00:00.000Z",
    "2026-08-17T05:00:00.000Z",
  ]);
  assert.equal(catchUp.backlogRemaining, 2);
});

test("schedule validation rejects ambiguous cadence and misaligned history", () => {
  const manifest = baseManifest({
    active: true,
    schedulePolicy: {
      mode: "interval",
      anchorUtc: "2026-08-15T05:00:00.000Z",
      intervalMinutes: 1_440,
      catchUpLimit: 2,
    },
  });
  assert.throws(
    () =>
      validateNationwideSourceManifest({
        ...manifest,
        schedulePolicy: { ...manifest.schedulePolicy, intervalMinutes: 5 } as never,
      }),
    /between 15 minutes and one year/i,
  );
  assert.throws(
    () =>
      planNationwideSchedule({
        manifest,
        now: "2026-08-19T05:30:00.000Z",
        lastScheduledFor: "2026-08-18T05:01:00.000Z",
      }),
    /not aligned/i,
  );
});

test("manifest validation enforces canonical jurisdiction identity against the ported Census catalogs", () => {
  const manifest = baseManifest();
  assert.throws(
    () =>
      validateNationwideSourceManifest({
        ...manifest,
        jurisdiction: {
          ...manifest.jurisdiction,
          stateCode: "MO",
          stateFips: "29",
          countyFips: "29999",
        },
      }),
    /Census county baseline/i,
  );
  assert.throws(
    () => validateNationwideSourceManifest({ ...manifest, sourceKey: "Not Valid!" }),
    /sourceKey must contain only/i,
  );
});
