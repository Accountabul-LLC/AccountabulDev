// Ported from property-intelligence-app's app/lib/nationwide-source-manifest.ts
// (Slice 2 of the nationwide multi-state ingestion port). This slice keeps
// only the PURE validation/identity logic (manifest shape validation, the
// immutable run-key builder). The source's `registerNationwideSourceManifest`
// (which writes property_ingest.source_definitions through a
// PostgresTransactionHost) is NOT ported anywhere in this repo yet -- a real
// ingestion run therefore needs its source_definitions row seeded by some
// other means before it can resolve a sourceDefinitionId. This module itself
// never opens a network or database connection.
import { getCensusCountyCatalogEntry } from "./us-county-catalog.ts";
import { getUsStateCatalogEntry } from "./us-state-catalog.ts";

export type NationwideRecordLane = "auction" | "property_record";
export type NationwideSourceFormat =
  "api" | "csv" | "xlsx" | "pdf_text" | "pdf_ocr" | "html" | "manual_verified";
export type NationwideSchedulePolicy =
  | { mode: "manual" }
  | {
      mode: "interval";
      anchorUtc: string;
      intervalMinutes: number;
      catchUpLimit: number;
    };

export type NationwideJurisdictionManifest = {
  jurisdictionType: "state" | "county_equivalent" | "municipality" | "district" | "agency_area";
  name: string;
  legalName: string | null;
  stateName: string;
  stateLegalName: string | null;
  stateCode: string;
  stateFips: string;
  countyFips: string | null;
  countyName?: string | null;
  countyLegalName?: string | null;
  placeFips?: string | null;
  gnisId?: string | null;
  timezone: string | null;
};

export type NationwideSourceManifest = {
  sourceKey: string;
  contractVersion: number;
  mappingVersion: number;
  jurisdiction: NationwideJurisdictionManifest;
  publisherName: string;
  publishingAgency: string | null;
  sourceFamily: string;
  assetClass: "real_property" | "personal_property" | "mixed";
  landingPageUrl: string;
  retrievalMethod: string;
  sourceFormat: NationwideSourceFormat;
  parserName: string;
  parserVersion: string;
  authoritativeIdentifierTypes: string[];
  identityEstablishmentMode: "match_only" | "single_authoritative_identifier";
  recordLane: NationwideRecordLane;
  withdrawalMode: "append_only" | "complete_snapshot";
  serviceMaximum: number;
  batchSize: number;
  leaseSeconds: number;
  schedulePolicy: NationwideSchedulePolicy;
  expectedUpdateFrequency: string;
  schedulerOwner: string;
  knownLimitations: string | null;
  active: boolean;
};

const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

function required(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function canonicalUtc(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function normalizedSchedulePolicy(value: NationwideSchedulePolicy): NationwideSchedulePolicy {
  if (!value || typeof value !== "object" || !("mode" in value)) {
    throw new Error("schedulePolicy is required");
  }
  if (value.mode === "manual") return { mode: "manual" };
  if (value.mode !== "interval") throw new Error("schedulePolicy.mode must be manual or interval");
  const intervalMinutes = positiveInteger(value.intervalMinutes, "schedulePolicy.intervalMinutes");
  if (intervalMinutes < 15 || intervalMinutes > 525_600) {
    throw new Error("schedulePolicy.intervalMinutes must be between 15 minutes and one year");
  }
  const catchUpLimit = positiveInteger(value.catchUpLimit, "schedulePolicy.catchUpLimit");
  if (catchUpLimit > 100) throw new Error("schedulePolicy.catchUpLimit cannot exceed 100 runs");
  return {
    mode: "interval",
    anchorUtc: canonicalUtc(value.anchorUtc, "schedulePolicy.anchorUtc"),
    intervalMinutes,
    catchUpLimit,
  };
}

function publicUrl(value: string, field: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${field} must be an absolute HTTP(S) URL`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizedJurisdiction(
  jurisdiction: NationwideJurisdictionManifest,
): NationwideJurisdictionManifest {
  const stateCode = required(jurisdiction.stateCode, "jurisdiction.stateCode").toUpperCase();
  const stateFips = required(jurisdiction.stateFips, "jurisdiction.stateFips");
  if (!/^[A-Z]{2}$/.test(stateCode))
    throw new Error("jurisdiction.stateCode must be two uppercase letters");
  if (!/^\d{2}$/.test(stateFips)) throw new Error("jurisdiction.stateFips must be two digits");
  const canonicalState = getUsStateCatalogEntry(stateCode, stateFips);
  const suppliedStateName = required(jurisdiction.stateName, "jurisdiction.stateName");
  if (
    suppliedStateName.toLocaleLowerCase("en-US") !==
    canonicalState.stateName.toLocaleLowerCase("en-US")
  ) {
    throw new Error(`jurisdiction.stateName must be ${canonicalState.stateName} for ${stateCode}`);
  }
  const countyFips = jurisdiction.countyFips?.trim() || null;
  const jurisdictionType = jurisdiction.jurisdictionType;
  if (
    !["state", "county_equivalent", "municipality", "district", "agency_area"].includes(
      jurisdictionType,
    )
  ) {
    throw new Error("jurisdiction.jurisdictionType is not supported");
  }
  if (jurisdictionType === "county_equivalent") {
    if (!countyFips || !/^\d{5}$/.test(countyFips) || !countyFips.startsWith(stateFips)) {
      throw new Error(
        "a county-equivalent manifest requires a five-digit county FIPS in the declared state",
      );
    }
  } else if (jurisdictionType === "state" && countyFips !== null) {
    throw new Error("a state manifest cannot declare countyFips");
  } else if (
    countyFips !== null &&
    (!/^\d{5}$/.test(countyFips) || !countyFips.startsWith(stateFips))
  ) {
    throw new Error(
      "jurisdiction.countyFips must be a five-digit county FIPS in the declared state",
    );
  }
  const countyName = jurisdiction.countyName?.trim() || null;
  const countyLegalName = jurisdiction.countyLegalName?.trim() || null;
  if (jurisdictionType !== "county_equivalent" && countyFips !== null && !countyName) {
    throw new Error("a county-contained jurisdiction requires jurisdiction.countyName");
  }
  if (jurisdictionType === "state" && (countyName || countyLegalName)) {
    throw new Error("a state manifest cannot declare county identity fields");
  }
  const jurisdictionName = required(jurisdiction.name, "jurisdiction.name");
  if (countyFips !== null) {
    const canonicalCounty = getCensusCountyCatalogEntry(countyFips);
    if (canonicalCounty.stateCode !== stateCode) {
      throw new Error(`jurisdiction.countyFips ${countyFips} does not belong to ${stateCode}`);
    }
    const suppliedCountyName =
      jurisdictionType === "county_equivalent" ? jurisdictionName : countyName;
    const normalizedSuppliedName = suppliedCountyName?.toLocaleLowerCase("en-US") ?? null;
    const acceptedNames = new Set([
      canonicalCounty.countyName.toLocaleLowerCase("en-US"),
      canonicalCounty.countyLegalName.toLocaleLowerCase("en-US"),
    ]);
    if (!normalizedSuppliedName || !acceptedNames.has(normalizedSuppliedName)) {
      throw new Error(
        `jurisdiction county name must match Census county FIPS ${countyFips} (${canonicalCounty.countyName})`,
      );
    }
  }
  const placeFips = jurisdiction.placeFips?.trim() || null;
  if (jurisdictionType === "municipality") {
    if (!placeFips || !/^\d{5}$/.test(placeFips)) {
      throw new Error("a municipality manifest requires a five-digit Census place FIPS");
    }
  } else if (placeFips !== null) {
    throw new Error("only a municipality manifest can declare placeFips");
  }
  const gnisId = jurisdiction.gnisId?.trim() || null;
  if (gnisId !== null && !/^\d+$/.test(gnisId)) {
    throw new Error("jurisdiction.gnisId must contain only digits");
  }
  return {
    ...jurisdiction,
    name: jurisdictionName,
    legalName: jurisdiction.legalName?.trim() || null,
    stateName: canonicalState.stateName,
    stateLegalName: jurisdiction.stateLegalName?.trim() || null,
    stateCode,
    stateFips,
    countyFips,
    // Present only when the caller supplied the key or the value is
    // non-null. Adding these unconditionally as null changes the canonical
    // JSON of a jurisdiction, which broke the source-discovery bootstrap's
    // cross-check against its reviewed catalog file: the derived catalog
    // carried four keys the reviewed file does not, so
    // validateMississippiSourceDiscoveryBootstrap threw on every call.
    ...(countyName !== null || "countyName" in jurisdiction ? { countyName } : {}),
    ...(countyLegalName !== null || "countyLegalName" in jurisdiction ? { countyLegalName } : {}),
    ...(placeFips !== null || "placeFips" in jurisdiction ? { placeFips } : {}),
    ...(gnisId !== null || "gnisId" in jurisdiction ? { gnisId } : {}),
    timezone: jurisdiction.timezone?.trim() || null,
  };
}

export function validateNationwideJurisdictionManifest(
  jurisdiction: NationwideJurisdictionManifest,
) {
  return normalizedJurisdiction(jurisdiction);
}

function normalizedManifest(manifest: NationwideSourceManifest): NationwideSourceManifest {
  const sourceKey = required(manifest.sourceKey, "sourceKey");
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) {
    throw new Error(
      "sourceKey must contain only lowercase letters, numbers, and single underscores",
    );
  }
  const jurisdiction = normalizedJurisdiction(manifest.jurisdiction);
  const authoritativeIdentifierTypes = [
    ...new Set(manifest.authoritativeIdentifierTypes.map((value) => value.trim())),
  ].sort();
  if (authoritativeIdentifierTypes.some((value) => !IDENTIFIER_PATTERN.test(value))) {
    throw new Error("authoritativeIdentifierTypes must use lowercase identifier keys");
  }
  const identityEstablishmentMode = manifest.identityEstablishmentMode;
  if (!["match_only", "single_authoritative_identifier"].includes(identityEstablishmentMode)) {
    throw new Error(
      "identityEstablishmentMode must be match_only or single_authoritative_identifier",
    );
  }
  if (identityEstablishmentMode === "single_authoritative_identifier") {
    if (manifest.recordLane !== "property_record") {
      throw new Error(
        "single_authoritative_identifier identity establishment requires the property_record lane",
      );
    }
    if (authoritativeIdentifierTypes.length !== 1) {
      throw new Error(
        "single_authoritative_identifier identity establishment requires exactly one authoritative identifier type",
      );
    }
  }
  const serviceMaximum = positiveInteger(manifest.serviceMaximum, "serviceMaximum");
  const batchSize = positiveInteger(manifest.batchSize, "batchSize");
  if (batchSize > serviceMaximum) throw new Error("batchSize cannot exceed serviceMaximum");
  const leaseSeconds = positiveInteger(manifest.leaseSeconds, "leaseSeconds");
  if (leaseSeconds < 60 || leaseSeconds > 3_600) {
    throw new Error("leaseSeconds must be between 60 and 3600 seconds");
  }
  return {
    ...manifest,
    sourceKey,
    contractVersion: positiveInteger(manifest.contractVersion, "contractVersion"),
    mappingVersion: positiveInteger(manifest.mappingVersion, "mappingVersion"),
    jurisdiction,
    publisherName: required(manifest.publisherName, "publisherName"),
    publishingAgency: manifest.publishingAgency?.trim() || null,
    sourceFamily: required(manifest.sourceFamily, "sourceFamily"),
    landingPageUrl: publicUrl(manifest.landingPageUrl, "landingPageUrl"),
    retrievalMethod: required(manifest.retrievalMethod, "retrievalMethod"),
    parserName: required(manifest.parserName, "parserName"),
    parserVersion: required(manifest.parserVersion, "parserVersion"),
    authoritativeIdentifierTypes,
    identityEstablishmentMode,
    serviceMaximum,
    batchSize,
    leaseSeconds,
    schedulePolicy: normalizedSchedulePolicy(manifest.schedulePolicy),
    expectedUpdateFrequency: required(manifest.expectedUpdateFrequency, "expectedUpdateFrequency"),
    schedulerOwner: required(manifest.schedulerOwner, "schedulerOwner"),
    knownLimitations: manifest.knownLimitations?.trim() || null,
  };
}

export function validateNationwideSourceManifest(manifest: NationwideSourceManifest) {
  return normalizedManifest(manifest);
}

export function buildScheduledRunKey(
  manifest: NationwideSourceManifest,
  scheduledFor: string,
  attempt = 1,
) {
  const normalized = normalizedManifest(manifest);
  positiveInteger(attempt, "attempt");
  const date = new Date(scheduledFor);
  if (!Number.isFinite(date.valueOf())) throw new Error("scheduledFor must be an ISO date-time");
  const iso = date.toISOString();
  if (iso !== scheduledFor) throw new Error("scheduledFor must be a canonical UTC ISO date-time");
  return `${normalized.sourceKey}:c${normalized.contractVersion}:m${normalized.mappingVersion}:${iso}:a${attempt}`;
}
