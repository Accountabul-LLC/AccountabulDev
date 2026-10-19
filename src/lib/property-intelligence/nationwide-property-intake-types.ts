// Slice 3 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1). Ported from the shared type declarations at the
// top of property-intelligence-app's app/lib/nationwide-property-intake.ts
// and app/lib/nationwide-property-record-intake.ts. This module has no
// executable logic: it is the canonical in-memory shape every adapter's
// `normalize*` function in this slice returns. Nothing here reaches a
// network or a database -- what happens to a `NormalizedIntakeBundle` or a
// `NormalizedPropertyRecordBundle` after an adapter produces it (a write to
// property_ingest.source_records / property_core.properties) is the next
// slice's problem, same as the source's own layered parse -> normalize ->
// (separately) write architecture.
import { SHA256_HEX_ANY_CASE } from "../validation/patterns.ts";

export type PublishedVerification = "published" | "derived" | "inferred" | "accountabul_verified";

export type JurisdictionReference = {
  stateCode: string;
  countyName: string;
  countyFips: string;
};

export type SourceDocumentReference = {
  url: string;
  title: string;
  sha256: string;
  retrievedAt: string;
  publishedAt?: string | null;
  objectStorageKey?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
};

export type NormalizedIdentifierCandidate = {
  identifierType: "parcel_number" | "apn" | "pin" | "ppin" | "tax_sale_parcel_reference";
  issuerCountyFips: string;
  rawValue: string;
  normalizedValue: string;
  verificationStatus: PublishedVerification;
  isAuthoritative: boolean;
};

export type NormalizedAddressCandidate = {
  role: "situs" | "owner_mailing" | "unknown_published";
  rawAddress: string;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  verificationStatus: PublishedVerification;
};

export type NormalizedObservation = {
  factType: string;
  value: string | number | boolean;
  unit: string | null;
  effectiveDate: string | null;
  verificationStatus: PublishedVerification;
  derivationMethod: string | null;
};

export type NormalizedAuctionAmount = {
  amountType:
    | "taxes"
    | "interest"
    | "penalty"
    | "publication_fee"
    | "recording_fee"
    | "other_fee"
    | "total_due"
    | "minimum_bid"
    | "winning_bid"
    | "bid_excess"
    | "certificate_face_amount"
    | "application_fee"
    | "offer_amount";
  amount: number;
  currency: "USD";
  taxYear: number | null;
  valueStatus: "published";
  publishedLabel: string;
};

export type NormalizedAuctionParty = {
  role: "assessed_owner" | "purchaser" | "administering_agency" | "contact";
  publishedName: string;
};

export type NormalizedLifecycleEvent = {
  eventType:
    | "advertised"
    | "scheduled"
    | "sold"
    | "struck_to_state"
    | "forfeited_to_state"
    | "available_for_application"
    | "removed"
    | "patented_or_deeded";
  effectiveAt: string | null;
  publishedStatusText: string;
};

export type NormalizedIntakeBundle = {
  jurisdiction: JurisdictionReference & { censusGeoid: string };
  sourceRecord: {
    sourceDefinitionKey: string;
    sourceRecordKey: string;
    sourceVersion: "1";
    recordFingerprint: string;
    sourceDocumentSha256: string;
    sourceDocumentUrl: string;
    sourceDocumentRetrievedAt: string;
    sourceDocumentPublishedAt: string | null;
    sourceDocumentObjectStorageKey: string | null;
    sourceDocumentMimeType: string | null;
    sourceDocumentByteSize: number | null;
    sourceUrl: string;
    documentTitle: string;
    pageLocator: string | null;
    rowLocator: string;
    featureLocator: string | null;
    parsingStatus: "accepted" | "partial";
    warnings: string[];
    rawJson: Record<string, unknown>;
  };
  propertyCandidate: {
    identifiers: NormalizedIdentifierCandidate[];
    addresses: NormalizedAddressCandidate[];
    observations: NormalizedObservation[];
  };
  auction: {
    eventKey: string;
    eventLabel: string;
    saleMechanism: "redeemable_tax_deed" | "sheriff_or_judicial_sale" | "state_forfeited_inventory";
    assetClass: "real_property";
    startsAt: string | null;
    endsAt: string | null;
    status: "completed" | "scheduled" | "active_inventory";
    lotKey: string;
    publishedLotNumber: string | null;
    publishedItemNumber: string | null;
    publishedCertificateNumber: string | null;
    publishedReceiptNumber: string | null;
    publishedAddressText: string | null;
    legalDescription: string | null;
    taxYears: number[];
    amounts: NormalizedAuctionAmount[];
    parties: NormalizedAuctionParty[];
    lifecycle: NormalizedLifecycleEvent[];
    stateForfeitedDetails: null | {
      certifiedMarketValue: number | null;
      backTaxTotal: number | null;
      activeApplicationCount: number | null;
      pendingReviewApplicationCount: number | null;
      patentStatus: string | null;
    };
  };
  extensions: Array<{
    key: string;
    value: string | number | boolean;
    verificationStatus: PublishedVerification;
  }>;
  resolution: {
    status: "candidate" | "unresolved";
    automaticMethodsAllowed: Array<"exact_scoped_identifier">;
    addressOnlyMatchAllowed: false;
    reason: string;
  };
};

export type NormalizedPropertyRecordBundle = {
  jurisdiction: JurisdictionReference & { censusGeoid: string };
  sourceRecord: NormalizedIntakeBundle["sourceRecord"];
  propertyCandidate: NormalizedIntakeBundle["propertyCandidate"] & {
    latitude: number | null;
    longitude: number | null;
  };
  listing: {
    recordKind: "land_bank_inventory_item" | "assessor_property";
    lifecycleState: string;
    publishedStatusText: string | null;
    publishedOwnerText: string | null;
    legalDescription: string | null;
    publishedAmount: number | null;
    publishedAmountType: "asking_price" | null;
    publishedAmountLabel: string | null;
  };
  resolution: NormalizedIntakeBundle["resolution"];
};

export const NATIONWIDE_SOURCE_DEFINITION_KEYS = {
  mississippiCountyTaxSale: "ms_county_tax_sale_report_v1",
  mississippiRankinTaxSale: "ms_rankin_county_tax_sale_report_v1",
  mississippiSosInventory: "ms_sos_active_tax_forfeited_inventory_v1",
  mississippiDesotoLandroll: "ms_desoto_county_landroll_2026_prelim_v1",
  stLouisSheriffTaxSale: "mo_st_louis_sheriff_tax_sale_v1",
  stLouisLraInventory: "mo_st_louis_lra_inventory_v1",
} as const;

export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

export function normalizedGovernmentIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function finiteNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[$,%\s]/g, "")
            .trim(),
        );
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a finite number`);
  return parsed;
}

export function nonnegativeMoney(value: unknown, field: string): number | null {
  const parsed = finiteNumber(value, field);
  if (parsed !== null && parsed < 0) throw new Error(`${field} cannot be negative`);
  return parsed;
}

export function requiredNonnegativeMoney(value: unknown, field: string): number {
  const parsed = nonnegativeMoney(value, field);
  if (parsed === null) throw new Error(`${field} is required`);
  return parsed;
}

export function positiveIntegerOrNull(value: unknown, field: string): number | null {
  const parsed = finiteNumber(value, field);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${field} must be a nonnegative integer`);
  return parsed;
}

export function isoDateFromPublished(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function joinLines(lines: string[]): string | null {
  const parts = lines
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line));
  return parts.length > 0 ? parts.join(" | ") : null;
}

export function uniqueIdentifiers(identifiers: NormalizedIdentifierCandidate[]) {
  const seen = new Set<string>();
  return identifiers.filter((identifier) => {
    const key = `${identifier.identifierType}:${identifier.issuerCountyFips}:${identifier.normalizedValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateMississippiJurisdiction(jurisdiction: JurisdictionReference) {
  if (jurisdiction.stateCode !== "MS")
    throw new Error("Mississippi source jurisdiction must use stateCode MS");
  if (!jurisdiction.countyName.trim()) throw new Error("countyName is required");
  if (!/^28[0-9]{3}$/.test(jurisdiction.countyFips)) {
    throw new Error(
      "Mississippi countyFips must be a five-digit Census county GEOID beginning with 28",
    );
  }
}

export function validateJurisdiction(jurisdiction: JurisdictionReference) {
  if (!/^[A-Z]{2}$/.test(jurisdiction.stateCode))
    throw new Error("stateCode must be a two-letter uppercase code");
  if (!jurisdiction.countyName.trim()) throw new Error("countyName is required");
  if (!/^\d{5}$/.test(jurisdiction.countyFips))
    throw new Error("countyFips must be a five-digit Census county GEOID");
}

export function validateDocument(document: SourceDocumentReference) {
  let url: URL;
  try {
    url = new URL(document.url);
  } catch {
    throw new Error("source document URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("source document URL must use HTTPS");
  if (!SHA256_HEX_ANY_CASE.test(document.sha256)) {
    throw new Error("source document SHA-256 must contain 64 hexadecimal characters");
  }
  if (!isoDateFromPublished(document.retrievedAt))
    throw new Error("source document retrievedAt is invalid");
  const artifactValues = [document.objectStorageKey, document.mimeType, document.byteSize].filter(
    (value) => value !== null && value !== undefined,
  );
  if (artifactValues.length !== 0 && artifactValues.length !== 3) {
    throw new Error(
      "source document artifact storage key, MIME type, and byte size must be supplied together",
    );
  }
  if (
    document.byteSize !== null &&
    document.byteSize !== undefined &&
    (!Number.isInteger(document.byteSize) || document.byteSize < 0)
  ) {
    throw new Error("source document byteSize must be a nonnegative integer");
  }
}

export function jurisdictionWithGeoid(jurisdiction: JurisdictionReference) {
  return {
    ...jurisdiction,
    countyName: jurisdiction.countyName.trim(),
    censusGeoid: `0500000US${jurisdiction.countyFips}`,
  };
}

export function auctionAmount(
  amountType: NormalizedAuctionAmount["amountType"],
  publishedLabel: string,
  value: number | null | undefined,
  taxYear: number | null,
): NormalizedAuctionAmount | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${publishedLabel} cannot be negative or non-finite`);
  return {
    amountType,
    amount: value,
    currency: "USD",
    taxYear,
    valueStatus: "published",
    publishedLabel,
  };
}

export function resolutionForIdentifiers(
  identifiers: NormalizedIdentifierCandidate[],
): NormalizedIntakeBundle["resolution"] {
  if (identifiers.length === 0) {
    return {
      status: "unresolved",
      automaticMethodsAllowed: [],
      addressOnlyMatchAllowed: false,
      reason:
        "No jurisdiction-scoped property identifier was published; retain the lot as searchable and unresolved.",
    };
  }
  return {
    status: "candidate",
    automaticMethodsAllowed: ["exact_scoped_identifier"],
    addressOnlyMatchAllowed: false,
    reason:
      "Resolve only against the exact normalized identifier in the same issuing county or an approved official crosswalk.",
  };
}
