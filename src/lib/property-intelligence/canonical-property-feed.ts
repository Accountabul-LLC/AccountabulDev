import type {
  PropertyPayload,
  PropertyRecord,
  PropertyRecordCategory,
  PropertySearchAmountFilter,
  PropertySearchRequest,
  PropertySearchSort,
  RelatedPropertyRecord,
  SearchablePropertyAttribute,
  SourceState,
} from "./property-data.ts";
import { US_STATE_CATALOG } from "./us-state-catalog.ts";
import { UUID_V1_TO_V8 as UUID_PATTERN } from "../validation/patterns.ts";

const PAGE_SIZE = 1000;
const MAX_PARALLEL_PAGES = 4;
const PROPERTY_API_SCHEMA = "property_api";
const MAX_SEARCH_PAGE_SIZE = 75;

type ApiRow = Record<string, unknown>;

type TablePage = {
  rows: ApiRow[];
  total: number | null;
};

type CompleteTable = {
  rows: ApiRow[];
  total: number;
};

type TableContract = {
  table: "property_search" | "property_record_search" | "auction_lot_search";
  select: string;
  order: string;
  filters?: Record<string, string>;
};

export type CanonicalPropertyFeedConfig = {
  supabaseUrl: string;
  anonKey: string;
};

const PROPERTY_FIELDS = [
  "property_id",
  "jurisdiction_id",
  "state_code",
  "county_fips",
  "county_name",
  "primary_identifier_type",
  "primary_identifier_value",
  "situs_address",
  "city",
  "postal_code",
  "property_type",
  "land_use",
  "building_square_feet",
  "land_square_feet",
  "current_market_value",
  "current_assessed_value",
  "current_inventory_status",
  "searchable_attributes",
  "updated_at",
].join(",");

const PROPERTY_RECORD_FIELDS = [
  "source_definition_id",
  "source_record_key",
  "source_record_id",
  "property_id",
  "resolution_status",
  "jurisdiction_id",
  "state_code",
  "county_fips",
  "county_name",
  "record_kind",
  "lifecycle_state",
  "published_identifier_text",
  "published_address_text",
  "published_owner_text",
  "legal_description",
  "published_amount",
  "published_amount_type",
  "published_amount_label",
  "property_type",
  "land_use",
  "building_square_feet",
  "land_square_feet",
  "market_value",
  "assessed_value",
  "source_document_id",
  "source_document_title",
  "source_url",
  "withdrawn_at",
  "searchable_attributes",
  "updated_at",
].join(",");

const AUCTION_FIELDS = [
  "auction_lot_id",
  "source_definition_id",
  "source_record_id",
  "property_id",
  "resolution_status",
  "jurisdiction_id",
  "state_code",
  "county_fips",
  "county_name",
  "sale_mechanism",
  "asset_class",
  "lifecycle_state",
  "event_label",
  "source_lot_key",
  "published_identifier_text",
  "published_address_text",
  "published_owner_text",
  "legal_description",
  "total_due",
  "minimum_bid",
  "winning_bid",
  "starts_at",
  "ends_at",
  "source_document_id",
  "source_document_title",
  "source_url",
  "searchable_attributes",
  "updated_at",
].join(",");

const TABLES: TableContract[] = [
  { table: "property_search", select: PROPERTY_FIELDS, order: "property_id.asc" },
  {
    table: "property_record_search",
    select: PROPERTY_RECORD_FIELDS,
    order: "source_definition_id.asc,source_record_key.asc",
    filters: { withdrawn_at: "is.null" },
  },
  {
    table: "auction_lot_search",
    select: AUCTION_FIELDS,
    order: "auction_lot_id.asc",
    filters: {
      asset_class: "in.(real_property,mixed)",
      lifecycle_state: "not.in.(removed,withdrawn)",
    },
  },
];

const cleanText = (input: unknown) => {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const value = String(input).replace(/\s+/g, " ").trim();
  return value || null;
};

const numberOrNull = (input: unknown) => {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const normalized = input.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

function searchableAttributes(input: unknown): SearchablePropertyAttribute[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  return Object.entries(input)
    .flatMap(([key, candidate]) => {
      if (!/^[a-z][a-z0-9_]{0,127}$/.test(key)) return [];
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
        return [];
      const item = candidate as Record<string, unknown>;
      const label = cleanText(item["label"]);
      const unit =
        item["unit"] === null || item["unit"] === undefined ? null : cleanText(item["unit"]);
      const value = item["value"];
      if (
        !label ||
        (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      )
        return [];
      if (typeof value === "number" && !Number.isFinite(value)) return [];
      if (typeof value === "string" && !value.trim()) return [];
      return [{ key, label, value, unit }];
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function attributeNotice(attribute: SearchablePropertyAttribute) {
  const value =
    typeof attribute.value === "boolean"
      ? attribute.value
        ? "Yes"
        : "No"
      : String(attribute.value);
  return `${attribute.label}: ${value}${attribute.unit ? ` ${attribute.unit}` : ""}`;
}

const stateName = (stateCode: string) =>
  US_STATE_CATALOG.find((entry) => entry.stateCode === stateCode)?.stateName ??
  "State not published";

const contentRangeTotal = (value: string | null) => {
  const match = value?.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
};

function validateConfig(config: CanonicalPropertyFeedConfig) {
  if (!config.supabaseUrl.trim())
    throw new Error("The canonical property database URL is missing.");
  if (!config.anonKey.trim()) throw new Error("The canonical property database key is missing.");
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error("The canonical property database URL is not an approved Supabase endpoint.");
  }
  return url.origin;
}

async function fetchTablePage(
  config: CanonicalPropertyFeedConfig,
  contract: TableContract,
  offset: number,
  fetchImpl: typeof fetch,
): Promise<TablePage> {
  const origin = validateConfig(config);
  const url = new URL(`/rest/v1/${contract.table}`, origin);
  url.searchParams.set("select", contract.select);
  url.searchParams.set("order", contract.order);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  for (const [field, value] of Object.entries(contract.filters ?? {})) {
    url.searchParams.set(field, value);
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "accept-profile": PROPERTY_API_SCHEMA,
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Canonical property API returned ${response.status} for ${contract.table}.`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error(`Canonical property API returned an invalid ${contract.table} page.`);
  }
  return {
    rows: rows as ApiRow[],
    total: contentRangeTotal(response.headers.get("content-range")),
  };
}

async function fetchCompleteTable(
  config: CanonicalPropertyFeedConfig,
  contract: TableContract,
  fetchImpl: typeof fetch,
): Promise<CompleteTable> {
  const first = await fetchTablePage(config, contract, 0, fetchImpl);
  if (first.rows.length < PAGE_SIZE && (first.total === null || first.total <= PAGE_SIZE)) {
    return { rows: first.rows, total: first.total ?? first.rows.length };
  }

  const rows = [...first.rows];
  if (first.total === null) {
    for (let offset = PAGE_SIZE; ; offset += PAGE_SIZE) {
      const page = await fetchTablePage(config, contract, offset, fetchImpl);
      rows.push(...page.rows);
      if (page.rows.length < PAGE_SIZE) break;
    }
    return { rows, total: rows.length };
  }

  const offsets = Array.from(
    { length: Math.max(0, Math.ceil(first.total / PAGE_SIZE) - 1) },
    (_, index) => (index + 1) * PAGE_SIZE,
  );
  for (let start = 0; start < offsets.length; start += MAX_PARALLEL_PAGES) {
    const pages = await Promise.all(
      offsets
        .slice(start, start + MAX_PARALLEL_PAGES)
        .map((offset) => fetchTablePage(config, contract, offset, fetchImpl)),
    );
    pages.forEach((page) => rows.push(...page.rows));
  }
  if (rows.length !== first.total) {
    throw new Error(
      `Canonical property API returned ${rows.length} of ${first.total} ${contract.table} rows.`,
    );
  }
  return { rows, total: first.total };
}

type PropertyEnrichment = {
  propertyId: string;
  address: string;
  city: string;
  stateCode: string;
  stateName: string;
  countyName: string;
  countyFips: string;
  postalCode: string | null;
  identifierType: string | null;
  identifierValue: string | null;
  propertyType: string | null;
  landUse: string | null;
  buildingSquareFeet: number | null;
  landSquareFeet: number | null;
  marketValue: number | null;
  assessedValue: number | null;
  inventoryStatus: string | null;
  searchableAttributes: SearchablePropertyAttribute[];
  updatedAt: string;
};

function enrichment(row: ApiRow): PropertyEnrichment {
  const stateCode = cleanText(row["state_code"]) ?? "Not published";
  return {
    propertyId: cleanText(row["property_id"]) ?? "unidentified",
    address: cleanText(row["situs_address"]) ?? "Address not published",
    city: cleanText(row["city"]) ?? "City not published",
    stateCode,
    stateName: stateName(stateCode),
    countyName: cleanText(row["county_name"]) ?? "County not published",
    countyFips: cleanText(row["county_fips"]) ?? "County FIPS not published",
    postalCode: cleanText(row["postal_code"]),
    identifierType: cleanText(row["primary_identifier_type"]),
    identifierValue: cleanText(row["primary_identifier_value"]),
    propertyType: cleanText(row["property_type"]),
    landUse: cleanText(row["land_use"]),
    buildingSquareFeet: numberOrNull(row["building_square_feet"]),
    landSquareFeet: numberOrNull(row["land_square_feet"]),
    marketValue: numberOrNull(row["current_market_value"]),
    assessedValue: numberOrNull(row["current_assessed_value"]),
    inventoryStatus: cleanText(row["current_inventory_status"]),
    searchableAttributes: searchableAttributes(row["searchable_attributes"]),
    updatedAt: cleanText(row["updated_at"]) ?? "Update time not published",
  };
}

function fallbackGeography(row: ApiRow, linked?: PropertyEnrichment) {
  const stateCode = cleanText(row["state_code"]) ?? linked?.stateCode ?? "Not published";
  return {
    address: cleanText(row["published_address_text"]) ?? linked?.address ?? "Address not published",
    city: linked?.city ?? "City not published",
    stateCode,
    stateName: stateName(stateCode),
    countyName: cleanText(row["county_name"]) ?? linked?.countyName ?? "County not published",
    countyFips: cleanText(row["county_fips"]) ?? linked?.countyFips ?? "County FIPS not published",
    zipCode: linked?.postalCode ?? null,
  };
}

function recordCategory(recordKind: unknown): PropertyRecordCategory {
  const kind = cleanText(recordKind)?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_") ?? "";
  if (kind.includes("assessor") || kind.includes("assessment")) return "Assessor record";
  if (/(inventory|land_bank|city_owned|forfeited)/.test(kind)) return "Public inventory";
  return "Property record";
}

function resolutionNotice(row: ApiRow) {
  const status = cleanText(row["resolution_status"]);
  if (!status || status === "resolved") return null;
  return `Property identity: ${status.replaceAll("_", " ")}`;
}

function sourceDocumentNotice(row: ApiRow) {
  const title = cleanText(row["source_document_title"]);
  return title ? `Source document: ${title}` : null;
}

function moneyNotice(label: string, value: unknown) {
  const amount = numberOrNull(value);
  return amount === null
    ? null
    : `${label}: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)}`;
}

export function mapCanonicalProperty(row: ApiRow): PropertyRecord {
  const property = enrichment(row);
  const recordNumber = property.identifierValue ?? property.propertyId;
  return {
    id: `canonical-property:${property.propertyId}`,
    canonicalPropertyId: property.propertyId,
    source: "Canonical property",
    recordCategory: "Property record",
    relatedRecords: [],
    address: property.address,
    city: property.city,
    stateCode: property.stateCode,
    stateName: property.stateName,
    countyName: property.countyName,
    countyFips: property.countyFips,
    status: property.inventoryStatus ?? "Canonical property record",
    price: null,
    priceLabel: "No acquisition amount published",
    recordNumber,
    parcelId: property.identifierValue,
    owner: null,
    ward: null,
    neighborhood: null,
    zipCode: property.postalCode,
    squareFeet: property.landSquareFeet,
    buildingSquareFeet: property.buildingSquareFeet,
    acres: property.landSquareFeet === null ? null : property.landSquareFeet / 43_560,
    frontage: null,
    units: null,
    propertyType: property.propertyType,
    usage: property.landUse,
    description: null,
    assessorValue: property.assessedValue,
    marketValue: property.marketValue,
    featured: false,
    notices: [
      property.identifierType ? `Primary identifier type: ${property.identifierType}` : null,
      ...property.searchableAttributes.map(attributeNotice),
      "Market and assessed values are reference facts, not acquisition prices.",
    ].filter((notice): notice is string => Boolean(notice)),
    searchableAttributes: property.searchableAttributes,
    sourceUrl: "https://accountabul.com/property-intelligence",
    sourceUpdated: property.updatedAt,
  };
}

export function mapCanonicalPropertyRecord(
  row: ApiRow,
  linked?: PropertyEnrichment,
): PropertyRecord {
  const geography = fallbackGeography(row, linked);
  const sourceDefinitionId = cleanText(row["source_definition_id"]) ?? "unknown-source";
  const sourceRecordKey =
    cleanText(row["source_record_key"]) ?? cleanText(row["source_record_id"]) ?? "unknown-record";
  const recordNumber = cleanText(row["published_identifier_text"]) ?? sourceRecordKey;
  const landSquareFeet = numberOrNull(row["land_square_feet"]) ?? linked?.landSquareFeet ?? null;
  const publishedAmount = numberOrNull(row["published_amount"]);
  const publishedAmountType = cleanText(row["published_amount_type"]);
  const publishedAmountLabel =
    cleanText(row["published_amount_label"]) ??
    (publishedAmountType === "asking_price" ? "Published asking price" : null);
  const attributes = searchableAttributes(row["searchable_attributes"]);
  return {
    id: `canonical-record:${sourceDefinitionId}:${sourceRecordKey}`,
    canonicalPropertyId: cleanText(row["property_id"]),
    source: "Public record",
    recordCategory: recordCategory(row["record_kind"]),
    relatedRecords: [],
    ...geography,
    status: cleanText(row["lifecycle_state"]) ?? "Status not published",
    price: publishedAmount,
    priceLabel:
      publishedAmount === null
        ? "No acquisition amount published"
        : (publishedAmountLabel ?? "Published acquisition amount"),
    recordNumber,
    parcelId: linked?.identifierValue ?? null,
    owner: cleanText(row["published_owner_text"]),
    ward: null,
    neighborhood: null,
    squareFeet: landSquareFeet,
    buildingSquareFeet:
      numberOrNull(row["building_square_feet"]) ?? linked?.buildingSquareFeet ?? null,
    acres: landSquareFeet === null ? null : landSquareFeet / 43_560,
    frontage: null,
    units: null,
    propertyType: cleanText(row["property_type"]) ?? linked?.propertyType ?? null,
    usage: cleanText(row["land_use"]) ?? linked?.landUse ?? null,
    description: cleanText(row["legal_description"]),
    assessorValue: numberOrNull(row["assessed_value"]) ?? linked?.assessedValue ?? null,
    marketValue: numberOrNull(row["market_value"]) ?? linked?.marketValue ?? null,
    featured: false,
    notices: [
      resolutionNotice(row),
      sourceDocumentNotice(row),
      ...attributes.map(attributeNotice),
      "Market and assessed values are reference facts, not acquisition prices.",
    ].filter((notice): notice is string => Boolean(notice)),
    searchableAttributes: attributes,
    sourceUrl: cleanText(row["source_url"]) ?? "https://accountabul.com/property-intelligence",
    sourceUpdated: cleanText(row["updated_at"]) ?? "Update time not published",
  };
}

export function mapCanonicalAuctionLot(row: ApiRow, linked?: PropertyEnrichment): PropertyRecord {
  const geography = fallbackGeography(row, linked);
  const winningBid = numberOrNull(row["winning_bid"]);
  const minimumBid = numberOrNull(row["minimum_bid"]);
  const totalDue = numberOrNull(row["total_due"]);
  const price = winningBid ?? minimumBid ?? totalDue;
  const priceLabel =
    winningBid !== null
      ? "Published winning bid"
      : minimumBid !== null
        ? "Published minimum bid"
        : totalDue !== null
          ? "Published total due"
          : "No auction amount published";
  const auctionLotId = cleanText(row["auction_lot_id"]) ?? "unknown-lot";
  const sourceLotKey = cleanText(row["source_lot_key"]) ?? auctionLotId;
  const eventLabel = cleanText(row["event_label"]) ?? "Tax auction";
  const lifecycle = cleanText(row["lifecycle_state"]) ?? "Status not published";
  const landSquareFeet = linked?.landSquareFeet ?? null;
  const attributes = searchableAttributes(row["searchable_attributes"]);
  return {
    id: `canonical-auction:${auctionLotId}`,
    canonicalPropertyId: cleanText(row["property_id"]),
    source: "Tax auction",
    recordCategory: "Tax sale",
    relatedRecords: [],
    ...geography,
    status: `${eventLabel} · ${lifecycle}`,
    price,
    priceLabel,
    recordNumber: cleanText(row["published_identifier_text"]) ?? sourceLotKey,
    parcelId: linked?.identifierValue ?? null,
    owner: cleanText(row["published_owner_text"]),
    ward: null,
    neighborhood: null,
    squareFeet: landSquareFeet,
    buildingSquareFeet: linked?.buildingSquareFeet ?? null,
    acres: landSquareFeet === null ? null : landSquareFeet / 43_560,
    frontage: null,
    units: null,
    propertyType: linked?.propertyType ?? null,
    usage: cleanText(row["sale_mechanism"])?.replaceAll("_", " ") ?? linked?.landUse ?? null,
    description: cleanText(row["legal_description"]),
    assessorValue: linked?.assessedValue ?? null,
    marketValue: linked?.marketValue ?? null,
    featured: false,
    notices: [
      resolutionNotice(row),
      sourceDocumentNotice(row),
      cleanText(row["asset_class"]) === "mixed"
        ? "This lot is published as mixed real and personal property."
        : null,
      moneyNotice("Published total due", row["total_due"]),
      moneyNotice("Published minimum bid", row["minimum_bid"]),
      moneyNotice("Published winning bid", row["winning_bid"]),
      ...attributes.map(attributeNotice),
      "Auction amounts are kept separate from assessor and market values.",
    ].filter((notice): notice is string => Boolean(notice)),
    searchableAttributes: attributes,
    sourceUrl: cleanText(row["source_url"]) ?? "https://accountabul.com/property-intelligence",
    sourceUpdated: cleanText(row["updated_at"]) ?? "Update time not published",
  };
}

function relatedRecord(record: PropertyRecord): RelatedPropertyRecord {
  return {
    id: record.id,
    agency: record.agency ?? null,
    category: record.recordCategory,
    status: record.status,
    recordNumber: record.recordNumber,
    owner: record.owner,
    price: record.price,
    priceLabel: record.priceLabel,
    description: record.description,
    notices: record.notices,
    // Spread conditionally rather than assigning undefined: the target property
    // is optional and this repo enables exactOptionalPropertyTypes.
    ...(record.searchableAttributes === undefined
      ? {}
      : { searchableAttributes: record.searchableAttributes }),
    sourceUrl: record.sourceUrl,
    sourceUpdated: record.sourceUpdated,
  };
}

function isAcquisitionRecord(record: PropertyRecord) {
  return (
    record.recordCategory === "Tax sale" ||
    record.recordCategory === "Public inventory" ||
    record.recordCategory === "City-owned"
  );
}

function latestSourceUpdate(records: PropertyRecord[], fallback: string) {
  return (
    records
      .map((record) => record.sourceUpdated)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? fallback
  );
}

function aggregateCanonicalProperty(row: ApiRow, linkedRecords: PropertyRecord[]) {
  const base = mapCanonicalProperty(row);
  if (linkedRecords.length === 0) return base;

  const ordered = [...linkedRecords].sort((left, right) => {
    const dateOrder = right.sourceUpdated.localeCompare(left.sourceUpdated);
    return dateOrder || left.id.localeCompare(right.id);
  });
  const acquisitionRecords = ordered.filter(isAcquisitionRecord);
  const presentationRecord =
    acquisitionRecords.length === 1
      ? acquisitionRecords[0]
      : ordered.length === 1
        ? ordered[0]
        : null;
  const categories = new Set(ordered.map((record) => record.recordCategory));
  const owners = [
    ...new Set(
      ordered.map((record) => record.owner).filter((owner): owner is string => Boolean(owner)),
    ),
  ];

  return {
    ...base,
    source: presentationRecord?.source ?? base.source,
    recordCategory:
      presentationRecord?.recordCategory ??
      (categories.size === 1
        ? (ordered[0]?.recordCategory ?? base.recordCategory)
        : base.recordCategory),
    status: presentationRecord?.status ?? `${ordered.length} linked public records`,
    price: presentationRecord?.price ?? null,
    priceLabel:
      presentationRecord?.priceLabel ??
      (acquisitionRecords.length > 1 ? "Review linked acquisition records" : base.priceLabel),
    owner: owners.length === 1 ? (owners[0] ?? null) : null,
    description: presentationRecord?.description ?? base.description,
    relatedRecords: ordered.map(relatedRecord),
    sourceUrl: presentationRecord?.sourceUrl ?? base.sourceUrl,
    sourceUpdated: latestSourceUpdate(ordered, base.sourceUpdated),
  } satisfies PropertyRecord;
}

function assembleCanonicalRows(
  propertyRows: ApiRow[],
  propertyRecordRows: ApiRow[],
  auctionRows: ApiRow[],
) {
  const propertiesById = new Map(
    propertyRows.map((row) => {
      const value = enrichment(row);
      return [value.propertyId, value] as const;
    }),
  );
  const recordsByProperty = new Map<string, PropertyRecord[]>();
  const unresolvedRecords: PropertyRecord[] = [];
  const resultBySearchKey = new Map<string, PropertyRecord>();
  const attach = (
    propertyId: string | null,
    record: PropertyRecord,
    lane: string,
    resultKey: string,
  ) => {
    if (!propertyId) {
      if (resultBySearchKey.has(resultKey)) {
        throw new Error(`Canonical property API returned duplicate result key ${resultKey}.`);
      }
      unresolvedRecords.push(record);
      resultBySearchKey.set(resultKey, record);
      return;
    }
    if (!propertiesById.has(propertyId)) {
      throw new Error(
        `Canonical property API ${lane} row references missing property ${propertyId}.`,
      );
    }
    const linked = recordsByProperty.get(propertyId) ?? [];
    linked.push(record);
    recordsByProperty.set(propertyId, linked);
  };
  const records = propertyRecordRows.map((row) => {
    const propertyId = cleanText(row["property_id"]);
    const sourceDefinitionId = cleanText(row["source_definition_id"]) ?? "unknown-source";
    const sourceRecordKey =
      cleanText(row["source_record_key"]) ?? cleanText(row["source_record_id"]) ?? "unknown-record";
    const record = mapCanonicalPropertyRecord(
      row,
      propertyId ? propertiesById.get(propertyId) : undefined,
    );
    attach(
      propertyId,
      record,
      "property_record_search",
      `property_record:${sourceDefinitionId}:${sourceRecordKey}`,
    );
    return record;
  });
  const auctions = auctionRows.map((row) => {
    const propertyId = cleanText(row["property_id"]);
    const auctionLotId = cleanText(row["auction_lot_id"]) ?? "unknown-lot";
    const record = mapCanonicalAuctionLot(
      row,
      propertyId ? propertiesById.get(propertyId) : undefined,
    );
    attach(propertyId, record, "auction_lot_search", `auction:${auctionLotId}`);
    return record;
  });
  const canonicalProperties = propertyRows.map((row) => {
    const propertyId = cleanText(row["property_id"]) ?? "";
    const property = aggregateCanonicalProperty(row, recordsByProperty.get(propertyId) ?? []);
    const resultKey = `property:${propertyId}`;
    if (resultBySearchKey.has(resultKey)) {
      throw new Error(`Canonical property API returned duplicate result key ${resultKey}.`);
    }
    resultBySearchKey.set(resultKey, property);
    return property;
  });
  return { canonicalProperties, unresolvedRecords, records, auctions, resultBySearchKey };
}

export async function getCanonicalPropertyPayload(
  config: CanonicalPropertyFeedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<PropertyPayload> {
  validateConfig(config);
  const [propertiesTable, recordsTable, auctionsTable] = await Promise.all(
    TABLES.map((contract) => fetchCompleteTable(config, contract, fetchImpl)),
  );
  // TABLES is a fixed three-entry contract list, so this is unreachable; the
  // guard is for noUncheckedIndexedAccess on the destructured results.
  if (!propertiesTable || !recordsTable || !auctionsTable) {
    throw new Error("The canonical property API did not return all required tables.");
  }
  const { canonicalProperties, unresolvedRecords, records, auctions } = assembleCanonicalRows(
    propertiesTable.rows,
    recordsTable.rows,
    auctionsTable.rows,
  );
  const properties = [...canonicalProperties, ...unresolvedRecords];
  if (properties.length === 0) {
    throw new Error("The canonical property API contains no searchable records.");
  }

  const sources: SourceState[] = [
    {
      key: "Public record",
      label: "Current public property records",
      mode: "live",
      total: recordsTable.total,
      loaded: records.length,
      detail: `Canonical property API · ${records.length} current records loaded`,
      url: config.supabaseUrl,
    },
    {
      key: "Tax auction",
      label: "Current real-property auction lots",
      mode: "live",
      total: auctionsTable.total,
      loaded: auctions.length,
      detail: `Canonical property API · ${auctions.length} real-property lots loaded`,
      url: config.supabaseUrl,
    },
    {
      key: "Canonical property",
      label: "Canonical property identities",
      mode: "live",
      total: propertiesTable.total,
      loaded: canonicalProperties.length,
      detail: `${canonicalProperties.length} unique property results loaded; resolved source records are linked`,
      url: config.supabaseUrl,
    },
  ];
  return { properties, sources, fetchedAt: new Date().toISOString() };
}

const PROPERTY_CATEGORIES = new Set<PropertyRecordCategory>([
  "Property record",
  "Assessor record",
  "Public inventory",
  "Tax sale",
]);
const AMOUNT_FILTERS = new Set<PropertySearchAmountFilter>([
  "all",
  "under_5000",
  "5000_15000",
  "over_15000",
  "offer_required",
]);
const SEARCH_SORTS = new Set<PropertySearchSort>([
  "record_order",
  "amount_asc",
  "amount_desc",
  "address",
]);

export function normalizeCanonicalPropertySearchRequest(
  input: Partial<PropertySearchRequest>,
): PropertySearchRequest {
  const query = input.query?.replace(/\s+/g, " ").trim() || null;
  const queryHasControlCharacter = query
    ? [...query].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    : false;
  if (query && (query.length > 200 || queryHasControlCharacter)) {
    throw new Error("Property search query must be printable text no longer than 200 characters.");
  }
  const stateCode = input.stateCode?.trim() || null;
  if (stateCode && !/^[A-Z]{2}$/.test(stateCode)) {
    throw new Error("Property search state must be an exact two-letter USPS code.");
  }
  const countyFips = input.countyFips?.trim() || null;
  if (countyFips && !/^\d{5}$/.test(countyFips)) {
    throw new Error("Property search county must be an exact five-digit FIPS code.");
  }
  const recordCategory = input.recordCategory ?? null;
  if (recordCategory !== null && !PROPERTY_CATEGORIES.has(recordCategory)) {
    throw new Error("Property search record category is unsupported.");
  }
  const amountFilter = input.amountFilter ?? "all";
  if (!AMOUNT_FILTERS.has(amountFilter))
    throw new Error("Property search amount filter is unsupported.");
  const sort = input.sort ?? "record_order";
  if (!SEARCH_SORTS.has(sort)) throw new Error("Property search sort is unsupported.");
  const pageSize = input.pageSize ?? MAX_SEARCH_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_SEARCH_PAGE_SIZE) {
    throw new Error(`Property search page size must be between 1 and ${MAX_SEARCH_PAGE_SIZE}.`);
  }
  const cursor = input.cursor?.trim() || null;
  return { query, stateCode, countyFips, recordCategory, amountFilter, sort, cursor, pageSize };
}

function searchSignature(request: PropertySearchRequest) {
  return JSON.stringify([
    request.query,
    request.stateCode,
    request.countyFips,
    request.recordCategory,
    request.amountFilter,
    request.sort,
  ]);
}

function encodeCursor(resultKey: string, request: PropertySearchRequest) {
  return Buffer.from(
    JSON.stringify({ version: 1, resultKey, signature: searchSignature(request) }),
  ).toString("base64url");
}

function decodeCursor(cursor: string | null, request: PropertySearchRequest) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed["version"] !== 1 ||
      typeof parsed["resultKey"] !== "string" ||
      parsed["resultKey"].length > 1024 ||
      parsed["signature"] !== searchSignature(request)
    ) {
      throw new Error("invalid");
    }
    return parsed["resultKey"];
  } catch {
    throw new Error("Property search cursor is invalid for the current filters.");
  }
}

async function postCanonicalRpc(
  config: CanonicalPropertyFeedConfig,
  functionName: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
) {
  const origin = validateConfig(config);
  const response = await fetchImpl(new URL(`/rest/v1/rpc/${functionName}`, origin), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "accept-profile": PROPERTY_API_SCHEMA,
      "content-profile": PROPERTY_API_SCHEMA,
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Canonical property search returned ${response.status}.`);
  const rows = await response.json();
  if (!Array.isArray(rows))
    throw new Error("Canonical property search returned an invalid response.");
  return rows as ApiRow[];
}

function exactUuid(value: unknown, label: string) {
  const text = cleanText(value);
  if (!text || !UUID_PATTERN.test(text))
    throw new Error(`Canonical property search returned invalid ${label}.`);
  return text;
}

function exactCount(value: unknown, label: string) {
  const count = numberOrNull(value);
  if (count === null || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Canonical property search returned invalid ${label}.`);
  }
  return count;
}

function inFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

function selectedContract(
  table: TableContract["table"],
  select: string,
  order: string,
  filters: Record<string, string>,
): TableContract {
  return { table, select, order, filters };
}

async function fetchSelectedTable(
  config: CanonicalPropertyFeedConfig,
  contract: TableContract,
  fetchImpl: typeof fetch,
) {
  return (await fetchCompleteTable(config, contract, fetchImpl)).rows;
}

type SearchResultKey = {
  resultKey: string;
  resultKind: "property" | "property_record" | "auction_lot";
  propertyId: string | null;
  sourceRecordId: string | null;
  auctionLotId: string | null;
  totalCount: number;
};

function parseSearchResult(row: ApiRow): SearchResultKey {
  const resultKey = cleanText(row["result_key"]);
  if (!resultKey || resultKey.length > 1024)
    throw new Error("Canonical property search returned invalid result key.");
  const resultKind = cleanText(row["result_kind"]);
  if (
    resultKind !== "property" &&
    resultKind !== "property_record" &&
    resultKind !== "auction_lot"
  ) {
    throw new Error("Canonical property search returned invalid result kind.");
  }
  const propertyId =
    row["property_id"] == null ? null : exactUuid(row["property_id"], "property ID");
  const sourceRecordId =
    row["source_record_id"] == null ? null : exactUuid(row["source_record_id"], "source record ID");
  const auctionLotId =
    row["auction_lot_id"] == null ? null : exactUuid(row["auction_lot_id"], "auction lot ID");
  const identityIsValid =
    resultKind === "property"
      ? propertyId !== null && sourceRecordId === null && auctionLotId === null
      : resultKind === "property_record"
        ? propertyId === null && sourceRecordId !== null && auctionLotId === null
        : propertyId === null && sourceRecordId !== null && auctionLotId !== null;
  if (!identityIsValid) {
    throw new Error("Canonical property search returned contradictory result identity.");
  }
  return {
    resultKey,
    resultKind,
    propertyId,
    sourceRecordId,
    auctionLotId,
    totalCount: exactCount(row["total_count"], "total count"),
  };
}

export async function getCanonicalPropertySearchPayload(
  config: CanonicalPropertyFeedConfig,
  rawRequest: Partial<PropertySearchRequest>,
  fetchImpl: typeof fetch = fetch,
): Promise<PropertyPayload> {
  const request = normalizeCanonicalPropertySearchRequest(rawRequest);
  const afterResultKey = decodeCursor(request.cursor, request);
  const rpcBody = {
    p_query: request.query,
    p_state_code: request.stateCode,
    p_county_fips: request.countyFips,
    p_record_category: request.recordCategory,
    p_amount_filter: request.amountFilter,
    p_sort: request.sort,
    p_after_result_key: afterResultKey,
    p_limit: request.pageSize + 1,
  };
  const [rawResults, rawFacets] = await Promise.all([
    postCanonicalRpc(config, "search_property_results", rpcBody, fetchImpl),
    postCanonicalRpc(
      config,
      "property_result_facets",
      {
        p_query: request.query,
        p_state_code: request.stateCode,
        p_county_fips: request.countyFips,
        p_record_category: request.recordCategory,
        p_amount_filter: request.amountFilter,
      },
      fetchImpl,
    ),
  ]);
  const parsedResults = rawResults.map(parseSearchResult);
  const hasMore = parsedResults.length > request.pageSize;
  const pageKeys = parsedResults.slice(0, request.pageSize);
  const totals = new Set(parsedResults.map((row) => row.totalCount));
  if (totals.size > 1) throw new Error("Canonical property search returned inconsistent totals.");
  const total = parsedResults[0]?.totalCount ?? 0;

  const propertyIds = pageKeys.flatMap((row) => (row.propertyId ? [row.propertyId] : []));
  const sourceRecordIds = pageKeys.flatMap((row) =>
    row.resultKind === "property_record" && row.sourceRecordId ? [row.sourceRecordId] : [],
  );
  const auctionLotIds = pageKeys.flatMap((row) => (row.auctionLotId ? [row.auctionLotId] : []));
  const propertyRowsPromise =
    propertyIds.length === 0
      ? Promise.resolve([] as ApiRow[])
      : fetchSelectedTable(
          config,
          selectedContract("property_search", PROPERTY_FIELDS, "property_id.asc", {
            property_id: inFilter(propertyIds),
          }),
          fetchImpl,
        );
  const recordFilters: Record<string, string> = { withdrawn_at: "is.null" };
  if (propertyIds.length && sourceRecordIds.length) {
    recordFilters["or"] =
      `(property_id.${inFilter(propertyIds)},source_record_id.${inFilter(sourceRecordIds)})`;
  } else if (propertyIds.length) recordFilters["property_id"] = inFilter(propertyIds);
  else if (sourceRecordIds.length) recordFilters["source_record_id"] = inFilter(sourceRecordIds);
  const recordRowsPromise =
    propertyIds.length || sourceRecordIds.length
      ? fetchSelectedTable(
          config,
          selectedContract(
            "property_record_search",
            PROPERTY_RECORD_FIELDS,
            "source_definition_id.asc,source_record_key.asc",
            recordFilters,
          ),
          fetchImpl,
        )
      : Promise.resolve([] as ApiRow[]);
  const auctionFilters: Record<string, string> = {
    asset_class: "in.(real_property,mixed)",
    lifecycle_state: "not.in.(removed,withdrawn)",
  };
  if (propertyIds.length && auctionLotIds.length) {
    auctionFilters["or"] =
      `(property_id.${inFilter(propertyIds)},auction_lot_id.${inFilter(auctionLotIds)})`;
  } else if (propertyIds.length) auctionFilters["property_id"] = inFilter(propertyIds);
  else if (auctionLotIds.length) auctionFilters["auction_lot_id"] = inFilter(auctionLotIds);
  const auctionRowsPromise =
    propertyIds.length || auctionLotIds.length
      ? fetchSelectedTable(
          config,
          selectedContract(
            "auction_lot_search",
            AUCTION_FIELDS,
            "auction_lot_id.asc",
            auctionFilters,
          ),
          fetchImpl,
        )
      : Promise.resolve([] as ApiRow[]);
  const [propertyRows, recordRows, auctionRows] = await Promise.all([
    propertyRowsPromise,
    recordRowsPromise,
    auctionRowsPromise,
  ]);
  const assembled = assembleCanonicalRows(propertyRows, recordRows, auctionRows);
  const properties = pageKeys.map((key) => {
    const property = assembled.resultBySearchKey.get(key.resultKey);
    if (!property)
      throw new Error(
        `Canonical property search result ${key.resultKey} has no public projection.`,
      );
    return property;
  });
  if (assembled.resultBySearchKey.size !== properties.length) {
    throw new Error("Canonical property search returned projections outside the requested page.");
  }

  const metric = new Map<string, number>();
  const states = [];
  const counties = [];
  const categories = [];
  for (const row of rawFacets) {
    const kind = cleanText(row["facet_kind"]);
    const value = cleanText(row["facet_value"]);
    const count = exactCount(row["result_count"], "facet count");
    if (!value) throw new Error("Canonical property search returned an invalid facet value.");
    if (kind === "metric") metric.set(value, count);
    else if (kind === "state") {
      const stateCode = cleanText(row["state_code"]);
      const state = US_STATE_CATALOG.find((entry) => entry.stateCode === stateCode);
      if (!state) throw new Error("Canonical property search returned an unknown state facet.");
      states.push({ stateCode: state.stateCode, stateName: state.stateName, recordCount: count });
    } else if (kind === "county") {
      const stateCode = cleanText(row["state_code"]);
      const countyFips = cleanText(row["county_fips"]);
      const countyName = cleanText(row["facet_label"]);
      const state = US_STATE_CATALOG.find((entry) => entry.stateCode === stateCode);
      if (!state || !countyFips || !/^\d{5}$/.test(countyFips) || !countyName) {
        throw new Error("Canonical property search returned an invalid county facet.");
      }
      counties.push({
        stateCode: state.stateCode,
        stateName: state.stateName,
        countyFips,
        countyName,
        recordCount: count,
      });
    } else if (kind === "category") {
      if (!PROPERTY_CATEGORIES.has(value as PropertyRecordCategory)) {
        throw new Error("Canonical property search returned an unknown category facet.");
      }
      categories.push({ category: value as PropertyRecordCategory, recordCount: count });
    } else throw new Error("Canonical property search returned an unknown facet kind.");
  }
  const requiredMetrics = [
    "result_total",
    "result_priced",
    "result_offer_required",
    "result_tax_sale",
    "property_source_total",
    "property_record_source_total",
    "auction_source_total",
  ];
  if (requiredMetrics.some((name) => !metric.has(name))) {
    throw new Error("Canonical property search returned incomplete summary metrics.");
  }
  const sources: SourceState[] = [
    {
      key: "Public record",
      label: "Current public property records",
      mode: "live",
      total: metric.get("property_record_source_total")!,
      loaded: recordRows.length,
      detail: `Canonical property API · ${recordRows.length} records loaded for this page`,
      url: config.supabaseUrl,
    },
    {
      key: "Tax auction",
      label: "Current real-property auction lots",
      mode: "live",
      total: metric.get("auction_source_total")!,
      loaded: auctionRows.length,
      detail: `Canonical property API · ${auctionRows.length} lots loaded for this page`,
      url: config.supabaseUrl,
    },
    {
      key: "Canonical property",
      label: "Canonical property identities",
      mode: "live",
      total: metric.get("property_source_total")!,
      loaded: propertyRows.length,
      detail: `${propertyRows.length} canonical properties loaded for this page`,
      url: config.supabaseUrl,
    },
  ];
  return {
    properties,
    sources,
    fetchedAt: new Date().toISOString(),
    search: {
      mode: "server",
      total,
      nextCursor:
        hasMore && pageKeys.length ? encodeCursor(pageKeys.at(-1)!.resultKey, request) : null,
      pageSize: request.pageSize,
      states,
      counties,
      categories,
      summary: {
        resultTotal: metric.get("result_total")!,
        pricedResultCount: metric.get("result_priced")!,
        offerRequiredCount: metric.get("result_offer_required")!,
        taxSaleResultCount: metric.get("result_tax_sale")!,
      },
      request: {
        query: request.query,
        stateCode: request.stateCode,
        countyFips: request.countyFips,
        recordCategory: request.recordCategory,
        amountFilter: request.amountFilter,
        sort: request.sort,
        pageSize: request.pageSize,
      },
    },
  };
}
