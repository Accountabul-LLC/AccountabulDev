// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-property-intake.ts
// `normalizeMississippiSosInventory`: the Mississippi Secretary of State
// active tax-forfeited-property inventory feature -> canonical auction-lot
// bundle normalizer. Pure data transformation only.
import {
  auctionAmount,
  cleanText,
  finiteNumber,
  isoDateFromPublished,
  jurisdictionWithGeoid,
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  nonnegativeMoney,
  normalizedGovernmentIdentifier,
  positiveIntegerOrNull,
  uniqueIdentifiers,
  validateDocument,
  validateMississippiJurisdiction,
  type JurisdictionReference,
  type NormalizedAuctionAmount,
  type NormalizedAuctionParty,
  type NormalizedIntakeBundle,
  type NormalizedLifecycleEvent,
  type NormalizedObservation,
  type SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";
import { stableSha256 } from "./nationwide-fingerprint.ts";

export type MississippiSosFeature = Record<string, unknown> & {
  objectid?: number | string | null;
  parcel_id?: number | string | null;
  sosparid?: number | string | null;
  parcel_number?: string | null;
  sosparno?: string | null;
  ppin_number?: string | null;
  sosppin?: string | null;
  county?: string | null;
  parcel_status_description?: string | null;
  legal_description?: string | null;
  certificate_number?: string | null;
  sale_date?: number | string | null;
  certificatetaxyear?: number | string | null;
  assessedownercompany?: string | null;
  assessedownerprefix?: string | null;
  assessedownerfirst?: string | null;
  assessedownermiddle?: string | null;
  assessedownerlast?: string | null;
  assessedownersuffix?: string | null;
  market_value?: number | string | null;
  propertyaddress?: string | null;
  street_line_1?: string | null;
  street_line_2?: string | null;
  city?: string | null;
  state_abbreviation?: string | null;
  zip?: string | null;
  section_number?: string | null;
  township_number?: string | null;
  township_direction?: string | null;
  range_number?: string | null;
  range_direction?: string | null;
  lot?: string | null;
  block?: string | null;
  subdivision?: string | null;
  acres?: number | string | null;
  square_feet?: number | string | null;
  sumoftaxfees?: number | string | null;
  activeapplications?: number | string | null;
  pendingreviewapplications?: number | string | null;
  blighted?: number | string | null;
  tidelands?: number | string | null;
  patentdate?: string | null;
  strike_date?: string | null;
  strike_reason_description?: string | null;
  municipality_name?: string | null;
  school_district_name?: string | null;
  soscontactname?: string | null;
  link?: string | null;
};

export type MississippiSosInventoryRecord = {
  jurisdiction: JurisdictionReference;
  document: SourceDocumentReference;
  feature: MississippiSosFeature;
};

const SOS_INVENTORY_SOURCE_KEY = NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiSosInventory;

function firstPublishedIdentifier(
  feature: MississippiSosFeature,
  keys: Array<keyof MississippiSosFeature>,
) {
  for (const key of keys) {
    const value = cleanText(feature[key]);
    if (value && normalizedGovernmentIdentifier(value) !== "0") return value;
  }
  return null;
}

function assessedOwnerName(feature: MississippiSosFeature): string | null {
  const company = cleanText(feature.assessedownercompany);
  const person = [
    cleanText(feature.assessedownerprefix),
    cleanText(feature.assessedownerfirst),
    cleanText(feature.assessedownermiddle),
    cleanText(feature.assessedownerlast),
    cleanText(feature.assessedownersuffix),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return company ?? (person || null);
}

function sourceLink(link: unknown, fallback: string) {
  const published = cleanText(link);
  if (!published) return fallback;
  if (/^https:\/\//i.test(published)) return published;
  return `https://${published.replace(/^\/+/, "")}`;
}

function truthyPublished(value: unknown): boolean | null {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return null;
}

function joinNonBlank(values: string[]) {
  const parts = values.filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
}

export async function normalizeMississippiSosInventory(
  input: MississippiSosInventoryRecord,
): Promise<NormalizedIntakeBundle> {
  validateMississippiJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  const feature = input.feature;
  const featureIdentity = firstPublishedIdentifier(feature, ["parcel_id", "sosparid", "objectid"]);
  if (!featureIdentity)
    throw new Error("SOS feature must publish parcel_id, sosparid, or objectid");
  const featureObjectId = cleanText(feature.objectid);
  const sourceRecordKey = `state-inventory-parcel:${input.jurisdiction.countyFips}:${normalizedGovernmentIdentifier(featureIdentity)}`;
  const fingerprint = await stableSha256({
    sourceDefinitionKey: SOS_INVENTORY_SOURCE_KEY,
    sourceRecordKey,
    raw: feature,
  });

  const parcelNumber = firstPublishedIdentifier(feature, ["parcel_number", "sosparno"]);
  const ppin = firstPublishedIdentifier(feature, ["ppin_number", "sosppin"]);
  const identifiers = uniqueIdentifiers([
    ...(parcelNumber
      ? [
          {
            identifierType: "parcel_number" as const,
            issuerCountyFips: input.jurisdiction.countyFips,
            rawValue: parcelNumber,
            normalizedValue: normalizedGovernmentIdentifier(parcelNumber),
            verificationStatus: "published" as const,
            isAuthoritative: false,
          },
        ]
      : []),
    ...(ppin
      ? [
          {
            identifierType: "ppin" as const,
            issuerCountyFips: input.jurisdiction.countyFips,
            rawValue: ppin,
            normalizedValue: normalizedGovernmentIdentifier(ppin),
            verificationStatus: "published" as const,
            isAuthoritative: false,
          },
        ]
      : []),
  ]);

  const warnings: string[] = [];
  if (
    cleanText(feature.county)?.toLowerCase() !== input.jurisdiction.countyName.trim().toLowerCase()
  ) {
    warnings.push("Published county name does not match the registered county jurisdiction.");
  }
  const marketValue = nonnegativeMoney(feature.market_value, "market_value");
  const taxFees = nonnegativeMoney(feature.sumoftaxfees, "sumoftaxfees");
  const activeApplications = positiveIntegerOrNull(
    feature.activeapplications,
    "activeapplications",
  );
  const pendingApplications = positiveIntegerOrNull(
    feature.pendingreviewapplications,
    "pendingreviewapplications",
  );
  const acres = finiteNumber(feature.acres, "acres");
  const squareFeet = finiteNumber(feature.square_feet, "square_feet");
  const saleDate = isoDateFromPublished(feature.sale_date);
  const taxYear = positiveIntegerOrNull(feature.certificatetaxyear, "certificatetaxyear");
  const publishedStatus = cleanText(feature.parcel_status_description) ?? "Status not published";
  const patentDate = isoDateFromPublished(feature.patentdate);
  const strikeDate = isoDateFromPublished(feature.strike_date);
  const publishedAddress =
    cleanText(feature.propertyaddress) ??
    joinNonBlank([
      cleanText(feature.street_line_1) ?? "",
      cleanText(feature.street_line_2) ?? "",
      [cleanText(feature.city), cleanText(feature.state_abbreviation), cleanText(feature.zip)]
        .filter(Boolean)
        .join(" "),
    ]);

  let lifecycle: NormalizedLifecycleEvent;
  if (patentDate) {
    lifecycle = {
      eventType: "patented_or_deeded",
      effectiveAt: patentDate,
      publishedStatusText: publishedStatus,
    };
  } else if (strikeDate) {
    lifecycle = {
      eventType: "removed",
      effectiveAt: strikeDate,
      publishedStatusText: cleanText(feature.strike_reason_description) ?? publishedStatus,
    };
  } else if (publishedStatus.toLowerCase() === "active") {
    lifecycle = {
      eventType: "available_for_application",
      effectiveAt: null,
      publishedStatusText: publishedStatus,
    };
  } else {
    lifecycle = {
      eventType: "forfeited_to_state",
      effectiveAt: saleDate,
      publishedStatusText: publishedStatus,
    };
  }

  const observations: NormalizedObservation[] = [];
  if (marketValue !== null) {
    observations.push({
      factType: "market_value",
      value: marketValue,
      unit: "USD",
      effectiveDate: null,
      verificationStatus: "published",
      derivationMethod: null,
    });
  }
  if (acres !== null) {
    observations.push({
      factType: "land_area",
      value: acres,
      unit: "acre",
      effectiveDate: null,
      verificationStatus: "published",
      derivationMethod: null,
    });
  }
  if (squareFeet !== null) {
    observations.push({
      factType: "land_area",
      value: squareFeet,
      unit: "square_foot",
      effectiveDate: null,
      verificationStatus: "published",
      derivationMethod: null,
    });
  }

  const extensions: NormalizedIntakeBundle["extensions"] = [];
  const extensionValues: Array<[string, string | number | boolean | null]> = [
    ["ms_section", cleanText(feature.section_number)],
    [
      "ms_township",
      [cleanText(feature.township_number), cleanText(feature.township_direction)]
        .filter(Boolean)
        .join("") || null,
    ],
    [
      "ms_range",
      [cleanText(feature.range_number), cleanText(feature.range_direction)]
        .filter(Boolean)
        .join("") || null,
    ],
    ["subdivision", cleanText(feature.subdivision)],
    ["lot", cleanText(feature.lot)],
    ["block", cleanText(feature.block)],
    ["municipality_name", cleanText(feature.municipality_name)],
    ["school_district_name", cleanText(feature.school_district_name)],
    ["ms_blighted", truthyPublished(feature.blighted)],
    ["ms_tidelands", truthyPublished(feature.tidelands)],
  ];
  extensionValues.forEach(([key, value]) => {
    if (value !== null && value !== "")
      extensions.push({ key, value, verificationStatus: "published" });
  });

  const owner = assessedOwnerName(feature);
  const contact = cleanText(feature.soscontactname);
  const amounts = [auctionAmount("total_due", "Sum of tax and fees", taxFees, taxYear)].filter(
    (item): item is NormalizedAuctionAmount => item !== null,
  );
  const parties: NormalizedAuctionParty[] = [
    ...(owner ? [{ role: "assessed_owner" as const, publishedName: owner }] : []),
    {
      role: "administering_agency",
      publishedName: "Mississippi Secretary of State Public Lands Division",
    },
    ...(contact ? [{ role: "contact" as const, publishedName: contact }] : []),
  ];

  return {
    jurisdiction: jurisdictionWithGeoid(input.jurisdiction),
    sourceRecord: {
      sourceDefinitionKey: SOS_INVENTORY_SOURCE_KEY,
      sourceRecordKey,
      sourceVersion: "1",
      recordFingerprint: fingerprint,
      sourceDocumentSha256: input.document.sha256.toLowerCase(),
      sourceDocumentUrl: input.document.url,
      sourceDocumentRetrievedAt: new Date(input.document.retrievedAt).toISOString(),
      sourceDocumentPublishedAt: input.document.publishedAt
        ? new Date(input.document.publishedAt).toISOString()
        : null,
      sourceDocumentObjectStorageKey: input.document.objectStorageKey ?? null,
      sourceDocumentMimeType: input.document.mimeType ?? null,
      sourceDocumentByteSize: input.document.byteSize ?? null,
      sourceUrl: sourceLink(feature.link, input.document.url),
      documentTitle: input.document.title,
      pageLocator: null,
      rowLocator: `feature:${featureIdentity}`,
      featureLocator: featureObjectId ? `objectid:${featureObjectId}` : null,
      parsingStatus: warnings.length > 0 ? "partial" : "accepted",
      warnings,
      rawJson: feature,
    },
    propertyCandidate: {
      identifiers,
      addresses: publishedAddress
        ? [
            {
              role: "situs",
              rawAddress: publishedAddress,
              city: cleanText(feature.city),
              stateCode: cleanText(feature.state_abbreviation),
              postalCode: cleanText(feature.zip),
              verificationStatus: "published",
            },
          ]
        : [],
      observations,
    },
    auction: {
      eventKey: `${SOS_INVENTORY_SOURCE_KEY}:active`,
      eventLabel: "Mississippi active tax-forfeited inventory",
      saleMechanism: "state_forfeited_inventory",
      assetClass: "real_property",
      startsAt: null,
      endsAt: null,
      status: "active_inventory",
      lotKey: sourceRecordKey,
      publishedLotNumber: null,
      publishedItemNumber: featureIdentity,
      publishedCertificateNumber: cleanText(feature.certificate_number),
      publishedReceiptNumber: null,
      publishedAddressText: publishedAddress,
      legalDescription: cleanText(feature.legal_description),
      taxYears: taxYear === null ? [] : [taxYear],
      amounts,
      parties,
      lifecycle: [lifecycle],
      stateForfeitedDetails: {
        certifiedMarketValue: marketValue,
        backTaxTotal: taxFees,
        activeApplicationCount: activeApplications,
        pendingReviewApplicationCount: pendingApplications,
        patentStatus: patentDate ? "patented_or_deeded" : cleanText(feature.patentdate),
      },
    },
    extensions,
    resolution:
      identifiers.length === 0
        ? {
            status: "unresolved",
            automaticMethodsAllowed: [],
            addressOnlyMatchAllowed: false,
            reason:
              "No jurisdiction-scoped property identifier was published; retain the lot as searchable and unresolved.",
          }
        : {
            status: "candidate",
            automaticMethodsAllowed: ["exact_scoped_identifier"],
            addressOnlyMatchAllowed: false,
            reason:
              "Resolve only against the exact normalized identifier in the same issuing county or an approved official crosswalk.",
          },
  };
}
