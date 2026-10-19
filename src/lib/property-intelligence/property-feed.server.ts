import taxSale239 from "./tax-sale-239.json" with { type: "json" };
import type { PropertyPayload, PropertyRecord, SourceState } from "./property-data.ts";

type ArcGisAttributes = Record<string, string | number | null>;

const ARCGIS_ROOT =
  "https://maps8.stlouis-mo.gov/arcgis/rest/services/SLDC/LRA_PIEA_LCRA_Real_Estate/MapServer";
const CITY_SEARCH_URL =
  "https://www.stlouis-mo.gov/government/property/city-owned-property-search.cfm";
const TAX_SALE_URL =
  "https://www.stlouis-mo.gov/government/departments/sheriff/documents/upload/239-Property-List-8-10-2026.pdf";

const clean = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
};

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const notice = (label: string, value: unknown) => {
  const text = clean(value);
  return text && !/^(no|none|n\/a)$/i.test(text) ? `${label}: ${text}` : null;
};

function taxSaleRecords(): PropertyRecord[] {
  return taxSale239.map((record) => ({
    id: `tax-${record.landTaxNumber}`,
    canonicalPropertyId: null,
    source: "Tax auction" as const,
    recordCategory: "Tax sale" as const,
    relatedRecords: [],
    address: record.address,
    city: "St. Louis",
    stateCode: "MO",
    stateName: "Missouri",
    countyName: "St. Louis City",
    countyFips: "29510",
    status: "Sale 239 · August 11, 2026",
    price: record.amountDue,
    priceLabel: "Published total due",
    recordNumber: record.landTaxNumber,
    parcelId: null,
    owner: record.owner,
    ward: null,
    neighborhood: null,
    zipCode: null,
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
    notices: [
      "Address is for guidance only; the official notice is published in the St. Louis Daily Record.",
      "Auction totals and eligibility must be verified with the Sheriff before bidding.",
    ],
    sourceUrl: TAX_SALE_URL,
    sourceUpdated: "Published August 10, 2026",
  }));
}

type LayerConfig = {
  key: "LRA" | "LCRA";
  layer: number;
  where: string;
  limit: number;
  priceField: "LRA_PRICING" | "Pricing";
};

async function arcGisJson(url: string) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`City service returned ${response.status}`);
  const data = (await response.json()) as {
    error?: { message?: string };
    objectIds?: number[];
    features?: { attributes: ArcGisAttributes }[];
  };
  if (data.error) throw new Error(data.error.message ?? "City service query failed");
  return data;
}

async function fetchLayer(config: LayerConfig) {
  const idParams = new URLSearchParams({
    where: config.where,
    returnIdsOnly: "true",
    f: "json",
  });
  const idData = await arcGisJson(`${ARCGIS_ROOT}/${config.layer}/query?${idParams}`);
  const allIds = [...(idData.objectIds ?? [])].sort((a, b) => b - a);
  const ids = allIds.slice(0, config.limit);

  if (ids.length === 0) return { records: [] as PropertyRecord[], total: 0 };

  const commonFields = [
    "OBJECTID",
    "ADDRESS",
    "ParcelId",
    "WARD",
    "NEIGHBORHOOD_NUM",
    "ZipCode",
    "SQFT",
    "AssessorsTotal",
    "Frontage",
    "NbrOfUnits",
    "PropertyType",
    "Description",
    "Featured",
    "PublicNotice",
    "BuriedMaterials",
    config.priceField,
  ];
  if (config.key === "LRA") {
    commonFields.push("Status", "Usage", "Environmental", "SideLotEligible");
  } else {
    commonFields.push("STATUS", "LCRA_ORG");
  }

  const recordParams = new URLSearchParams({
    where: "1=1",
    objectIds: ids.join(","),
    outFields: commonFields.join(","),
    returnGeometry: "false",
    f: "json",
  });
  const data = await arcGisJson(`${ARCGIS_ROOT}/${config.layer}/query?${recordParams}`);

  const records = (data.features ?? []).map(({ attributes }) => {
    const objectId = numberOrNull(attributes["OBJECTID"]) ?? 0;
    const price = numberOrNull(attributes[config.priceField]);
    const notices = [
      notice("Public notice", attributes["PublicNotice"]),
      notice("Environmental", attributes["Environmental"]),
      notice("Deed restriction", attributes["Deed_Restriction"]),
      notice("Buried materials", attributes["BuriedMaterials"]),
      notice("Side-lot eligible", attributes["SideLotEligible"]),
    ].filter((item): item is string => Boolean(item));

    return {
      id: `${config.key.toLowerCase()}-${objectId}`,
      canonicalPropertyId: null,
      source: config.key,
      agency: config.key,
      recordCategory: "City-owned",
      relatedRecords: [],
      address: clean(attributes["ADDRESS"]) ?? "Address not published",
      city: "St. Louis",
      stateCode: "MO",
      stateName: "Missouri",
      countyName: "St. Louis City",
      countyFips: "29510",
      status: clean(attributes["Status"] ?? attributes["STATUS"]) ?? "Available",
      price,
      priceLabel: price === null ? "Price set through offer review" : "City asking price",
      recordNumber: String(objectId),
      parcelId: clean(attributes["ParcelId"]),
      owner: clean(attributes["LCRA_ORG"]),
      ward: numberOrNull(attributes["WARD"]),
      neighborhood: numberOrNull(attributes["NEIGHBORHOOD_NUM"]),
      zipCode: numberOrNull(attributes["ZipCode"])?.toFixed(0) ?? null,
      squareFeet: numberOrNull(attributes["SQFT"]),
      buildingSquareFeet: null,
      acres: numberOrNull(attributes["Acres"]),
      frontage: numberOrNull(attributes["Frontage"]),
      units: numberOrNull(attributes["NbrOfUnits"]),
      propertyType: clean(attributes["PropertyType"]),
      usage: clean(attributes["Usage"]),
      description: clean(attributes["Description"]),
      assessorValue: numberOrNull(attributes["AssessorsTotal"]),
      marketValue: null,
      featured: /^yes$/i.test(clean(attributes["Featured"]) ?? ""),
      notices,
      sourceUrl: CITY_SEARCH_URL,
      sourceUpdated: "City GIS inventory · fetched live",
    } satisfies PropertyRecord;
  });

  return { records, total: allIds.length };
}

export function getStaticPropertyPayload(): PropertyPayload {
  const taxRecords = taxSaleRecords();
  return {
    properties: taxRecords,
    fetchedAt: "2026-08-10T00:00:00-05:00",
    sources: [
      {
        key: "LRA",
        label: "LRA available inventory",
        mode: "unavailable",
        total: null,
        loaded: 0,
        detail: "Connecting to the live city GIS service",
        url: CITY_SEARCH_URL,
      },
      {
        key: "LCRA",
        label: "LCRA available inventory",
        mode: "unavailable",
        total: null,
        loaded: 0,
        detail: "Connecting to the live city GIS service",
        url: CITY_SEARCH_URL,
      },
      {
        key: "Tax auction",
        label: "Sheriff land tax sale 239",
        mode: "snapshot",
        total: taxRecords.length,
        loaded: taxRecords.length,
        detail: "Official list published August 10, 2026",
        url: TAX_SALE_URL,
      },
    ],
  };
}

export async function getLivePropertyPayload(): Promise<PropertyPayload> {
  const taxRecords = taxSaleRecords();
  const configs: LayerConfig[] = [
    { key: "LRA", layer: 0, where: "Status='Available'", limit: 300, priceField: "LRA_PRICING" },
    { key: "LCRA", layer: 2, where: "STATUS='AVAILABLE'", limit: 100, priceField: "Pricing" },
  ];
  const settled = await Promise.allSettled(configs.map(fetchLayer));
  const properties = [...taxRecords];
  const sources: SourceState[] = [];

  settled.forEach((result, index) => {
    const config = configs[index]!;
    if (result.status === "fulfilled") {
      properties.unshift(...result.value.records);
      sources.push({
        key: config.key,
        label: `${config.key} available inventory`,
        mode: "live",
        total: result.value.total,
        loaded: result.value.records.length,
        detail: `Official city GIS · ${result.value.records.length} records loaded`,
        url: CITY_SEARCH_URL,
      });
    } else {
      sources.push({
        key: config.key,
        label: `${config.key} available inventory`,
        mode: "unavailable",
        total: null,
        loaded: 0,
        detail: "City GIS did not respond; no substitute data shown",
        url: CITY_SEARCH_URL,
      });
    }
  });

  sources.push({
    key: "Tax auction",
    label: "Sheriff land tax sale 239",
    mode: "snapshot",
    total: taxRecords.length,
    loaded: taxRecords.length,
    detail: "Official list published August 10, 2026",
    url: TAX_SALE_URL,
  });

  return { properties, sources, fetchedAt: new Date().toISOString() };
}
