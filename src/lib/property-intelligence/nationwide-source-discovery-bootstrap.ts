import mississippiSourceResearchCatalog from "../../../catalogs/nationwide-source-research/mississippi_initial_official_source_research.v1.json" with { type: "json" };
import { NATIONWIDE_PILOT_SOURCE_MANIFESTS } from "./nationwide-source-catalog.ts";
import {
  type AssessNationwideSourceCandidateInput,
  type NationwideSourceCandidateAccessMode,
  type NationwideSourceCandidateIdentityStatus,
  type NationwideSourceCandidateTermsStatus,
} from "./nationwide-source-discovery.ts";
import {
  validateNationwideSourceManifest,
  type NationwideSourceManifest,
} from "./nationwide-source-manifest.ts";
import {
  importNationwideSourceResearchCatalog,
  type NationwideSourceResearchCatalog,
} from "./nationwide-source-research-catalog.ts";
import type { PostgresTransactionHost } from "./nationwide-postgres-writer.ts";

type BootstrapAssessment = Omit<AssessNationwideSourceCandidateInput, "candidateId">;

export type NationwideSourceDiscoveryBootstrapEntry = {
  candidateKey: string;
  manifest: NationwideSourceManifest;
  discoveredBy: string;
  discoveredAt: string;
  accessMode: NationwideSourceCandidateAccessMode;
  retrievalMethodHint: string | null;
  termsReviewStatus: NationwideSourceCandidateTermsStatus;
  identityReviewStatus: NationwideSourceCandidateIdentityStatus;
  decisionNotes: string;
  assessedBy: string;
  assessedAt: string;
};

export const MISSISSIPPI_SOURCE_RESEARCH_CATALOG =
  mississippiSourceResearchCatalog as unknown as NationwideSourceResearchCatalog;

const catalogRecordedAt = MISSISSIPPI_SOURCE_RESEARCH_CATALOG.preparedAt;
const catalogReviewer = MISSISSIPPI_SOURCE_RESEARCH_CATALOG.preparedBy;
const candidateKeyPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const manifestByCandidateKey: Record<string, NationwideSourceManifest> = {
  ms_desoto_official_tax_sale_reports: NATIONWIDE_PILOT_SOURCE_MANIFESTS.desotoCountyTaxSale,
  ms_desoto_official_preliminary_landroll: NATIONWIDE_PILOT_SOURCE_MANIFESTS.desotoCountyLandroll,
  ms_sos_official_tax_forfeited_inventory:
    NATIONWIDE_PILOT_SOURCE_MANIFESTS.mississippiSosActiveInventory,
};

function requiredDecisionNotes(value: string | null, candidateKey: string) {
  if (!value)
    throw new Error(`Mississippi source candidate ${candidateKey} requires decision notes`);
  return value;
}

export const MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP =
  MISSISSIPPI_SOURCE_RESEARCH_CATALOG.entries.map((entry) => {
    const manifest = manifestByCandidateKey[entry.candidateKey];
    if (!manifest)
      throw new Error(`Mississippi source catalog has no manifest for ${entry.candidateKey}`);
    return {
      candidateKey: entry.candidateKey,
      manifest,
      discoveredBy: entry.discoveredBy,
      discoveredAt: entry.discoveredAt,
      accessMode: entry.assessment.accessMode,
      retrievalMethodHint: entry.assessment.retrievalMethodHint,
      termsReviewStatus: entry.assessment.termsReviewStatus,
      identityReviewStatus: entry.assessment.identityReviewStatus,
      decisionNotes: requiredDecisionNotes(entry.assessment.decisionNotes, entry.candidateKey),
      assessedBy: entry.assessment.assessedBy,
      assessedAt: entry.assessment.assessedAt,
    };
  }) satisfies readonly NationwideSourceDiscoveryBootstrapEntry[];

function assessmentFor(entry: NationwideSourceDiscoveryBootstrapEntry): BootstrapAssessment {
  const manifest = validateNationwideSourceManifest(entry.manifest);
  if (manifest.active) throw new Error("source-discovery bootstrap manifests must remain inactive");
  if (manifest.jurisdiction.stateCode !== "MS") {
    throw new Error(
      "the Mississippi source-discovery bootstrap accepts only Mississippi manifests",
    );
  }
  if (
    entry.retrievalMethodHint !== null &&
    entry.retrievalMethodHint !== manifest.retrievalMethod
  ) {
    throw new Error(
      "a bootstrap retrieval method must be null or exactly match its source manifest",
    );
  }
  const expectedIdentityReview =
    manifest.identityEstablishmentMode === "single_authoritative_identifier"
      ? "reviewed_authoritative"
      : "reviewed_match_only";
  if (entry.identityReviewStatus !== expectedIdentityReview) {
    throw new Error(
      `bootstrap identity review must be ${expectedIdentityReview} for this source manifest`,
    );
  }
  return {
    assessmentVersion: 1,
    disposition: "needs_review",
    publisherName: manifest.publisherName,
    publishingAgency: manifest.publishingAgency,
    sourceFamily: manifest.sourceFamily,
    assetClass: manifest.assetClass,
    landingPageUrl: manifest.landingPageUrl,
    officialSource: true,
    accessMode: entry.accessMode,
    retrievalMethodHint: entry.retrievalMethodHint,
    sourceFormatHint: manifest.sourceFormat,
    recordLaneHint: manifest.recordLane,
    expectedUpdateFrequency: manifest.expectedUpdateFrequency,
    termsReviewStatus: entry.termsReviewStatus,
    structureReviewStatus: "mapped",
    identityReviewStatus: entry.identityReviewStatus,
    sampleArtifact: null,
    decisionNotes: entry.decisionNotes,
    assessedBy: entry.assessedBy,
    assessedAt: entry.assessedAt,
  };
}

function catalogFor(
  entries: readonly (NationwideSourceDiscoveryBootstrapEntry & {
    manifest: NationwideSourceManifest;
    assessment: BootstrapAssessment;
  })[],
): NationwideSourceResearchCatalog {
  return {
    catalogKey: MISSISSIPPI_SOURCE_RESEARCH_CATALOG.catalogKey,
    catalogVersion: MISSISSIPPI_SOURCE_RESEARCH_CATALOG.catalogVersion,
    preparedBy: catalogReviewer,
    preparedAt: catalogRecordedAt,
    entries: entries.map((entry) => ({
      jurisdiction: entry.manifest.jurisdiction,
      candidateKey: entry.candidateKey,
      discoveredBy: entry.discoveredBy,
      discoveredAt: entry.discoveredAt,
      assessment: entry.assessment,
    })),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateMississippiSourceDiscoveryBootstrap(
  entries: readonly NationwideSourceDiscoveryBootstrapEntry[] = MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP,
) {
  const candidateKeys = new Set<string>();
  const validated = entries.map((entry) => {
    if (!candidateKeyPattern.test(entry.candidateKey)) {
      throw new Error(
        "Mississippi source candidate keys must contain lowercase letters, numbers, and single underscores",
      );
    }
    if (candidateKeys.has(entry.candidateKey)) {
      throw new Error(`duplicate Mississippi source candidate key ${entry.candidateKey}`);
    }
    candidateKeys.add(entry.candidateKey);
    return {
      ...entry,
      manifest: validateNationwideSourceManifest(entry.manifest),
      assessment: assessmentFor(entry),
    };
  });
  if (
    entries === MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP &&
    canonicalJson(catalogFor(validated)) !== canonicalJson(MISSISSIPPI_SOURCE_RESEARCH_CATALOG)
  ) {
    throw new Error(
      "Mississippi source research catalog file does not match its reviewed inactive manifests",
    );
  }
  return validated;
}

export async function bootstrapMississippiSourceDiscovery(
  database: PostgresTransactionHost,
  entries: readonly NationwideSourceDiscoveryBootstrapEntry[] = MISSISSIPPI_SOURCE_DISCOVERY_BOOTSTRAP,
) {
  const catalog = validateMississippiSourceDiscoveryBootstrap(entries);
  return importNationwideSourceResearchCatalog(database, {
    catalog: catalogFor(catalog),
    importedBy: catalogReviewer,
    importedAt: catalogRecordedAt,
  });
}
