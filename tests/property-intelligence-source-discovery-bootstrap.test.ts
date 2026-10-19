// Contract for the Mississippi source-discovery bootstrap, which had no test
// in this repository although the source app tests it directly
// (tests/nationwide-source-research-file.test.mjs exercises the same path).
//
// The bootstrap is how three reviewed-but-INACTIVE source manifests become
// discovery candidates. Its most valuable property is a cross-check most
// config loaders do not have: the shipped catalog JSON must be exactly what
// the reviewed manifests derive to, so the file and the manifests cannot
// drift apart silently. That is pinned first, because it is the assertion
// that fails if someone edits one and not the other.
//
// The rest are the refusals: a manifest that is active (a bootstrap must
// never enable a source), a non-Mississippi manifest, a retrieval hint that
// disagrees with its manifest, and an identity review status that does not
// match the manifest's identity mode.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP,
  MISSISSIPPI_SOURCE_RESEARCH_CATALOG,
  validateMississippiSourceDiscoveryBootstrap,
} from "../src/lib/property-intelligence/nationwide-source-discovery-bootstrap.ts";

function baseEntry() {
  const entry = MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP[0];
  assert.ok(entry, "the shipped bootstrap must carry at least one entry");
  return entry;
}

test("the shipped catalog file is exactly what the reviewed manifests derive to", () => {
  // The default-argument path runs the canonical-JSON cross-check; if the
  // catalog JSON and the manifests ever disagree, this is what fails.
  const validated = validateMississippiSourceDiscoveryBootstrap();
  assert.equal(validated.length, MISSISSIPPI_SOURCE_RESEARCH_CATALOG.entries.length);
});

test("every bootstrapped candidate is reviewed but still needs review, never auto-approved", () => {
  for (const entry of validateMississippiSourceDiscoveryBootstrap()) {
    assert.equal(entry.assessment.disposition, "needs_review");
    assert.equal(entry.assessment.officialSource, true);
    assert.equal(entry.manifest.active, false, "a bootstrap must never enable a source");
  }
});

test("a bootstrap manifest that is already active is refused", () => {
  const entry = baseEntry();
  assert.throws(
    () =>
      validateMississippiSourceDiscoveryBootstrap([
        { ...entry, manifest: { ...entry.manifest, active: true } },
      ]),
    /must remain inactive/,
  );
});

test("a manifest outside Mississippi is refused by the Mississippi bootstrap", () => {
  const entry = baseEntry();
  assert.throws(
    () =>
      validateMississippiSourceDiscoveryBootstrap([
        {
          ...entry,
          manifest: {
            ...entry.manifest,
            jurisdiction: {
              ...entry.manifest.jurisdiction,
              stateCode: "MO",
              stateFips: "29",
              stateName: "Missouri",
              stateLegalName: "State of Missouri",
              countyFips: "29510",
              name: "St. Louis city",
              legalName: "St. Louis city",
            },
          },
        },
      ]),
    /only Mississippi manifests/,
  );
});

test("a retrieval hint must be null or exactly match its manifest", () => {
  const entry = baseEntry();
  assert.throws(
    () =>
      validateMississippiSourceDiscoveryBootstrap([
        { ...entry, retrievalMethodHint: "carrier_pigeon" },
      ]),
    /null or exactly match its source manifest/,
  );
  // null is explicitly allowed.
  assert.doesNotThrow(() =>
    validateMississippiSourceDiscoveryBootstrap([{ ...entry, retrievalMethodHint: null }]),
  );
});

test("the identity review status must match the manifest's identity mode", () => {
  const entry = baseEntry();
  const wrong =
    entry.identityReviewStatus === "reviewed_authoritative"
      ? "reviewed_match_only"
      : "reviewed_authoritative";
  assert.throws(
    () => validateMississippiSourceDiscoveryBootstrap([{ ...entry, identityReviewStatus: wrong }]),
    /bootstrap identity review must be/,
  );
});

test("a malformed candidate key is refused", () => {
  const entry = baseEntry();
  for (const candidateKey of ["MS_Upper", "ms__double", "ms-dash", "_leading", "trailing_"]) {
    assert.throws(
      () => validateMississippiSourceDiscoveryBootstrap([{ ...entry, candidateKey }]),
      /candidate keys must contain lowercase letters/,
      `expected ${candidateKey} to be refused`,
    );
  }
});

test("a duplicate candidate key is refused rather than silently overwriting", () => {
  const entry = baseEntry();
  assert.throws(
    () => validateMississippiSourceDiscoveryBootstrap([entry, entry]),
    /duplicate Mississippi source candidate key/,
  );
});

test("an entry with no decision notes never reaches validation", () => {
  // requiredDecisionNotes runs while MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP is
  // built, so every shipped entry already carries notes -- pin that, since an
  // unexplained candidate is what the check exists to prevent.
  for (const entry of MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP) {
    assert.ok(entry.decisionNotes.trim().length > 0, `${entry.candidateKey} needs decision notes`);
  }
});
