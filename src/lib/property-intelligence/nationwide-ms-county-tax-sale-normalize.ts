// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-property-intake.ts
// `normalizeMississippiCountyTaxSale`: the shared county tax-sale row ->
// canonical bundle normalizer the DeSoto adapter uses directly (Rankin has
// its own normalizer, ported in nationwide-ms-rankin-pdf.ts, because its
// report layout publishes different fields). Pure data transformation: no
// network, no database.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type { MississippiCountyTaxSaleRow } from "./nationwide-ms-desoto-pdf.ts";
import {
  auctionAmount,
  cleanText,
  isoDateFromPublished,
  joinLines,
  jurisdictionWithGeoid,
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  normalizedGovernmentIdentifier,
  nonnegativeMoney,
  requiredNonnegativeMoney,
  resolutionForIdentifiers,
  validateDocument,
  validateMississippiJurisdiction,
  type NormalizedAuctionAmount,
  type NormalizedIdentifierCandidate,
  type NormalizedIntakeBundle,
} from "./nationwide-property-intake-types.ts";

const COUNTY_TAX_SALE_SOURCE_KEY = NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiCountyTaxSale;

export async function normalizeMississippiCountyTaxSale(
  input: MississippiCountyTaxSaleRow,
): Promise<NormalizedIntakeBundle> {
  validateMississippiJurisdiction(input.jurisdiction);
  validateDocument(input.document);
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1)
    throw new Error("pageNumber must be a positive integer");
  if (!Number.isInteger(input.rowNumber) || input.rowNumber < 1)
    throw new Error("rowNumber must be a positive integer");
  if (!isoDateFromPublished(input.saleDate)) throw new Error("saleDate is invalid");
  if (!isoDateFromPublished(input.reportDate)) throw new Error("reportDate is invalid");
  if (!Number.isInteger(input.taxYear) || input.taxYear < 1800)
    throw new Error("taxYear is invalid");

  const rawParcelReference = input.publishedParcelParts
    .map((part) => cleanText(part))
    .filter((part): part is string => Boolean(part))
    .join(" ");
  if (!rawParcelReference)
    throw new Error("at least one published parcel-reference part is required");
  const normalizedParcelReference = normalizedGovernmentIdentifier(rawParcelReference);
  const receiptNumber = cleanText(input.receiptNumber);
  if (!receiptNumber) throw new Error("receiptNumber is required");

  const taxesDue = requiredNonnegativeMoney(input.taxesDue, "taxesDue");
  const interest = requiredNonnegativeMoney(input.interest, "interest");
  const penalty = nonnegativeMoney(input.penalty, "penalty");
  const printerFee = nonnegativeMoney(input.printerFee, "printerFee");
  const recordingFee = nonnegativeMoney(input.recordingFee, "recordingFee");
  const totalDue = requiredNonnegativeMoney(input.totalDue, "totalDue");
  const bidExcess = nonnegativeMoney(input.bidExcess, "bidExcess");

  const warnings: string[] = [];
  const componentTotal = [taxesDue, interest, penalty, printerFee, recordingFee].reduce<number>(
    (sum, component) => sum + (component ?? 0),
    0,
  );
  if (Math.abs(componentTotal - totalDue) > 0.01) {
    warnings.push(
      `Published amount components total ${componentTotal.toFixed(2)} but published total due is ${totalDue.toFixed(2)}.`,
    );
  }

  const sourceRecordKey = [
    input.jurisdiction.countyFips,
    input.saleDate,
    normalizedParcelReference,
    input.taxYear,
    normalizedGovernmentIdentifier(receiptNumber),
  ].join(":");
  const fingerprint = await stableSha256({
    sourceDefinitionKey: COUNTY_TAX_SALE_SOURCE_KEY,
    sourceRecordKey,
    saleDate: input.saleDate,
    reportDate: input.reportDate,
    publishedParcelParts: input.publishedParcelParts,
    assessedOwnerName: input.assessedOwnerName,
    ownerMailingAddressLines: input.ownerMailingAddressLines,
    descriptionLines: input.descriptionLines,
    receiptNumber: input.receiptNumber,
    taxYear: input.taxYear,
    taxesDue,
    interest,
    penalty,
    printerFee,
    recordingFee,
    totalDue,
    bidExcess,
    disposition: input.disposition,
    purchaserName: input.purchaserName,
    homesteadChargeback: input.homesteadChargeback ?? false,
    raw: input.raw,
  });
  const ownerAddress = joinLines(input.ownerMailingAddressLines);
  const legalDescription = joinLines(input.descriptionLines);
  const identifiers: NormalizedIdentifierCandidate[] = [
    {
      identifierType: "tax_sale_parcel_reference",
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: rawParcelReference,
      normalizedValue: normalizedParcelReference,
      verificationStatus: "published",
      isAuthoritative: false,
    },
  ];
  const amounts = [
    auctionAmount("taxes", "Taxes due", taxesDue, input.taxYear),
    auctionAmount("interest", "Interest", interest, input.taxYear),
    auctionAmount("penalty", "Penalty", penalty, input.taxYear),
    auctionAmount("publication_fee", "Printer fees", printerFee, input.taxYear),
    auctionAmount("recording_fee", "Recording fees", recordingFee, input.taxYear),
    auctionAmount("total_due", "Total due", totalDue, input.taxYear),
    auctionAmount("bid_excess", "Bid excess", bidExcess, input.taxYear),
  ].filter((item): item is NormalizedAuctionAmount => item !== null);

  return {
    jurisdiction: jurisdictionWithGeoid(input.jurisdiction),
    sourceRecord: {
      sourceDefinitionKey: COUNTY_TAX_SALE_SOURCE_KEY,
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
      sourceUrl: input.document.url,
      documentTitle: input.document.title,
      pageLocator: `page:${input.pageNumber}`,
      rowLocator: `row:${input.rowNumber}`,
      featureLocator: null,
      parsingStatus: warnings.length > 0 ? "partial" : "accepted",
      warnings,
      rawJson: input.raw,
    },
    propertyCandidate: {
      identifiers,
      addresses: ownerAddress
        ? [
            {
              role: "owner_mailing",
              rawAddress: ownerAddress,
              city: null,
              stateCode: null,
              postalCode: null,
              verificationStatus: "published",
            },
          ]
        : [],
      observations: [],
    },
    auction: {
      eventKey: `${COUNTY_TAX_SALE_SOURCE_KEY}:${input.jurisdiction.countyFips}:${input.saleDate}`,
      eventLabel: `${input.jurisdiction.countyName} County ${input.saleDate.slice(0, 4)} land tax sale`,
      saleMechanism: "redeemable_tax_deed",
      assetClass: "real_property",
      startsAt: isoDateFromPublished(input.saleDate),
      endsAt: null,
      status: "completed",
      lotKey: sourceRecordKey,
      publishedLotNumber: null,
      publishedItemNumber: null,
      publishedCertificateNumber: null,
      publishedReceiptNumber: receiptNumber,
      publishedAddressText: null,
      legalDescription,
      taxYears: [input.taxYear],
      amounts,
      parties: [
        {
          role: "assessed_owner",
          publishedName: cleanText(input.assessedOwnerName) ?? "Not published",
        },
        { role: "purchaser", publishedName: cleanText(input.purchaserName) ?? "Not published" },
        {
          role: "administering_agency",
          publishedName: `${input.jurisdiction.countyName} County Tax Collector`,
        },
      ],
      lifecycle: [
        {
          eventType: input.disposition === "Sold To the State" ? "struck_to_state" : "sold",
          effectiveAt: isoDateFromPublished(input.saleDate),
          publishedStatusText: input.disposition,
        },
      ],
      stateForfeitedDetails: null,
    },
    extensions: input.homesteadChargeback
      ? [{ key: "ms_homestead_chargeback", value: true, verificationStatus: "published" }]
      : [],
    resolution: resolutionForIdentifiers(identifiers),
  };
}
