// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-property-record-intake.ts:
// the "property record" (non-auction) normalizers -- the City of St. Louis
// official LRA land-bank inventory and the DeSoto County, Mississippi
// preliminary 2026 land-roll -- feeding `NormalizedPropertyRecordBundle`
// instead of `NormalizedIntakeBundle` (there is no auction event; these are
// current property records). Pure data transformation only.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  cleanText,
  normalizedGovernmentIdentifier,
  validateDocument,
  validateJurisdiction,
  type JurisdictionReference,
  type NormalizedAddressCandidate,
  type NormalizedObservation,
  type NormalizedPropertyRecordBundle,
  type SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";

export type StLouisOfficialLraFeature = Record<string, unknown> & {
  OBJECTID?: number | string | null;
  ParcelId?: string | null;
  ADDRESS?: string | null;
  Status?: string | null;
  Usage?: string | null;
  Class?: string | null;
  LegalDescription?: string | null;
  PropertyType?: string | null;
  WARD?: number | string | null;
  NEIGHBORHOOD_NUM?: number | string | null;
  ZipCode?: number | string | null;
  SQFT?: number | string | null;
  Acres?: number | string | null;
  Frontage?: number | string | null;
  NbrOfUnits?: number | string | null;
  LRA_PRICING?: number | string | null;
  AssessorsTotal?: number | string | null;
  Featured?: string | null;
  PublicNotice?: string | null;
  Environmental?: string | null;
  Deed_Restriction?: string | null;
  Underground_Storage?: string | null;
  Irregular_Lot?: string | null;
  BuriedMaterials?: string | null;
  SideLotEligible?: string | null;
  Description?: string | null;
};

export type MississippiDesotoLandrollFeature = Record<string, unknown> & {
  objectid?: number | string | null;
  pin?: string | null;
  pin_1?: string | null;
  desc_?: string | null;
  multipart?: string | null;
  acreage?: number | string | null;
  lrstid?: string | null;
  lrname?: string | null;
  lincof?: string | null;
  lrmadd?: string | null;
  lrcity?: string | null;
  lrstat?: string | null;
  lrzip?: string | number | null;
  lrsect?: string | number | null;
  lrtwn?: string | number | null;
  lrrnge?: string | number | null;
  lrtot?: number | string | null;
  lrstot?: number | string | null;
  lrtacr?: number | string | null;
  lrsubc?: string | number | null;
  lrddbk?: string | number | null;
  lrddpg?: string | number | null;
  sbname?: string | null;
  lrlot?: string | number | null;
  lrexmt?: string | number | null;
  lrdist?: string | number | null;
  physical_address?: string | null;
  partObjectIds?: number[];
  sourceFeatureCount?: number;
  conflictFields?: string[];
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
}): NormalizedPropertyRecordBundle["sourceRecord"] {
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

// Ported from the source's `normalizeStLouisOfficialLraProperty`.
export async function normalizeStLouisOfficialLraProperty(input: {
  jurisdiction: JurisdictionReference;
  document: SourceDocumentReference;
  feature: StLouisOfficialLraFeature;
}): Promise<NormalizedPropertyRecordBundle> {
  validateJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  if (input.jurisdiction.stateCode !== "MO" || input.jurisdiction.countyFips !== "29510") {
    throw new Error("official St. Louis LRA features require city county-equivalent FIPS 29510");
  }
  const objectId = number(input.feature.OBJECTID, "OBJECTID", { integer: true, nonnegative: true });
  if (objectId === null || objectId < 1)
    throw new Error("official St. Louis LRA OBJECTID must be positive");
  const parcelId = cleanText(input.feature.ParcelId);
  if (!parcelId) throw new Error("official St. Louis LRA ParcelId is required");
  const parcelNormalized = normalizedGovernmentIdentifier(parcelId);
  const status = cleanText(input.feature.Status);
  const lifecycleState =
    status
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown";
  const askingPrice = number(input.feature.LRA_PRICING, "LRA_PRICING", { nonnegative: true });
  const published = {
    parcelId,
    address: cleanText(input.feature.ADDRESS),
    status,
    usage: cleanText(input.feature.Usage),
    propertyClass: cleanText(input.feature.Class),
    legalDescription: cleanText(input.feature.LegalDescription),
    propertyType: cleanText(input.feature.PropertyType),
    ward: number(input.feature.WARD, "WARD", { integer: true, nonnegative: true }),
    neighborhood: number(input.feature.NEIGHBORHOOD_NUM, "NEIGHBORHOOD_NUM", {
      integer: true,
      nonnegative: true,
    }),
    postalCode: cleanText(input.feature.ZipCode),
    landSquareFeet: number(input.feature.SQFT, "SQFT", { nonnegative: true }),
    acres: number(input.feature.Acres, "Acres", { nonnegative: true }),
    frontage: number(input.feature.Frontage, "Frontage", { nonnegative: true }),
    units: number(input.feature.NbrOfUnits, "NbrOfUnits", { integer: true, nonnegative: true }),
    askingPrice,
    assessedValue: number(input.feature.AssessorsTotal, "AssessorsTotal", { nonnegative: true }),
    featured: boolean(input.feature.Featured),
    publicNotice: cleanText(input.feature.PublicNotice),
    environmental: cleanText(input.feature.Environmental),
    deedRestriction: cleanText(input.feature.Deed_Restriction),
    undergroundStorage: cleanText(input.feature.Underground_Storage),
    irregularLot: boolean(input.feature.Irregular_Lot),
    buriedMaterials: boolean(input.feature.BuriedMaterials),
    sideLotEligible: boolean(input.feature.SideLotEligible),
    description: cleanText(input.feature.Description),
  };
  const sourceRecordKey = `${input.jurisdiction.countyFips}:lra:${parcelNormalized}`;
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisLraInventory,
    sourceRecordKey,
    published,
    sourceContent: sourceContent(input.feature),
  });
  return {
    jurisdiction: { ...input.jurisdiction, censusGeoid: input.jurisdiction.countyFips },
    sourceRecord: baseSourceRecord({
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisLraInventory,
      sourceRecordKey,
      recordFingerprint,
      document: input.document,
      rowNumber: objectId,
      warnings: [
        "The public ArcGIS service does not provide transaction-level snapshot isolation; absence is not treated as withdrawal.",
      ],
      rawJson: input.feature,
    }),
    propertyCandidate: {
      identifiers: [
        {
          identifierType: "parcel_number",
          issuerCountyFips: input.jurisdiction.countyFips,
          rawValue: parcelId,
          normalizedValue: parcelNormalized,
          verificationStatus: "published",
          isAuthoritative: true,
        },
      ],
      addresses: address(published.address, "St. Louis", "MO", published.postalCode),
      observations: observations([
        observation("inventory_status", published.status),
        observation("land_use", published.usage),
        observation("property_type", published.propertyType),
        observation("property_class", published.propertyClass),
        observation(
          "neighborhood",
          published.neighborhood === null ? null : String(published.neighborhood),
        ),
        observation("ward", published.ward),
        observation("land_area", published.landSquareFeet, "square_foot"),
        observation("reported_acres", published.acres, "acre"),
        observation("frontage", published.frontage, "foot"),
        observation("unit_count", published.units, "unit"),
        observation("assessed_value", published.assessedValue, "USD"),
        observation("featured", published.featured),
        observation("public_notice", published.publicNotice),
        observation("environmental_note", published.environmental),
        observation("deed_restriction", published.deedRestriction),
        observation("underground_storage", published.undergroundStorage),
        observation("irregular_lot", published.irregularLot),
        observation("buried_materials", published.buriedMaterials),
        observation("side_lot_eligible", published.sideLotEligible),
      ]),
      latitude: null,
      longitude: null,
    },
    listing: {
      recordKind: "land_bank_inventory_item",
      lifecycleState,
      publishedStatusText: status,
      publishedOwnerText: null,
      legalDescription: published.legalDescription ?? published.description,
      publishedAmount: askingPrice,
      publishedAmountType: askingPrice === null ? null : "asking_price",
      publishedAmountLabel: askingPrice === null ? null : "Published city asking price",
    },
    resolution: propertyResolution(
      "Resolve only through the official county-scoped ParcelId; never match this record by address alone.",
    ),
  };
}

// Ported from the source's `normalizeMississippiDesotoLandrollProperty`.
// `feature` is expected to already be the joined, conflict-checked aggregate
// `groupStableFeatures` produces in nationwide-ms-desoto-landroll-arcgis.ts
// (the geometry-part grouping); `conflictFields` non-empty fails closed here.
export async function normalizeMississippiDesotoLandrollProperty(input: {
  jurisdiction: JurisdictionReference;
  document: SourceDocumentReference;
  feature: MississippiDesotoLandrollFeature;
}): Promise<NormalizedPropertyRecordBundle> {
  validateJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  if (input.jurisdiction.stateCode !== "MS" || input.jurisdiction.countyFips !== "28033") {
    throw new Error("official DeSoto land-roll features require county FIPS 28033");
  }
  const conflictFields = Array.isArray(input.feature.conflictFields)
    ? input.feature.conflictFields
        .map((field) => cleanText(field))
        .filter((field): field is string => Boolean(field))
    : [];
  if (conflictFields.length > 0) {
    throw new Error(
      "official DeSoto preliminary land-roll group is missing, mismatched, or conflicting",
    );
  }
  const objectId = number(input.feature.objectid, "objectid", { integer: true, nonnegative: true });
  if (objectId === null || objectId < 1)
    throw new Error("official DeSoto preliminary land-roll objectid must be positive");
  const geometryPin = cleanText(input.feature.pin);
  const landrollPin = cleanText(input.feature.pin_1);
  if (!geometryPin || !landrollPin)
    throw new Error(
      "official DeSoto preliminary land roll requires both geometry and land-roll PINs",
    );
  const geometryPinNormalized = normalizedGovernmentIdentifier(geometryPin);
  const parcelNormalized = normalizedGovernmentIdentifier(landrollPin);
  if (!geometryPinNormalized || !parcelNormalized || geometryPinNormalized !== parcelNormalized) {
    throw new Error("official DeSoto geometry PIN must equal the joined land-roll PIN");
  }
  const publishedOwner = cleanText(input.feature.lrname);
  const deedParts = [cleanText(input.feature.lrddbk), cleanText(input.feature.lrddpg)].filter(
    (value): value is string => Boolean(value),
  );
  const published = {
    taxYear: 2026,
    parcelNumber: landrollPin,
    geometryPin,
    physicalAddress: cleanText(input.feature.physical_address),
    ownerName: publishedOwner,
    inCareOf: cleanText(input.feature.lincof),
    ownerMailingAddress: cleanText(input.feature.lrmadd),
    ownerMailingCity: cleanText(input.feature.lrcity),
    ownerMailingState: cleanText(input.feature.lrstat),
    ownerMailingPostalCode: cleanText(input.feature.lrzip),
    landrollAcreage: number(input.feature.lrtacr, "lrtacr", { nonnegative: true }),
    totalAppraisedValue: number(input.feature.lrtot, "lrtot", { nonnegative: true }),
    totalAssessedValue: number(input.feature.lrstot, "lrstot", { nonnegative: true }),
    subdivision: cleanText(input.feature.sbname),
    lot: cleanText(input.feature.lrlot),
    section: cleanText(input.feature.lrsect),
    township: cleanText(input.feature.lrtwn),
    range: cleanText(input.feature.lrrnge),
    taxDistrict: cleanText(input.feature.lrdist),
    exemptionCode: cleanText(input.feature.lrexmt),
    landrollStateId: cleanText(input.feature.lrstid),
    deedReference: deedParts.length > 0 ? deedParts.join("/") : null,
  };
  if (
    !published.landrollStateId ||
    published.landrollAcreage === null ||
    published.totalAppraisedValue === null ||
    published.totalAssessedValue === null
  ) {
    throw new Error(
      "official DeSoto preliminary land roll requires its state ID, acreage, appraised total, and assessed total",
    );
  }
  const sourceRecordKey = `${input.jurisdiction.countyFips}:landroll:2026-preliminary:${parcelNormalized}`;
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiDesotoLandroll,
    sourceRecordKey,
    published,
    sourceContent: sourceContent(input.feature),
  });
  return {
    jurisdiction: { ...input.jurisdiction, censusGeoid: input.jurisdiction.countyFips },
    sourceRecord: baseSourceRecord({
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiDesotoLandroll,
      sourceRecordKey,
      recordFingerprint,
      document: input.document,
      rowNumber: objectId,
      warnings: [
        "This record is from the official preliminary 2026 land roll, not a final assessment roll.",
        "The hosted ArcGIS layer has no transaction snapshot; two complete identical reads are required and absence is not treated as withdrawal.",
        "The map PIN must exactly equal the joined land-roll PIN before this source may establish identity.",
        "Geometry acreage and description are excluded from parcel facts; LRTACR is retained as the published land-roll acreage.",
        "LRTOT and LRSTOT are retained as published appraised and assessed totals, never market or acquisition prices.",
      ],
      rawJson: input.feature,
    }),
    propertyCandidate: {
      identifiers: [
        {
          identifierType: "parcel_number",
          issuerCountyFips: input.jurisdiction.countyFips,
          rawValue: landrollPin,
          normalizedValue: parcelNormalized,
          verificationStatus: "published",
          isAuthoritative: true,
        },
      ],
      addresses: [
        ...address(published.physicalAddress, null, "MS", null, "situs"),
        ...address(
          published.ownerMailingAddress,
          published.ownerMailingCity,
          published.ownerMailingState,
          published.ownerMailingPostalCode,
          "owner_mailing",
        ),
      ],
      observations: observations([
        observation("land_area", published.landrollAcreage, "acre"),
        observation("appraised_value", published.totalAppraisedValue, "USD"),
        observation("assessed_value", published.totalAssessedValue, "USD"),
        observation("subdivision", published.subdivision),
        observation("lot", published.lot),
        observation("section", published.section),
        observation("township", published.township),
        observation("range", published.range),
        observation("tax_district", published.taxDistrict),
        observation("exemption_code", published.exemptionCode),
        observation("landroll_state_id", published.landrollStateId),
        observation("owner_in_care_of", published.inCareOf),
        observation("deed_reference", published.deedReference),
      ]),
      latitude: null,
      longitude: null,
    },
    listing: {
      recordKind: "assessor_property",
      lifecycleState: "preliminary_record",
      publishedStatusText: "Preliminary 2026 land roll",
      publishedOwnerText: publishedOwner,
      legalDescription: null,
      publishedAmount: null,
      publishedAmountType: null,
      publishedAmountLabel: null,
    },
    resolution: propertyResolution(
      "Establish identity only when the official DeSoto geometry PIN and joined 2026 preliminary land-roll PIN agree exactly.",
    ),
  };
}
