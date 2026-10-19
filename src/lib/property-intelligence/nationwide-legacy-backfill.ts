// Slice 5 (final) of the nationwide multi-state ingestion port (continues
// Slice 1 029fbe9, Slice 2 23893a1, Slice 3 68d2ae9, Slice 4 00f6796). Ported
// from property-intelligence-app's app/lib/nationwide-legacy-backfill.ts
// (orchestration) and the three `normalizeLegacy*` normalizers that live in
// its app/lib/nationwide-property-record-intake.ts (this repo's Slice 3
// already ported that file's two OFFICIAL normalizers as
// nationwide-property-record-intake.ts; the three LEGACY normalizers below
// are net-new -- nothing before this slice needed them).
//
// "Legacy" here means the source app's OWN pre-nationwide-migration Supabase
// project (a different, older schema shape than the nationwide canonical
// model this repo writes to) -- see this repo's AGENTS.md and this slice's
// task header for why that project is never named or connected to from this
// repo. These three functions are pure data-shape transforms: a legacy-row
// object in, a `NormalizedPropertyRecordBundle` / `NormalizedIntakeBundle`
// out, no I/O.
//
// The backfill executor below (`executeLegacyLraBackfill` /
// `executeLegacyStLouisTaxSaleBackfill` / `executeLegacyCookCountyBackfill`)
// does NOT port the source's `executeNationwideSnapshotIngestion` worker
// loop from app/lib/nationwide-ingestion-orchestrator.ts -- this repo's own
// Slice 2 explicitly did not port that function (see this repo's
// nationwide-ingestion-orchestrator.ts header: "the source's
// executeNationwideSnapshotIngestion ... is NOT ported here"). Instead this
// slice reuses the exact fetch -> normalize -> resolve -> write -> run-store
// pipeline shape Slice 4 already established in
// nationwide-source-adapter-bindings.ts's `runSnapshotIngestion`, adapted
// for rows supplied up front (an immutable already-captured export) instead
// of fetched live, and for `sourceDefinitionId` / `jurisdictionId` supplied
// as injected UUIDs (again matching Slice 4's binding pattern) rather than
// re-deriving them from a source-manifest registration this repo also never
// ported (see nationwide-source-manifest.ts's header).
//
// Resolution default: matching the source's own design intent (its
// `unresolved` constant and comment), a legacy backfill record is NEVER
// automatically resolved to a canonical property unless a caller explicitly
// injects a `resolveRecord` callback -- there is no default identifier-match
// policy for a legacy, unaudited import. This is consistent with (not a
// workaround for) nationwide-property-resolution.ts's "fails closed without
// an approved policy" contract, and with these three legacy source
// contracts' own `identityEstablishmentMode: "match_only"` (never
// `single_authoritative_identifier`), so nationwide-postgres-writer.ts's
// `resolveOrBootstrapAuthoritativeProperty` never bootstraps one either.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import {
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  cleanText,
  normalizedGovernmentIdentifier,
  validateDocument,
  validateJurisdiction,
  type JurisdictionReference,
  type NormalizedAddressCandidate,
  type NormalizedIdentifierCandidate,
  type NormalizedIntakeBundle,
  type NormalizedObservation,
  type NormalizedPropertyRecordBundle,
  type SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";
import type { PropertyResolutionResult } from "./nationwide-property-resolution.ts";
import {
  finalizeSnapshotIngestionRun,
  persistSnapshotBatchResult,
  startSnapshotIngestionRun,
  type SnapshotArtifactEvidence,
} from "./nationwide-postgres-run-store.ts";
import {
  persistNormalizedAuctionBundle,
  persistNormalizedPropertyRecordBundle,
} from "./nationwide-postgres-writer.ts";

// A legacy source that publishes no reviewed "il_cook_county_property_v1"
// entry in this repo's own NATIONWIDE_SOURCE_DEFINITION_KEYS (Slice 3's
// dictionary only carries the two St. Louis keys, both already registered
// for an OFFICIAL source at a different contract version -- see the
// source's own nationwide-source-catalog.ts entries for
// `legacyStLouisLra` / `legacyStLouisSheriffTaxSale` /
// `legacyCookCountyAssessor`, all three sharing a sourceKey with their
// official counterpart except Cook County, which has none).
const COOK_COUNTY_LEGACY_SOURCE_KEY = "il_cook_county_property_v1";

const LEGACY_BACKFILL_RESOLUTION_ALGORITHM_VERSION = "accountabul-legacy-backfill-resolution-v1";

const ST_LOUIS_JURISDICTION: JurisdictionReference = {
  stateCode: "MO",
  countyName: "St. Louis City",
  countyFips: "29510",
};

const COOK_COUNTY_JURISDICTION: JurisdictionReference = {
  stateCode: "IL",
  countyName: "Cook",
  countyFips: "17031",
};

export type LegacyLraPropertyRow = Record<string, unknown> & {
  id?: string | null;
  parcel_id?: string | null;
  apn?: string | null;
  parcel_status?: string | null;
  usage?: string | null;
  property_source?: string | null;
  address?: string | null;
  zip?: string | null;
  ward?: number | string | null;
  neighborhood_number?: number | string | null;
  neighborhood?: string | null;
  description?: string | null;
  class?: string | null;
  legal_description?: string | null;
  property_type?: string | null;
  side_lot_eligible?: boolean | string | number | null;
  irregular_lot?: boolean | string | number | null;
  frontage?: string | number | null;
  nbr_of_units?: string | number | null;
  sqft?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  zoning?: string | null;
};

export type LegacyCookCountyPropertyRow = Record<string, unknown> & {
  source_name?: string | null;
  source_record_id?: string | null;
  apn?: string | null;
  pin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  property_type?: string | null;
  property_subtype?: string | null;
  land_use?: string | null;
  units?: number | string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  rooms?: number | string | null;
  building_sqft?: number | string | null;
  land_sqft?: number | string | null;
  lot_sqft?: number | string | null;
  year_built?: number | string | null;
  assessed_land?: number | string | null;
  assessed_improvement?: number | string | null;
  market_value?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  raw?: Record<string, unknown> | null;
};

export type LegacyStLouisTaxSaleRow = Record<string, unknown> & {
  sale_number?: string | null;
  sale_date?: string | null;
  land_tax_number?: string | null;
  apn?: string | null;
  owner?: string | null;
  address?: string | null;
  total_amount?: number | string | null;
  zip?: string | null;
  ward?: number | string | null;
  zoning?: string | null;
};

type LegacyRecordInput<Row> = {
  jurisdiction: JurisdictionReference;
  document: SourceDocumentReference;
  rowNumber: number;
  row: Row;
};

function number(
  value: unknown,
  field: string,
  options: { integer?: boolean; nonnegative?: boolean } = {},
) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,%\s,]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a finite number`);
  if (options.integer && !Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  if (options.nonnegative && parsed < 0) throw new Error(`${field} cannot be negative`);
  return parsed;
}

function boolean(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

function legacyUnitCount(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const matches = text.match(/\d+/g);
  if (!matches || matches.length !== 1) return null;
  const parsed = Number(matches[0]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sourceContent(row: Record<string, unknown>) {
  const operational = new Set([
    "id",
    "created_at",
    "updated_at",
    "imported_at",
    "geocode_attempted_at",
    "zoning_attempted_at",
  ]);
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !operational.has(key.toLowerCase()) && key.toLowerCase() !== "objectid")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function observation(
  factType: string,
  value: string | number | boolean | null,
  unit: string | null = null,
): NormalizedObservation | null {
  if (value === null || (typeof value === "string" && !value.trim())) return null;
  return {
    factType,
    value,
    unit,
    effectiveDate: null,
    verificationStatus: "published",
    derivationMethod: null,
  };
}

function observations(values: Array<NormalizedObservation | null>) {
  return values.filter((value): value is NormalizedObservation => value !== null);
}

function address(
  rawAddress: unknown,
  city: string | null,
  stateCode: string | null,
  postalCode: unknown,
  role: NormalizedAddressCandidate["role"] = "situs",
): NormalizedAddressCandidate[] {
  const raw = cleanText(rawAddress);
  if (!raw) return [];
  return [
    {
      role,
      rawAddress: raw,
      city,
      stateCode,
      postalCode: cleanText(postalCode),
      verificationStatus: "published",
    },
  ];
}

function baseSourceRecord(input: {
  sourceDefinitionKey: string;
  sourceRecordKey: string;
  recordFingerprint: string;
  document: SourceDocumentReference;
  rowNumber: number;
  warnings: string[];
  rawJson: Record<string, unknown>;
}): NormalizedIntakeBundle["sourceRecord"] {
  return {
    sourceDefinitionKey: input.sourceDefinitionKey,
    sourceRecordKey: input.sourceRecordKey,
    sourceVersion: "1",
    recordFingerprint: input.recordFingerprint,
    sourceDocumentSha256: input.document.sha256,
    sourceDocumentUrl: input.document.url,
    sourceDocumentRetrievedAt: input.document.retrievedAt,
    sourceDocumentPublishedAt: input.document.publishedAt ?? null,
    sourceDocumentObjectStorageKey: input.document.objectStorageKey ?? null,
    sourceDocumentMimeType: input.document.mimeType ?? null,
    sourceDocumentByteSize: input.document.byteSize ?? null,
    sourceUrl: input.document.url,
    documentTitle: input.document.title,
    pageLocator: null,
    rowLocator: String(input.rowNumber),
    featureLocator: null,
    parsingStatus: "accepted",
    warnings: input.warnings,
    rawJson: input.rawJson,
  };
}

function propertyResolution(reason: string): NormalizedPropertyRecordBundle["resolution"] {
  return {
    status: "candidate",
    automaticMethodsAllowed: ["exact_scoped_identifier"],
    addressOnlyMatchAllowed: false,
    reason,
  };
}

// Ported from the source's `normalizeLegacyLraProperty`.
export async function normalizeLegacyLraProperty(
  input: LegacyRecordInput<LegacyLraPropertyRow>,
): Promise<NormalizedPropertyRecordBundle> {
  validateJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  const parcelId = cleanText(input.row.parcel_id);
  if (!parcelId) throw new Error("LRA parcel_id is required");
  const parcelNormalized = normalizedGovernmentIdentifier(parcelId);
  const apn = cleanText(input.row.apn);
  const warnings: string[] = [];
  const identifiers: NormalizedIdentifierCandidate[] = [
    {
      identifierType: "parcel_number",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: parcelId,
      normalizedValue: parcelNormalized,
      verificationStatus: "published",
      isAuthoritative: true,
    },
  ];
  if (apn && normalizedGovernmentIdentifier(apn) !== parcelNormalized) {
    identifiers.push({
      identifierType: "apn",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: apn,
      normalizedValue: normalizedGovernmentIdentifier(apn),
      verificationStatus: "derived",
      isAuthoritative: false,
    });
    warnings.push(
      "Legacy APN provenance is not recorded; it is retained as a non-authoritative candidate.",
    );
  } else if (apn) {
    warnings.push("Legacy APN duplicates parcel_id and is not promoted as a second identifier.");
  }
  const lifecycleState =
    cleanText(input.row.parcel_status)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_") ?? "unknown";
  const latitude = number(input.row.latitude, "latitude");
  const longitude = number(input.row.longitude, "longitude");
  if (latitude !== null && (latitude < -90 || latitude > 90))
    throw new Error("latitude must be between -90 and 90");
  if (longitude !== null && (longitude < -180 || longitude > 180))
    throw new Error("longitude must be between -180 and 180");
  const unitsRaw = legacyUnitCount(input.row.nbr_of_units);
  const published = {
    parcel_id: parcelId,
    parcel_status: cleanText(input.row.parcel_status),
    usage: cleanText(input.row.usage),
    property_source: cleanText(input.row.property_source),
    address: cleanText(input.row.address),
    zip: cleanText(input.row.zip),
    ward: number(input.row.ward, "ward", { integer: true, nonnegative: true }),
    neighborhood_number: number(input.row.neighborhood_number, "neighborhood_number", {
      integer: true,
      nonnegative: true,
    }),
    neighborhood: cleanText(input.row.neighborhood),
    description: cleanText(input.row.description),
    class: cleanText(input.row.class),
    legal_description: cleanText(input.row.legal_description),
    property_type: cleanText(input.row.property_type),
    side_lot_eligible: boolean(input.row.side_lot_eligible),
    irregular_lot: boolean(input.row.irregular_lot),
    frontage: cleanText(input.row.frontage),
    nbr_of_units: cleanText(input.row.nbr_of_units),
    sqft: number(input.row.sqft, "sqft", { nonnegative: true }),
    latitude,
    longitude,
    zoning: cleanText(input.row.zoning),
  };
  const sourceRecordKey = `${input.jurisdiction.countyFips}:lra:${parcelNormalized}`;
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisLraInventory,
    sourceRecordKey,
    published,
    sourceContent: sourceContent(input.row),
  });
  return {
    jurisdiction: { ...input.jurisdiction, censusGeoid: input.jurisdiction.countyFips },
    sourceRecord: baseSourceRecord({
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisLraInventory,
      sourceRecordKey,
      recordFingerprint,
      document: input.document,
      rowNumber: input.rowNumber,
      warnings,
      rawJson: input.row,
    }),
    propertyCandidate: {
      identifiers,
      addresses: address(published.address, null, null, published.zip),
      observations: observations([
        observation("inventory_status", published.parcel_status),
        observation("land_use", published.usage),
        observation("property_type", published.property_type),
        observation("property_class", published.class),
        observation("neighborhood", published.neighborhood),
        observation("ward", published.ward),
        observation("zoning", published.zoning),
        observation("land_area", published.sqft, "square_foot"),
        observation("unit_count", unitsRaw, "unit"),
        observation("side_lot_eligible", published.side_lot_eligible),
        observation("irregular_lot", published.irregular_lot),
      ]),
      latitude,
      longitude,
    },
    listing: {
      recordKind: "land_bank_inventory_item",
      lifecycleState,
      publishedStatusText: published.parcel_status,
      publishedOwnerText: null,
      legalDescription: published.legal_description,
      publishedAmount: null,
      publishedAmountType: null,
      publishedAmountLabel: null,
    },
    resolution: propertyResolution(
      "Use the county-scoped LRA parcel identifier; never match this record by address alone.",
    ),
  };
}

// Ported from the source's `normalizeLegacyCookCountyProperty`.
export async function normalizeLegacyCookCountyProperty(
  input: LegacyRecordInput<LegacyCookCountyPropertyRow>,
): Promise<NormalizedPropertyRecordBundle> {
  validateJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  const apn = cleanText(input.row.apn);
  if (!apn) throw new Error("Cook County APN is required");
  const apnNormalized = normalizedGovernmentIdentifier(apn);
  const pin = cleanText(input.row.pin);
  const identifiers: NormalizedIdentifierCandidate[] = [
    {
      identifierType: "apn",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: apn,
      normalizedValue: apnNormalized,
      verificationStatus: "published",
      isAuthoritative: false,
    },
  ];
  if (pin && normalizedGovernmentIdentifier(pin) !== apnNormalized) {
    identifiers.push({
      identifierType: "pin",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: pin,
      normalizedValue: normalizedGovernmentIdentifier(pin),
      verificationStatus: "published",
      isAuthoritative: false,
    });
  }
  const sourceRecordKey = `${input.jurisdiction.countyFips}:${cleanText(input.row.source_name) ?? "cook_county"}:${cleanText(input.row.source_record_id) ?? apnNormalized}`;
  const latitude = number(input.row.latitude, "latitude");
  const longitude = number(input.row.longitude, "longitude");
  const published = {
    apn,
    pin,
    address: cleanText(input.row.address),
    city: cleanText(input.row.city),
    state: cleanText(input.row.state),
    zip: cleanText(input.row.zip),
    property_type: cleanText(input.row.property_type),
    property_subtype: cleanText(input.row.property_subtype),
    land_use: cleanText(input.row.land_use),
    units: number(input.row.units, "units", { integer: true, nonnegative: true }),
    bedrooms: number(input.row.bedrooms, "bedrooms", { nonnegative: true }),
    bathrooms: number(input.row.bathrooms, "bathrooms", { nonnegative: true }),
    rooms: number(input.row.rooms, "rooms", { integer: true, nonnegative: true }),
    building_sqft: number(input.row.building_sqft, "building_sqft", { nonnegative: true }),
    land_sqft: number(input.row.land_sqft, "land_sqft", { nonnegative: true }),
    lot_sqft: number(input.row.lot_sqft, "lot_sqft", { nonnegative: true }),
    year_built: number(input.row.year_built, "year_built", { integer: true, nonnegative: true }),
    assessed_land: number(input.row.assessed_land, "assessed_land", { nonnegative: true }),
    assessed_improvement: number(input.row.assessed_improvement, "assessed_improvement", {
      nonnegative: true,
    }),
    market_value: number(input.row.market_value, "market_value", { nonnegative: true }),
    latitude,
    longitude,
  };
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: COOK_COUNTY_LEGACY_SOURCE_KEY,
    sourceRecordKey,
    published,
    sourceContent: sourceContent(input.row),
  });
  return {
    jurisdiction: { ...input.jurisdiction, censusGeoid: input.jurisdiction.countyFips },
    sourceRecord: baseSourceRecord({
      sourceDefinitionKey: COOK_COUNTY_LEGACY_SOURCE_KEY,
      sourceRecordKey,
      recordFingerprint,
      document: input.document,
      rowNumber: input.rowNumber,
      warnings: [
        "Legacy Cook County import does not record an authoritative identifier verification decision.",
      ],
      rawJson: { ...(input.row.raw ?? {}), ...input.row },
    }),
    propertyCandidate: {
      identifiers,
      addresses: address(published.address, published.city, published.state, published.zip),
      observations: observations([
        observation("property_type", published.property_type),
        observation("property_subtype", published.property_subtype),
        observation("land_use", published.land_use),
        observation("unit_count", published.units, "unit"),
        observation("bedroom_count", published.bedrooms, "room"),
        observation("bathroom_count", published.bathrooms, "room"),
        observation("room_count", published.rooms, "room"),
        observation("building_square_feet", published.building_sqft, "square_foot"),
        observation("land_area", published.land_sqft ?? published.lot_sqft, "square_foot"),
        observation("year_built", published.year_built, "year"),
        observation("assessed_land_value", published.assessed_land, "USD"),
        observation("assessed_improvement_value", published.assessed_improvement, "USD"),
        observation("market_value", published.market_value, "USD"),
      ]),
      latitude,
      longitude,
    },
    listing: {
      recordKind: "assessor_property",
      lifecycleState: "current_record",
      publishedStatusText: null,
      publishedOwnerText: null,
      legalDescription: null,
      publishedAmount: null,
      publishedAmountType: null,
      publishedAmountLabel: null,
    },
    resolution: propertyResolution(
      "Retain APN and PIN in Cook County scope until an approved identifier policy establishes authority.",
    ),
  };
}

function dateOnly(value: unknown, field: string) {
  const text = cleanText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} must be a real calendar date`);
  }
  return text;
}

// Ported from the source's `normalizeLegacyStLouisTaxSale`.
export async function normalizeLegacyStLouisTaxSale(
  input: LegacyRecordInput<LegacyStLouisTaxSaleRow>,
): Promise<NormalizedIntakeBundle> {
  validateJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  const saleNumber = cleanText(input.row.sale_number);
  const landTaxNumber = cleanText(input.row.land_tax_number);
  const publishedAddress = cleanText(input.row.address);
  if (!saleNumber) throw new Error("sale_number is required");
  if (!landTaxNumber) throw new Error("land_tax_number is required");
  if (!publishedAddress) throw new Error("address is required");
  const totalDue = number(input.row.total_amount, "total_amount", { nonnegative: true });
  const saleDate = dateOnly(input.row.sale_date, "sale_date");
  const sourceRecordKey = `${input.jurisdiction.countyFips}:sheriff_tax_sale:${saleNumber}:${normalizedGovernmentIdentifier(landTaxNumber)}`;
  const basePublished = {
    sale_number: saleNumber,
    land_tax_number: landTaxNumber,
    owner: cleanText(input.row.owner),
    address: publishedAddress,
    total_amount: totalDue,
    zip: cleanText(input.row.zip),
    ward: number(input.row.ward, "ward", { integer: true, nonnegative: true }),
    zoning: cleanText(input.row.zoning),
  };
  const published = saleDate === null ? basePublished : { ...basePublished, sale_date: saleDate };
  const warnings =
    cleanText(input.row.apn) === landTaxNumber
      ? [
          "Legacy APN was copied from land_tax_number and is not promoted as a cadastral identifier.",
        ]
      : [];
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisSheriffTaxSale,
    sourceRecordKey,
    published,
    sourceContent: sourceContent(input.row),
  });
  const identifiers: NormalizedIdentifierCandidate[] = [
    {
      identifierType: "tax_sale_parcel_reference",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: landTaxNumber,
      normalizedValue: normalizedGovernmentIdentifier(landTaxNumber),
      verificationStatus: "published",
      isAuthoritative: false,
    },
  ];
  const amounts: NormalizedIntakeBundle["auction"]["amounts"] =
    totalDue === null
      ? []
      : [
          {
            amountType: "total_due",
            amount: totalDue,
            currency: "USD",
            taxYear: null,
            valueStatus: "published",
            publishedLabel: "Amount owed",
          },
        ];
  const parties: NormalizedIntakeBundle["auction"]["parties"] = [
    {
      role: "administering_agency",
      publishedName: "St. Louis Sheriff",
    },
  ];
  if (published.owner) parties.push({ role: "assessed_owner", publishedName: published.owner });
  return {
    jurisdiction: { ...input.jurisdiction, censusGeoid: input.jurisdiction.countyFips },
    sourceRecord: baseSourceRecord({
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisSheriffTaxSale,
      sourceRecordKey,
      recordFingerprint,
      document: input.document,
      rowNumber: input.rowNumber,
      warnings,
      rawJson: input.row,
    }),
    propertyCandidate: {
      identifiers,
      addresses: address(publishedAddress, null, null, published.zip, "unknown_published"),
      observations: observations([
        observation("ward", published.ward),
        observation("zoning", published.zoning),
      ]),
    },
    auction: {
      eventKey: `${input.jurisdiction.countyFips}:sheriff_tax_sale:${saleNumber}`,
      eventLabel: `St. Louis Sheriff Land Tax Sale ${saleNumber}`,
      saleMechanism: "sheriff_or_judicial_sale",
      assetClass: "real_property",
      startsAt: saleDate === null ? null : `${saleDate}T00:00:00.000Z`,
      endsAt: null,
      status: "scheduled",
      lotKey: sourceRecordKey,
      publishedLotNumber: landTaxNumber,
      publishedItemNumber: null,
      publishedCertificateNumber: null,
      publishedReceiptNumber: null,
      publishedAddressText: publishedAddress,
      legalDescription: null,
      taxYears: [],
      amounts,
      parties,
      lifecycle: [
        {
          eventType: "advertised",
          effectiveAt: input.document.publishedAt ?? null,
          publishedStatusText: "Published on the Sheriff's Land Tax Sale property list",
        },
      ],
      stateForfeitedDetails: null,
    },
    extensions: [],
    resolution: {
      status: "unresolved",
      automaticMethodsAllowed: ["exact_scoped_identifier"],
      addressOnlyMatchAllowed: false,
      reason:
        "The land-tax sale number is not an APN; resolution requires a separately published parcel identifier or official crosswalk.",
    },
  };
}

// --- Backfill executor -----------------------------------------------------

export type LegacyBackfillExportRow<Row> = { rowNumber: number; row: Row };

type LegacyBackfillInput<Row extends Record<string, unknown>> = {
  // No default: a real PostgreSQL-backed transaction host -- nothing in this
  // repo constructs one (see nationwide-pg-transaction-host.ts's header).
  database: PostgresTransactionHost;
  sourceDefinitionId: string;
  jurisdictionId: string;
  rows: LegacyBackfillExportRow<Row>[];
  document: SourceDocumentReference;
  // The immutable archived copy of the export this run's rows came from
  // (e.g. nationwide-lovable-public-export.ts's `sourceArtifact`). Its
  // sha256 must match `document.sha256`.
  sourceArtifact: SnapshotArtifactEvidence;
  runKey: string;
  scheduledFor: string;
  attempt?: number;
  initiatedBy: string;
  // No default: a legacy backfill record only resolves to a canonical
  // property when a caller explicitly supplies a reviewed match strategy.
  resolveRecord?: (
    bundle: NormalizedIntakeBundle | NormalizedPropertyRecordBundle,
  ) => Promise<PropertyResolutionResult>;
};

export type ExecutedLegacyBackfill = { runId: string };

function requiredUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

function requiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function defaultUnresolved(): PropertyResolutionResult {
  return {
    status: "unresolved",
    propertyId: null,
    method: null,
    candidatePropertyIds: [],
    matchedIdentifiers: [],
    evidenceReferences: [],
    reason:
      "Legacy backfill retains the record unresolved until an approved identifier policy or official crosswalk is available.",
  };
}

// Shared fetch(already-provided) -> normalize -> resolve -> write ->
// run-store pipeline, mirroring nationwide-source-adapter-bindings.ts's
// `runSnapshotIngestion` (see this file's header for why that shared shape
// is reused instead of the source's own unported worker loop).
async function executeLegacyBackfill<
  Row extends Record<string, unknown>,
  Bundle extends NormalizedIntakeBundle | NormalizedPropertyRecordBundle,
>(options: {
  input: LegacyBackfillInput<Row>;
  sourceDefinitionKey: string;
  sourceObjectKey: (row: Row) => string;
  normalize: (
    record: LegacyBackfillExportRow<Row>,
    document: SourceDocumentReference,
  ) => Promise<Bundle>;
  write: (
    database: PostgresTransactionHost,
    args: {
      bundle: Bundle;
      sourceDefinitionId: string;
      jurisdictionId: string;
      ingestionRunId: string;
      resolution: PropertyResolutionResult;
      resolutionAlgorithmVersion: string;
    },
  ) => Promise<unknown>;
}): Promise<ExecutedLegacyBackfill> {
  const { input } = options;
  requiredUuid(input.sourceDefinitionId, "sourceDefinitionId");
  requiredUuid(input.jurisdictionId, "jurisdictionId");
  const runKey = requiredText(input.runKey, "runKey");
  const initiatedBy = requiredText(input.initiatedBy, "initiatedBy");
  const attempt = input.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer");
  }
  if (input.sourceArtifact.sha256.toLowerCase() !== input.document.sha256.toLowerCase()) {
    throw new Error("legacy source artifact SHA-256 must match the source document SHA-256");
  }
  const mergedDocument: SourceDocumentReference = {
    ...input.document,
    objectStorageKey: input.sourceArtifact.objectStorageKey,
    mimeType: input.sourceArtifact.mimeType,
    byteSize: input.sourceArtifact.byteSize,
  };

  const indexed = new Map<string, LegacyBackfillExportRow<Row>>();
  for (const record of input.rows) {
    if (!Number.isInteger(record.rowNumber) || record.rowNumber < 1) {
      throw new Error("legacy export rowNumber must be a positive integer");
    }
    const key = requiredText(options.sourceObjectKey(record.row), "sourceObjectKey");
    if (indexed.has(key))
      throw new Error(`legacy export contains duplicate source object key ${key}`);
    indexed.set(key, record);
  }
  const sourceObjectIds = [...indexed.keys()];
  const resolveRecord = input.resolveRecord ?? (async () => defaultUnresolved());

  const startedAt = input.scheduledFor;
  const discoverySha256 = await stableSha256({ runKey, sourceObjectIds });
  const started = await startSnapshotIngestionRun(input.database, {
    sourceDefinitionId: input.sourceDefinitionId,
    runKey,
    scheduledFor: input.scheduledFor,
    attempt,
    mappingVersion: 1,
    initiatedBy,
    serviceMaximum: Math.max(sourceObjectIds.length, 1),
    reportedCount: sourceObjectIds.length,
    expectedIds: sourceObjectIds,
    withdrawalMode: "append_only",
    discoveryStatus: "succeeded",
    discoveryArtifact: {
      sha256: discoverySha256,
      objectStorageKey: `legacy/${options.sourceDefinitionKey}/${runKey}/discovery.json`,
      mimeType: "application/json",
      byteSize: JSON.stringify(sourceObjectIds).length,
    },
    startedAt,
  });

  if (!started.replayed) {
    await persistSnapshotBatchResult(input.database, {
      runId: started.runId,
      batchNumber: 1,
      requestedIds: sourceObjectIds,
      returnedIds: sourceObjectIds,
      status: "succeeded",
      error: null,
      startedAt,
      completedAt: startedAt,
      artifact: {
        sha256: input.sourceArtifact.sha256,
        objectStorageKey: input.sourceArtifact.objectStorageKey,
        mimeType: input.sourceArtifact.mimeType,
        byteSize: input.sourceArtifact.byteSize,
      },
    });

    for (const key of sourceObjectIds) {
      const record = indexed.get(key);
      if (!record)
        throw new Error(`planned source object ${key} is absent from the immutable export`);
      const bundle = await options.normalize(record, mergedDocument);
      const resolution = await resolveRecord(bundle);
      await options.write(input.database, {
        bundle,
        sourceDefinitionId: input.sourceDefinitionId,
        jurisdictionId: input.jurisdictionId,
        ingestionRunId: started.runId,
        resolution,
        resolutionAlgorithmVersion: LEGACY_BACKFILL_RESOLUTION_ALGORITHM_VERSION,
      });
    }
  }

  const finalized = await finalizeSnapshotIngestionRun(input.database, {
    runId: started.runId,
    completedAt: startedAt,
  });
  return { runId: finalized.runId };
}

export function executeLegacyLraBackfill(
  input: LegacyBackfillInput<LegacyLraPropertyRow>,
): Promise<ExecutedLegacyBackfill> {
  return executeLegacyBackfill({
    input,
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisLraInventory,
    sourceObjectKey: (row) =>
      requiredText(cleanText(row.parcel_id) ?? "", "lra_properties.parcel_id"),
    normalize: (record, document) =>
      normalizeLegacyLraProperty({
        jurisdiction: ST_LOUIS_JURISDICTION,
        document,
        rowNumber: record.rowNumber,
        row: record.row,
      }),
    write: (database, args) => persistNormalizedPropertyRecordBundle(database, args),
  });
}

export function executeLegacyStLouisTaxSaleBackfill(
  input: LegacyBackfillInput<LegacyStLouisTaxSaleRow>,
): Promise<ExecutedLegacyBackfill> {
  return executeLegacyBackfill({
    input,
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisSheriffTaxSale,
    sourceObjectKey: (row) =>
      `${requiredText(cleanText(row.sale_number) ?? "", "tax_sale_properties.sale_number")}:${requiredText(cleanText(row.land_tax_number) ?? "", "tax_sale_properties.land_tax_number")}`,
    normalize: (record, document) =>
      normalizeLegacyStLouisTaxSale({
        jurisdiction: ST_LOUIS_JURISDICTION,
        document,
        rowNumber: record.rowNumber,
        row: record.row,
      }),
    write: (database, args) => persistNormalizedAuctionBundle(database, args),
  });
}

export function executeLegacyCookCountyBackfill(
  input: LegacyBackfillInput<LegacyCookCountyPropertyRow>,
): Promise<ExecutedLegacyBackfill> {
  return executeLegacyBackfill({
    input,
    sourceDefinitionKey: COOK_COUNTY_LEGACY_SOURCE_KEY,
    sourceObjectKey: (row) =>
      `${cleanText(row.source_name) ?? "legacy"}:${requiredText(cleanText(row.apn) ?? "", "cook_county_properties.apn")}`,
    normalize: (record, document) =>
      normalizeLegacyCookCountyProperty({
        jurisdiction: COOK_COUNTY_JURISDICTION,
        document,
        rowNumber: record.rowNumber,
        row: record.row,
      }),
    write: (database, args) => persistNormalizedPropertyRecordBundle(database, args),
  });
}
