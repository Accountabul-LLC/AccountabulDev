// Slice 4 of the nationwide multi-state ingestion port. Ported VERBATIM
// (logic unchanged) from property-intelligence-app's
// app/lib/nationwide-property-search.ts: pure builders that turn a
// normalized bundle plus its resolution result into the flattened
// projection rows nationwide-postgres-writer.ts upserts into
// property_api.auction_lot_search / property_record_search / property_search.
// No network, no database.
import type {
  NormalizedAddressCandidate,
  NormalizedIntakeBundle,
  NormalizedPropertyRecordBundle,
} from "./nationwide-property-intake-types.ts";
import type {
  CanonicalPropertyIdentifier,
  PropertyResolutionResult,
} from "./nationwide-property-resolution.ts";

export type AuctionLotSearchDocument = {
  auctionLotKey: string;
  propertyId: string | null;
  resolutionStatus: PropertyResolutionResult["status"];
  stateCode: string;
  countyFips: string;
  countyName: string;
  saleMechanism: string;
  lifecycleState: string;
  eventLabel: string;
  sourceLotKey: string;
  publishedIdentifierText: string | null;
  publishedAddressText: string | null;
  publishedOwnerText: string | null;
  legalDescription: string | null;
  totalDue: number | null;
  minimumBid: number | null;
  winningBid: number | null;
  startsAt: string | null;
  endsAt: string | null;
  sourceDocumentSha256: string;
  sourceUrl: string;
  searchText: string;
};

export type CanonicalPropertySearchInput = {
  propertyId: string;
  stateCode: string;
  countyFips: string;
  countyName: string;
  identifiers: CanonicalPropertyIdentifier[];
  addresses: NormalizedAddressCandidate[];
  propertyType: string | null;
  landUse: string | null;
  buildingSquareFeet: number | null;
  landSquareFeet: number | null;
  currentMarketValue: number | null;
  currentAssessedValue: number | null;
  currentInventoryStatus: string | null;
  updatedAt: string;
};

export type PropertySearchDocument = {
  propertyId: string;
  stateCode: string;
  countyFips: string;
  countyName: string;
  primaryIdentifierType: string | null;
  primaryIdentifierValue: string | null;
  situsAddress: string | null;
  city: string | null;
  postalCode: string | null;
  propertyType: string | null;
  landUse: string | null;
  buildingSquareFeet: number | null;
  landSquareFeet: number | null;
  currentMarketValue: number | null;
  currentAssessedValue: number | null;
  currentInventoryStatus: string | null;
  searchText: string;
  updatedAt: string;
};

export type PropertyRecordSearchDocument = {
  sourceRecordKey: string;
  propertyId: string | null;
  resolutionStatus: PropertyResolutionResult["status"];
  stateCode: string;
  countyFips: string;
  countyName: string;
  recordKind: NormalizedPropertyRecordBundle["listing"]["recordKind"];
  lifecycleState: string;
  publishedIdentifierText: string | null;
  publishedAddressText: string | null;
  publishedOwnerText: string | null;
  legalDescription: string | null;
  publishedAmount: number | null;
  publishedAmountType: "asking_price" | null;
  publishedAmountLabel: string | null;
  propertyType: string | null;
  landUse: string | null;
  buildingSquareFeet: number | null;
  landSquareFeet: number | null;
  marketValue: number | null;
  assessedValue: number | null;
  latitude: number | null;
  longitude: number | null;
  sourceDocumentSha256: string;
  sourceUrl: string;
  searchText: string;
};

function searchable(parts: Array<string | number | null | undefined>) {
  return parts
    .filter(
      (part): part is string | number =>
        part !== null && part !== undefined && String(part).trim() !== "",
    )
    .map((part) => String(part).replace(/\s+/g, " ").trim().toLowerCase())
    .join(" | ");
}

export function buildAuctionLotSearchDocument(
  bundle: NormalizedIntakeBundle,
  resolution: PropertyResolutionResult,
): AuctionLotSearchDocument {
  const lifecycle = bundle.auction.lifecycle.at(-1);
  const owner =
    bundle.auction.parties.find((party) => party.role === "assessed_owner")?.publishedName ?? null;
  const identifiers = bundle.propertyCandidate.identifiers.map((identifier) => identifier.rawValue);
  const publishedIdentifierText = identifiers.length > 0 ? identifiers.join(" | ") : null;
  const totalDue =
    bundle.auction.amounts.find((item) => item.amountType === "total_due")?.amount ?? null;
  const minimumBid =
    bundle.auction.amounts.find((item) => item.amountType === "minimum_bid")?.amount ?? null;
  const winningBid =
    bundle.auction.amounts.find((item) => item.amountType === "winning_bid")?.amount ?? null;
  const propertyId = resolution.status === "resolved" ? resolution.propertyId : null;
  const searchText = searchable([
    bundle.jurisdiction.stateCode,
    bundle.jurisdiction.countyName,
    bundle.jurisdiction.countyFips,
    bundle.auction.eventLabel,
    bundle.auction.saleMechanism,
    lifecycle?.publishedStatusText,
    publishedIdentifierText,
    bundle.auction.publishedLotNumber,
    bundle.auction.publishedItemNumber,
    bundle.auction.publishedCertificateNumber,
    bundle.auction.publishedReceiptNumber,
    bundle.auction.publishedAddressText,
    owner,
    bundle.auction.legalDescription,
  ]);

  return {
    auctionLotKey: bundle.auction.lotKey,
    propertyId,
    resolutionStatus: resolution.status,
    stateCode: bundle.jurisdiction.stateCode,
    countyFips: bundle.jurisdiction.countyFips,
    countyName: bundle.jurisdiction.countyName,
    saleMechanism: bundle.auction.saleMechanism,
    lifecycleState: lifecycle?.eventType ?? "unknown",
    eventLabel: bundle.auction.eventLabel,
    sourceLotKey: bundle.auction.lotKey,
    publishedIdentifierText,
    publishedAddressText: bundle.auction.publishedAddressText,
    publishedOwnerText: owner,
    legalDescription: bundle.auction.legalDescription,
    totalDue,
    minimumBid,
    winningBid,
    startsAt: bundle.auction.startsAt,
    endsAt: bundle.auction.endsAt,
    sourceDocumentSha256: bundle.sourceRecord.sourceDocumentSha256,
    sourceUrl: bundle.sourceRecord.sourceUrl,
    searchText,
  };
}

export function buildPropertyRecordSearchDocument(
  bundle: NormalizedPropertyRecordBundle,
  resolution: PropertyResolutionResult,
): PropertyRecordSearchDocument {
  const propertyId = resolution.status === "resolved" ? resolution.propertyId : null;
  const identifiers = bundle.propertyCandidate.identifiers.map((identifier) => identifier.rawValue);
  const publishedIdentifierText = identifiers.length > 0 ? identifiers.join(" | ") : null;
  const publishedAddressText =
    bundle.propertyCandidate.addresses.find((candidate) => candidate.role === "situs")
      ?.rawAddress ??
    bundle.propertyCandidate.addresses[0]?.rawAddress ??
    null;
  const facts = new Map(
    bundle.propertyCandidate.observations.map((item) => [
      `${item.factType}:${item.unit ?? ""}`,
      item.value,
    ]),
  );
  const numericFact = (factType: string, unit: string | null = null) => {
    const value = facts.get(`${factType}:${unit ?? ""}`);
    return typeof value === "number" ? value : null;
  };
  const textFact = (factType: string) => {
    const value = facts.get(`${factType}:`);
    return typeof value === "string" ? value : null;
  };
  const assessedLand = numericFact("assessed_land_value", "USD");
  const assessedImprovement = numericFact("assessed_improvement_value", "USD");
  const assessedValue =
    assessedLand === null && assessedImprovement === null
      ? numericFact("assessed_value", "USD")
      : (assessedLand ?? 0) + (assessedImprovement ?? 0);
  return {
    sourceRecordKey: bundle.sourceRecord.sourceRecordKey,
    propertyId,
    resolutionStatus: resolution.status,
    stateCode: bundle.jurisdiction.stateCode,
    countyFips: bundle.jurisdiction.countyFips,
    countyName: bundle.jurisdiction.countyName,
    recordKind: bundle.listing.recordKind,
    lifecycleState: bundle.listing.lifecycleState,
    publishedIdentifierText,
    publishedAddressText,
    publishedOwnerText: bundle.listing.publishedOwnerText,
    legalDescription: bundle.listing.legalDescription,
    publishedAmount: bundle.listing.publishedAmount,
    publishedAmountType: bundle.listing.publishedAmountType,
    publishedAmountLabel: bundle.listing.publishedAmountLabel,
    propertyType: textFact("property_type"),
    landUse: textFact("land_use"),
    buildingSquareFeet: numericFact("building_square_feet", "square_foot"),
    landSquareFeet: numericFact("land_area", "square_foot"),
    marketValue: numericFact("market_value", "USD"),
    assessedValue,
    latitude: bundle.propertyCandidate.latitude,
    longitude: bundle.propertyCandidate.longitude,
    sourceDocumentSha256: bundle.sourceRecord.sourceDocumentSha256,
    sourceUrl: bundle.sourceRecord.sourceUrl,
    searchText: searchable([
      bundle.jurisdiction.stateCode,
      bundle.jurisdiction.countyName,
      bundle.jurisdiction.countyFips,
      bundle.listing.recordKind,
      bundle.listing.lifecycleState,
      bundle.listing.publishedStatusText,
      publishedIdentifierText,
      publishedAddressText,
      ...bundle.propertyCandidate.addresses.flatMap((candidate) => [
        candidate.rawAddress,
        candidate.city,
        candidate.stateCode,
        candidate.postalCode,
      ]),
      bundle.listing.publishedOwnerText,
      bundle.listing.legalDescription,
      bundle.listing.publishedAmount,
      bundle.listing.publishedAmountLabel,
      textFact("property_type"),
      textFact("land_use"),
      textFact("neighborhood"),
      textFact("zoning"),
    ]),
  };
}

export function buildPropertySearchDocument(
  input: CanonicalPropertySearchInput,
): PropertySearchDocument {
  const currentIdentifiers = input.identifiers.filter(
    (identifier) =>
      identifier.propertyId === input.propertyId &&
      identifier.issuerCountyFips === input.countyFips &&
      identifier.isAuthoritative &&
      identifier.validTo === null,
  );
  const primaryIdentifier =
    [...currentIdentifiers].sort((left, right) => {
      if (Boolean(left.isPreferred) !== Boolean(right.isPreferred))
        return left.isPreferred ? -1 : 1;
      return `${left.identifierType}:${left.normalizedValue}`.localeCompare(
        `${right.identifierType}:${right.normalizedValue}`,
      );
    })[0] ?? null;
  const situs = input.addresses.find((address) => address.role === "situs") ?? null;
  return {
    propertyId: input.propertyId,
    stateCode: input.stateCode,
    countyFips: input.countyFips,
    countyName: input.countyName,
    primaryIdentifierType: primaryIdentifier?.identifierType ?? null,
    primaryIdentifierValue: primaryIdentifier?.normalizedValue ?? null,
    situsAddress: situs?.rawAddress ?? null,
    city: situs?.city ?? null,
    postalCode: situs?.postalCode ?? null,
    propertyType: input.propertyType,
    landUse: input.landUse,
    buildingSquareFeet: input.buildingSquareFeet,
    landSquareFeet: input.landSquareFeet,
    currentMarketValue: input.currentMarketValue,
    currentAssessedValue: input.currentAssessedValue,
    currentInventoryStatus: input.currentInventoryStatus,
    searchText: searchable([
      input.stateCode,
      input.countyName,
      input.countyFips,
      ...currentIdentifiers.flatMap((identifier) => [
        identifier.identifierType,
        identifier.normalizedValue,
      ]),
      ...input.addresses.map((address) => address.rawAddress),
      input.propertyType,
      input.landUse,
      input.currentInventoryStatus,
    ]),
    updatedAt: input.updatedAt,
  };
}
