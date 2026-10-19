// Contract for the source-qualification subsystem ported from
// property-intelligence-app@785747d: nationwide-source-discovery (candidate ->
// assessment -> promotion), nationwide-source-readiness, and the pilot source
// catalog.
//
// The source's own tests for these run against PGlite (an embedded Postgres)
// so they can exercise the real migrations. PGlite is not a dependency of this
// repo and this container cannot install one, so the database-backed paths are
// covered by property-intelligence-source-registration.test.ts's in-memory fake
// pattern instead. What is asserted here is the pure contract: the assessment
// validator, which is where the subsystem actually fails closed, and the
// readiness evaluation. The failure assertions are ported from the source's
// tests/nationwide-source-research-field-inventory.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateNationwideSourceCandidateAssessmentDraft } from "../src/lib/property-intelligence/nationwide-source-discovery.ts";
import {
  evaluateNationwideSourceReadiness,
  NATIONWIDE_PILOT_SOURCE_CAPABILITIES,
} from "../src/lib/property-intelligence/nationwide-source-readiness.ts";
import { NATIONWIDE_PILOT_SOURCE_MANIFESTS } from "../src/lib/property-intelligence/nationwide-source-catalog.ts";

const coreField = {
  fieldPath: "/PARCEL",
  publishedLabel: "Parcel",
  sourceValueTypes: ["string"],
  semanticRole: "property_identifier",
  mappingDecision: "core_field",
  destination: { relation: "property_core.property_identifiers", field: "raw_value" },
  extensionKey: null,
  fieldNotes: null,
};

function assessmentDraft(fieldInventory: unknown) {
  return {
    assessmentVersion: 1,
    disposition: "qualified",
    publisherName: "Mississippi Secretary of State",
    publishingAgency: "Public Lands Division",
    sourceFamily: "state_forfeited_inventory",
    assetClass: "real_property",
    landingPageUrl: "https://www.sos.ms.gov/public-lands",
    officialSource: true,
    accessMode: "public",
    retrievalMethodHint: "arcgis_feature_service",
    sourceFormatHint: "api",
    recordLaneHint: "property_record",
    expectedUpdateFrequency: "weekly",
    termsReviewStatus: "approved",
    structureReviewStatus: "mapped",
    identityReviewStatus: "reviewed_authoritative",
    ...(fieldInventory === undefined ? {} : { fieldInventory }),
    sampleArtifact: {
      sha256: "a".repeat(64),
      objectStorageKey: "nationwide/ms-sos/sample.json",
      mimeType: "application/json",
      byteSize: 2048,
    },
    decisionNotes: null,
    assessedBy: "accountabul-research",
    assessedAt: "2026-09-24T00:00:00.000Z",
  };
}

test("a complete, reviewed assessment validates and is returned normalized", () => {
  const validated = validateNationwideSourceCandidateAssessmentDraft(assessmentDraft([coreField]));
  assert.equal(validated.disposition, "qualified");
  assert.equal(validated.fieldInventory?.length, 1);
  assert.equal(validated.fieldInventory?.[0]?.fieldPath, "/PARCEL");
  assert.equal(
    validated.fieldInventory?.[0]?.destination?.relation,
    "property_core.property_identifiers",
  );
  assert.equal(validated.sampleArtifact?.byteSize, 2048);
});

test("field inventory validation fails closed on ambiguous paths, decisions and destinations", () => {
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([coreField, { ...coreField }]),
      ),
    /repeats fieldPath/i,
  );
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([{ ...coreField, fieldPath: "parcel" }]),
      ),
    /canonical non-root JSON Pointer/i,
  );
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([{ ...coreField, sourceValueTypes: ["string", "null"] }]),
      ),
    /canonically ordered/i,
  );
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([{ ...coreField, destination: null }]),
      ),
    /inconsistent with mappingDecision/i,
  );
});

test("a core field may only ever target a private canonical relation, never the API projection", () => {
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([
          {
            ...coreField,
            destination: { relation: "property_api.property_search", field: "search_text" },
          },
        ]),
      ),
    /private canonical field/i,
  );
});

test("qualification requires an actual reviewed inventory, not an absent or unreviewed one", () => {
  assert.throws(
    () => validateNationwideSourceCandidateAssessmentDraft(assessmentDraft(undefined)),
    /qualified assessments require/i,
  );
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft(
        assessmentDraft([
          {
            ...coreField,
            mappingDecision: "unreviewed",
            destination: null,
          },
        ]),
      ),
    /mapped fieldInventory cannot contain unreviewed/i,
  );
});

test("a rejected or retired assessment must record why", () => {
  const rejected = {
    ...assessmentDraft([coreField]),
    disposition: "rejected",
    decisionNotes: null,
  };
  assert.throws(
    () => validateNationwideSourceCandidateAssessmentDraft(rejected),
    /require decisionNotes/i,
  );
  const explained = validateNationwideSourceCandidateAssessmentDraft({
    ...rejected,
    decisionNotes: "Terms of use prohibit automated retrieval.",
  });
  assert.equal(explained.disposition, "rejected");
});

test("an unknown key in the draft is rejected rather than silently dropped", () => {
  assert.throws(
    () =>
      validateNationwideSourceCandidateAssessmentDraft({
        ...assessmentDraft([coreField]),
        sneakyExtraKey: true,
      }),
    /unknown field sneakyExtraKey/i,
  );
});

test("every pilot source has an explicit capability and a readiness result", () => {
  const readiness = evaluateNationwideSourceReadiness();
  assert.deepEqual(
    readiness.map((source) => source.catalogKey),
    Object.keys(NATIONWIDE_PILOT_SOURCE_CAPABILITIES),
  );
  assert.equal(
    readiness.length,
    Object.keys(NATIONWIDE_PILOT_SOURCE_MANIFESTS).length,
    "a manifest without a capability entry would silently drop out of readiness",
  );
});

test("no pilot source reports itself ready while its manifest is inactive", () => {
  const readiness = evaluateNationwideSourceReadiness();
  assert.equal(
    readiness.every((source) => source.continuousIngestionReady === false),
    true,
  );
  assert.equal(
    readiness.every((source) => source.continuousBlockers.includes("manifest_inactive")),
    true,
    "every pilot manifest ships inactive, so activation is a deliberate operator step",
  );
});
