// Slice 5 (final) of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/lovable-property-feed.ts. Unlike the
// rest of this port, this module does not feed the nationwide canonical
// model at all -- it maps the same legacy row shapes into THIS repo's own
// `PropertyRecord` / `PropertyPayload` UI contract (property-data.ts), the
// same one property-intelligence-app's PropertyExplorer (ported into this
// repo at src/routes/property-intelligence, commit e629c10) already renders.
// `mapLegacyLraProperty` / `mapLegacyTaxSaleProperty` are pure; nothing here
// is wired into that route in this slice, and `getLovablePropertyPayload`'s
// `fetchImpl` has no default (this repo's established convention -- see
// nationwide-st-louis-lra-arcgis.ts's header), so importing this module
// never itself reaches a network. No literal Supabase project reference is
// embedded anywhere in this file; `validateConfig` accepts any
// `*.supabase.co` origin a caller supplies, exactly as the source does.
import type { PropertyPayload, PropertyRecord, SourceState } from "./property-data.ts";

const PAGE_SIZE = 1000;
const MAX_PARALLEL_PAGES = 4;
const ST_LOUIS = {
  city: "St. Louis",
  stateCode: "MO",
  stateName: "Missouri",
  countyName: "St. Louis City",
  countyFips: "29510",
} as const;

type LegacyRow = Record<string, unknown>;

// Declared optional fields (rather than plain `Record<string, unknown>`) so
// the mapping functions below can read them with ordinary dot access under
// this repo's `noPropertyAccessFromIndexSignature` typecheck setting.
type LegacyLraFeedRow = LegacyRow & {
  id?: unknown;
  parcel_id?: unknown;
  parcel_status?: unknown;
  usage?: unknown;
  property_source?: unknown;
  addr_num?: unknown;
  st_pre_dir?: unknown;
  st_name?: unknown;
  st_type?: unknown;
  st_suf_dir?: unknown;
  address?: unknown;
  ward?: unknown;
  neighborhood_number?: unknown;
  description?: unknown;
  class?: unknown;
  legal_description?: unknown;
  property_type?: unknown;
  side_lot_eligible?: unknown;
  frontage?: unknown;
  nbr_of_units?: unknown;
  sqft?: unknown;
  zip?: unknown;
  zoning?: unknown;
  updated_at?: unknown;
};

type LegacyTaxSaleFeedRow = LegacyRow & {
  id?: unknown;
  sale_number?: unknown;
  land_tax_number?: unknown;
  owner?: unknown;
  address?: unknown;
  total_amount?: unknown;
  zip?: unknown;
  zoning?: unknown;
  ward?: unknown;
  updated_at?: unknown;
};

export type LovablePropertyFeedConfig = {
  supabaseUrl: string;
  anonKey: string;
};

type TablePage = {
  rows: LegacyRow[];
  total: number | null;
};

const text = (input: unknown) => {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const normalized = String(input).replace(/\s+/g, " ").trim();
  return normalized || null;
};

const number = (input: unknown) => {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const normalized = input.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parcel = (input: unknown) => {
  const candidate = text(input)?.replace(/\D/g, "") ?? null;
  return candidate && /^\d{11}$/.test(candidate) ? candidate : null;
};

const units = (input: unknown) => {
  const published = text(input);
  if (!published) return null;
  const match = published.match(/\d+/);
  return match ? Number(match[0]) : null;
};

const sourceDate = (input: unknown) => text(input) ?? "Legacy property database";

function lraAddress(row: LegacyLraFeedRow) {
  const published = text(row.address);
  if (published) return published;
  return (
    [row.addr_num, row.st_pre_dir, row.st_name, row.st_type, row.st_suf_dir]
      .map(text)
      .filter(Boolean)
      .join(" ") || "Address not published"
  );
}

export function mapLegacyLraProperty(row: LegacyLraFeedRow): PropertyRecord {
  const parcelId = parcel(row.parcel_id);
  const recordNumber = text(row.id) ?? parcelId ?? `unidentified:${lraAddress(row)}`;
  const notices = [
    text(row.property_source) ? `Published source: ${text(row.property_source)}` : null,
    row.side_lot_eligible === true ? "Side-lot eligible" : null,
    text(row.zoning) ? `Zoning: ${text(row.zoning)}` : null,
  ].filter((notice): notice is string => Boolean(notice));

  return {
    id: `lovable-lra:${recordNumber}`,
    canonicalPropertyId: null,
    source: "LRA",
    agency: "LRA",
    recordCategory: "City-owned",
    relatedRecords: [],
    address: lraAddress(row),
    ...ST_LOUIS,
    status: text(row.parcel_status) ?? "Status not published",
    price: null,
    priceLabel: "Price set through offer review",
    recordNumber,
    parcelId,
    owner: null,
    ward: number(row.ward),
    neighborhood: number(row.neighborhood_number),
    zipCode: text(row.zip),
    squareFeet: number(row.sqft),
    buildingSquareFeet: null,
    acres: null,
    frontage: number(row.frontage),
    units: units(row.nbr_of_units),
    propertyType: text(row.property_type) ?? text(row.class),
    usage: text(row.usage),
    description: text(row.description) ?? text(row.legal_description),
    assessorValue: null,
    marketValue: null,
    featured: false,
    notices,
    sourceUrl: "https://homebase-datahub.lovable.app/properties",
    sourceUpdated: sourceDate(row.updated_at),
  };
}

export function mapLegacyTaxSaleProperty(row: LegacyTaxSaleFeedRow): PropertyRecord {
  const saleNumber = text(row.sale_number) ?? "Sale not published";
  const landTaxNumber = text(row.land_tax_number) ?? text(row.id) ?? "Record not published";
  const recordNumber = `${saleNumber}:${landTaxNumber}`;
  const notices = [
    `Sale ${saleNumber}`,
    "The land-tax number identifies the published sale row; it is not treated as a verified assessor parcel ID.",
    text(row.zoning) ? `Zoning: ${text(row.zoning)}` : null,
  ].filter((notice): notice is string => Boolean(notice));

  return {
    id: `lovable-tax:${recordNumber}`,
    canonicalPropertyId: null,
    source: "Tax auction",
    recordCategory: "Tax sale",
    relatedRecords: [],
    address: text(row.address) ?? "Address not published",
    ...ST_LOUIS,
    status: `Tax sale ${saleNumber}`,
    price: number(row.total_amount),
    priceLabel: "Published total due",
    recordNumber: landTaxNumber,
    parcelId: null,
    owner: text(row.owner),
    ward: number(row.ward),
    neighborhood: null,
    zipCode: text(row.zip),
    squareFeet: null,
    buildingSquareFeet: null,
    acres: null,
    frontage: null,
    units: null,
    propertyType: null,
    usage: null,
    description: null,
    assessorValue: null,
    marketValue: null,
    featured: false,
    notices,
    sourceUrl: "https://homebase-datahub.lovable.app/tax-sales",
    sourceUpdated: sourceDate(row.updated_at),
  };
}

function validateConfig(config: LovablePropertyFeedConfig) {
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    throw new Error("The legacy property database URL is not an approved Supabase endpoint.");
  }
  if (!config.anonKey.trim()) throw new Error("The legacy property database key is missing.");
  return url.origin;
}

function contentRangeTotal(value: string | null) {
  const match = value?.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function fetchTablePage(
  config: LovablePropertyFeedConfig,
  table: string,
  select: string,
  offset: number,
  fetchImpl: typeof fetch,
): Promise<TablePage> {
  const origin = validateConfig(config);
  const url = new URL(`/rest/v1/${table}`, origin);
  url.searchParams.set("select", select);
  url.searchParams.set("order", "id.asc");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const response = await fetchImpl(url, {
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Legacy property database returned ${response.status} for ${table}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows))
    throw new Error(`Legacy property database returned an invalid ${table} page.`);
  return {
    rows: rows as LegacyRow[],
    total: contentRangeTotal(response.headers.get("content-range")),
  };
}

async function fetchCompleteTable(
  config: LovablePropertyFeedConfig,
  table: string,
  select: string,
  fetchImpl: typeof fetch,
) {
  const first = await fetchTablePage(config, table, select, 0, fetchImpl);
  if (first.rows.length < PAGE_SIZE && (first.total === null || first.total <= PAGE_SIZE)) {
    return { rows: first.rows, total: first.total ?? first.rows.length };
  }

  const total = first.total;
  const rows = [...first.rows];
  if (total === null) {
    for (let offset = PAGE_SIZE; ; offset += PAGE_SIZE) {
      const page = await fetchTablePage(config, table, select, offset, fetchImpl);
      rows.push(...page.rows);
      if (page.rows.length < PAGE_SIZE) break;
    }
    return { rows, total: rows.length };
  }

  const offsets = Array.from(
    { length: Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) },
    (_, index) => (index + 1) * PAGE_SIZE,
  );
  for (let start = 0; start < offsets.length; start += MAX_PARALLEL_PAGES) {
    const pages = await Promise.all(
      offsets
        .slice(start, start + MAX_PARALLEL_PAGES)
        .map((offset) => fetchTablePage(config, table, select, offset, fetchImpl)),
    );
    pages.forEach((page) => rows.push(...page.rows));
  }
  if (rows.length !== total) {
    throw new Error(`Legacy property database returned ${rows.length} of ${total} ${table} rows.`);
  }
  return { rows, total };
}

const LRA_FIELDS = [
  "id",
  "parcel_id",
  "parcel_status",
  "usage",
  "property_source",
  "addr_num",
  "st_pre_dir",
  "st_name",
  "st_type",
  "st_suf_dir",
  "address",
  "ward",
  "neighborhood_number",
  "description",
  "class",
  "legal_description",
  "property_type",
  "side_lot_eligible",
  "frontage",
  "nbr_of_units",
  "sqft",
  "zip",
  "zoning",
  "updated_at",
].join(",");

const TAX_FIELDS = [
  "id",
  "sale_number",
  "land_tax_number",
  "owner",
  "address",
  "total_amount",
  "zip",
  "zoning",
  "ward",
  "updated_at",
].join(",");

export async function getLovablePropertyPayload(
  config: LovablePropertyFeedConfig,
  // No default (this repo's established convention -- see this file's
  // header): a caller must inject a fetch implementation for this to reach
  // any network at all.
  fetchImpl: typeof fetch,
): Promise<PropertyPayload> {
  const [lra, taxSales] = await Promise.all([
    fetchCompleteTable(config, "lra_properties", LRA_FIELDS, fetchImpl),
    fetchCompleteTable(config, "tax_sale_properties", TAX_FIELDS, fetchImpl),
  ]);
  const properties = [
    ...lra.rows.map((row) => mapLegacyLraProperty(row as LegacyLraFeedRow)),
    ...taxSales.rows.map((row) => mapLegacyTaxSaleProperty(row as LegacyTaxSaleFeedRow)),
  ];
  const sources: SourceState[] = [
    {
      key: "LRA",
      label: "LRA property inventory",
      mode: "live",
      total: lra.total,
      loaded: lra.rows.length,
      detail: `Legacy property database · ${lra.rows.length} records loaded`,
      url: "https://homebase-datahub.lovable.app/properties",
    },
    {
      key: "LCRA",
      label: "LCRA available inventory",
      mode: "unavailable",
      total: null,
      loaded: 0,
      detail: "This legacy database does not publish an LCRA table.",
      url: "https://www.stlouis-mo.gov/government/property/city-owned-property-search.cfm",
    },
    {
      key: "Tax auction",
      label: "St. Louis tax-sale inventory",
      mode: "live",
      total: taxSales.total,
      loaded: taxSales.rows.length,
      detail: `Legacy property database · ${taxSales.rows.length} records loaded`,
      url: "https://homebase-datahub.lovable.app/tax-sales",
    },
  ];
  return { properties, sources, fetchedAt: new Date().toISOString() };
}
