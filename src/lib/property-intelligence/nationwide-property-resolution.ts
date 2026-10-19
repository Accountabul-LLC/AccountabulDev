// Slice 4 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1, Slice 3 68d2ae9). Ported VERBATIM (logic
// unchanged) from property-intelligence-app's app/lib/nationwide-property-resolution.ts.
// Pure decision logic: given a normalized bundle's published identifiers,
// the canonical identifiers currently on file, any enabled identifier-match
// policies, and any active official crosswalks, decide whether the bundle
// resolves to one canonical property. No network, no database.
//
// The load-bearing behavior this slice's task explicitly calls out: when
// `policies` is empty (no approved identifier-match policy exists for a
// source yet), `matchedIdentifiers` stays empty and the record is always
// returned `unresolved` with reason "No enabled identifier match policy
// authorizes automatic resolution for this source." -- this is the "fails
// closed until an approved policy exists" contract
// nationwide-postgres-property-resolver.ts and nationwide-postgres-property-resolver.test.ts
// depend on, preserved here exactly as ported.
import type {
  NormalizedIdentifierCandidate,
  NormalizedIntakeBundle,
} from "./nationwide-property-intake-types.ts";

export type CanonicalPropertyIdentifier = {
  propertyId: string;
  issuerCountyFips: string;
  identifierType: string;
  normalizedValue: string;
  isAuthoritative: boolean;
  isPreferred?: boolean;
  validTo: string | null;
};

export type IdentifierMatchPolicy = {
  sourceDefinitionKey: string;
  sourceIdentifierType: NormalizedIdentifierCandidate["identifierType"];
  canonicalIdentifierType: string;
  issuerCountyFips: string | null;
  policyVersion: string;
  evidenceReference: string;
  enabled: boolean;
};

export type OfficialPropertyCrosswalk = {
  sourceDefinitionKey: string;
  sourceRecordKey: string;
  propertyId: string;
  evidenceReference: string;
  active: boolean;
};

export type PropertyResolutionBundle = Pick<
  NormalizedIntakeBundle,
  "sourceRecord" | "propertyCandidate"
>;

export type PropertyResolutionResult = {
  status: "resolved" | "unresolved" | "needs_review" | "conflicted";
  propertyId: string | null;
  method: "official_crosswalk" | "exact_scoped_identifier" | "authoritative_source_identity" | null;
  candidatePropertyIds: string[];
  matchedIdentifiers: Array<{
    sourceIdentifierType: string;
    canonicalIdentifierType: string;
    issuerCountyFips: string;
    normalizedValue: string;
    propertyId: string;
    policyVersion: string;
  }>;
  evidenceReferences: string[];
  reason: string;
};

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function unresolved(reason: string): PropertyResolutionResult {
  return {
    status: "unresolved",
    propertyId: null,
    method: null,
    candidatePropertyIds: [],
    matchedIdentifiers: [],
    evidenceReferences: [],
    reason,
  };
}

export function resolveNormalizedProperty(input: {
  bundle: PropertyResolutionBundle;
  canonicalIdentifiers: CanonicalPropertyIdentifier[];
  knownPropertyIds?: string[];
  policies?: IdentifierMatchPolicy[];
  crosswalks?: OfficialPropertyCrosswalk[];
}): PropertyResolutionResult {
  const policies = (input.policies ?? []).filter((policy) => policy.enabled);
  const currentCanonical = input.canonicalIdentifiers.filter(
    (identifier) => identifier.isAuthoritative && identifier.validTo === null,
  );
  const knownPropertyIds = new Set(
    input.knownPropertyIds ?? currentCanonical.map((identifier) => identifier.propertyId),
  );
  const crosswalks = (input.crosswalks ?? []).filter(
    (crosswalk) =>
      crosswalk.active &&
      crosswalk.sourceDefinitionKey === input.bundle.sourceRecord.sourceDefinitionKey &&
      crosswalk.sourceRecordKey === input.bundle.sourceRecord.sourceRecordKey,
  );

  if (crosswalks.length > 0) {
    const crosswalkPropertyIds = sortedUnique(crosswalks.map((crosswalk) => crosswalk.propertyId));
    const evidenceReferences = sortedUnique(
      crosswalks.map((crosswalk) => crosswalk.evidenceReference),
    );
    if (crosswalkPropertyIds.length > 1) {
      return {
        status: "conflicted",
        propertyId: null,
        method: "official_crosswalk",
        candidatePropertyIds: crosswalkPropertyIds,
        matchedIdentifiers: [],
        evidenceReferences,
        reason:
          "Active official crosswalks point the same source record to different canonical properties.",
      };
    }
    // crosswalkPropertyIds.length === 1 here (the > 1 case returned above,
    // and the outer `crosswalks.length > 0` guarantees at least one).
    const crosswalkPropertyId = crosswalkPropertyIds[0] as string;
    if (!knownPropertyIds.has(crosswalkPropertyId)) {
      return {
        status: "needs_review",
        propertyId: null,
        method: "official_crosswalk",
        candidatePropertyIds: crosswalkPropertyIds,
        matchedIdentifiers: [],
        evidenceReferences,
        reason:
          "The official crosswalk points to a property that has no current authoritative identifier in this resolution snapshot.",
      };
    }
    return {
      status: "resolved",
      propertyId: crosswalkPropertyId,
      method: "official_crosswalk",
      candidatePropertyIds: crosswalkPropertyIds,
      matchedIdentifiers: [],
      evidenceReferences,
      reason:
        "One active official crosswalk links the source record to one known canonical property.",
    };
  }

  const matchedIdentifiers: PropertyResolutionResult["matchedIdentifiers"] = [];
  const evidenceReferences: string[] = [];
  for (const sourceIdentifier of input.bundle.propertyCandidate.identifiers) {
    const applicablePolicies = policies.filter(
      (policy) =>
        policy.sourceDefinitionKey === input.bundle.sourceRecord.sourceDefinitionKey &&
        policy.sourceIdentifierType === sourceIdentifier.identifierType &&
        (policy.issuerCountyFips === null ||
          policy.issuerCountyFips === sourceIdentifier.issuerCountyFips),
    );
    for (const policy of applicablePolicies) {
      const matches = currentCanonical.filter(
        (canonical) =>
          canonical.issuerCountyFips === sourceIdentifier.issuerCountyFips &&
          canonical.identifierType === policy.canonicalIdentifierType &&
          canonical.normalizedValue === sourceIdentifier.normalizedValue,
      );
      for (const canonical of matches) {
        matchedIdentifiers.push({
          sourceIdentifierType: sourceIdentifier.identifierType,
          canonicalIdentifierType: canonical.identifierType,
          issuerCountyFips: sourceIdentifier.issuerCountyFips,
          normalizedValue: sourceIdentifier.normalizedValue,
          propertyId: canonical.propertyId,
          policyVersion: policy.policyVersion,
        });
        evidenceReferences.push(policy.evidenceReference);
      }
    }
  }

  if (matchedIdentifiers.length === 0) {
    return unresolved(
      policies.length === 0
        ? "No enabled identifier match policy authorizes automatic resolution for this source."
        : "No exact current authoritative identifier matched within the same issuing county.",
    );
  }
  const candidatePropertyIds = sortedUnique(matchedIdentifiers.map((match) => match.propertyId));
  const uniqueEvidence = sortedUnique(evidenceReferences);
  if (candidatePropertyIds.length > 1) {
    const matchedSourceKeys = new Set(
      matchedIdentifiers.map(
        (match) =>
          `${match.sourceIdentifierType}:${match.issuerCountyFips}:${match.normalizedValue}`,
      ),
    );
    return {
      status: matchedSourceKeys.size === 1 ? "needs_review" : "conflicted",
      propertyId: null,
      method: "exact_scoped_identifier",
      candidatePropertyIds,
      matchedIdentifiers,
      evidenceReferences: uniqueEvidence,
      reason:
        matchedSourceKeys.size === 1
          ? "One supposedly unique authoritative identifier is attached to multiple canonical properties."
          : "Different exact source identifiers point to different canonical properties.",
    };
  }
  return {
    status: "resolved",
    // candidatePropertyIds.length === 1 here (the > 1 branch returned above).
    propertyId: candidatePropertyIds[0] as string,
    method: "exact_scoped_identifier",
    candidatePropertyIds,
    matchedIdentifiers,
    evidenceReferences: uniqueEvidence,
    reason: "All authorized exact scoped identifier matches point to one canonical property.",
  };
}
