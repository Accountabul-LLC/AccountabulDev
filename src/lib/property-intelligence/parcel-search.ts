import type { ParcelSearchResult } from "./analysis-types.ts";

const PARCEL_LAYER =
  "https://maps8.stlouis-mo.gov/arcgis/rest/services/ASSESSOR/PARCEL_PTS/MapServer/0";
const SOURCE_URL = "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=82";
const fields = [
  "OBJECTID",
  "SITEADDR",
  "ParcelId",
  "SQFT",
  "WARD",
  "TaxBalance",
  "PriorTaxAmt",
  "PropertyClassCode",
  "IsAbatedProperty",
  "AbatementStartYear",
  "AbatementEndYear",
  "X",
  "Y",
  "CityBlock",
  "Parcel",
  "OWNERNAME",
  "OWNERNAME2",
  "LegalDesc1",
  "LegalDesc2",
  "LegalDesc3",
  "LegalDesc4",
  "LegalDesc5",
  "AsrClassCode",
  "AsrLandUse1",
  "VacantLot",
  "NbrOfUnits",
  "NbrOfApts",
  "FRONTAGE",
  "LANDAREA",
  "AsdLand",
  "AsdImprove",
  "AsdTotal",
  "AprLand",
  "CostAprImprove",
  "Zoning",
  "NbrOfBldgsRes",
  "NbrOfBldgsCom",
  "FirstYearBuilt",
  "LastYearBuilt",
  "ResSalePrice",
  "ResSaleDate",
  "VacBldgYear",
  "NBRHD",
  "ZIP",
  "OWNEROCC",
  "HANDLE",
];

type Attributes = Record<string, string | number | null>;

const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const textOrNull = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null;
const scalarTextOrNull = (value: unknown) =>
  textOrNull(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
const booleanOrNull = (value: unknown) => {
  if (
    value === -1 ||
    value === 1 ||
    value === "-1" ||
    value === "1" ||
    value === "Y" ||
    value === "YES"
  )
    return true;
  if (value === 0 || value === "0" || value === "N" || value === "NO") return false;
  return null;
};
const streetSuffixes = new Set([
  "ALLEY",
  "ALY",
  "AV",
  "AVE",
  "AVENUE",
  "BLVD",
  "BOULEVARD",
  "CIR",
  "CIRCLE",
  "CT",
  "COURT",
  "DR",
  "DRIVE",
  "HWY",
  "HIGHWAY",
  "LN",
  "LANE",
  "PKWY",
  "PARKWAY",
  "PL",
  "PLACE",
  "RD",
  "ROAD",
  "ST",
  "STREET",
  "TER",
  "TERRACE",
  "WAY",
]);
const addressTokenAliases = new Map([
  ["NORTH", "N"],
  ["SOUTH", "S"],
  ["EAST", "E"],
  ["WEST", "W"],
  ["NORTHEAST", "NE"],
  ["NORTHWEST", "NW"],
  ["SOUTHEAST", "SE"],
  ["SOUTHWEST", "SW"],
  ["SAINT", "ST"],
  ["MOUNT", "MT"],
]);
const unitMarkers = new Set([
  "APT",
  "APARTMENT",
  "BLDG",
  "BUILDING",
  "FL",
  "FLOOR",
  "STE",
  "SUITE",
  "UNIT",
]);
const dateOrNull = (value: unknown) => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
};
const yearOrNull = (value: unknown) => {
  const number = numberOrNull(value);
  return number && number >= 1600 && number <= 2200 ? number : null;
};

export function parcelSearchWhere(input: string) {
  const normalized = input.trim();
  if (/^\d{11}$/.test(normalized)) return `ParcelId='${normalized}'`;
  const streetAddress = normalized.split(",", 1)[0] ?? "";
  const tokens =
    streetAddress
      .toUpperCase()
      .match(/[A-Z0-9]+/g)
      ?.slice(0, 10) ?? [];
  const unitIndex = tokens.findIndex((token) => unitMarkers.has(token));
  if (unitIndex > 1) tokens.splice(unitIndex);
  if (tokens.length > 2 && streetSuffixes.has(tokens.at(-1) ?? "")) tokens.pop();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    tokens[index] = addressTokenAliases.get(token) ?? token;
  }
  if (tokens.length < 2 || !tokens.some((token) => /^\d+$/.test(token))) {
    throw new Error(
      "Enter a St. Louis street address with a house number or an 11-digit parcel ID.",
    );
  }
  return tokens.map((token) => `UPPER(SITEADDR) LIKE '%${token}%'`).join(" AND ");
}

export function normalizeParcelResult(attributes: Attributes): ParcelSearchResult | null {
  const parcelId = textOrNull(attributes["ParcelId"]);
  const address = textOrNull(attributes["SITEADDR"]);
  if (!parcelId || !/^\d{11}$/.test(parcelId) || !address) return null;
  return {
    parcelId,
    address,
    lotSquareFeet: numberOrNull(attributes["SQFT"]),
    ward: numberOrNull(attributes["WARD"]),
    taxBalance: numberOrNull(attributes["TaxBalance"]),
    priorTaxAmount: numberOrNull(attributes["PriorTaxAmt"]),
    propertyClassCode: numberOrNull(attributes["PropertyClassCode"]),
    isTaxAbated:
      numberOrNull(attributes["IsAbatedProperty"]) === null
        ? null
        : Number(attributes["IsAbatedProperty"]) === 1,
    abatementStartYear: yearOrNull(attributes["AbatementStartYear"]),
    abatementEndYear: yearOrNull(attributes["AbatementEndYear"]),
    webMercatorX: numberOrNull(attributes["X"]),
    webMercatorY: numberOrNull(attributes["Y"]),
    cityBlock: numberOrNull(attributes["CityBlock"]),
    parcelNumber: numberOrNull(attributes["Parcel"]),
    ownerName: textOrNull(attributes["OWNERNAME"]),
    ownerName2: textOrNull(attributes["OWNERNAME2"]),
    legalDescription:
      ["LegalDesc1", "LegalDesc2", "LegalDesc3", "LegalDesc4", "LegalDesc5"]
        .map((key) => textOrNull(attributes[key]))
        .filter(Boolean)
        .join(" ") || null,
    assessorClassCode: scalarTextOrNull(attributes["AsrClassCode"]),
    landUseCode: scalarTextOrNull(attributes["AsrLandUse1"]),
    vacantLot: booleanOrNull(attributes["VacantLot"]),
    numberOfUnits: numberOrNull(attributes["NbrOfUnits"]),
    numberOfApartments: numberOrNull(attributes["NbrOfApts"]),
    frontageFeet: numberOrNull(attributes["FRONTAGE"]),
    landArea: numberOrNull(attributes["LANDAREA"]),
    assessedLandValue: numberOrNull(attributes["AsdLand"]),
    assessedImprovementValue: numberOrNull(attributes["AsdImprove"]),
    assessedTotalValue: numberOrNull(attributes["AsdTotal"]),
    appraisedLandValue: numberOrNull(attributes["AprLand"]),
    appraisedImprovementValue: numberOrNull(attributes["CostAprImprove"]),
    zoning: textOrNull(attributes["Zoning"]),
    residentialBuildingCount: numberOrNull(attributes["NbrOfBldgsRes"]),
    commercialBuildingCount: numberOrNull(attributes["NbrOfBldgsCom"]),
    firstYearBuilt: yearOrNull(attributes["FirstYearBuilt"]),
    lastYearBuilt: yearOrNull(attributes["LastYearBuilt"]),
    lastResidentialSalePrice: numberOrNull(attributes["ResSalePrice"]),
    lastResidentialSaleDate: dateOrNull(attributes["ResSaleDate"]),
    vacantBuildingYear: yearOrNull(attributes["VacBldgYear"]),
    neighborhoodCode: scalarTextOrNull(attributes["NBRHD"]),
    zipCode: scalarTextOrNull(attributes["ZIP"]),
    ownerOccupied: booleanOrNull(attributes["OWNEROCC"]),
    assessorHandle: textOrNull(attributes["HANDLE"]),
    sourceUrl: SOURCE_URL,
    observedAt: new Date().toISOString(),
  };
}

export async function searchCityParcels(input: string, fetchImplementation: typeof fetch = fetch) {
  const parameters = new URLSearchParams({
    where: parcelSearchWhere(input),
    outFields: fields.join(","),
    returnGeometry: "false",
    resultRecordCount: "8",
    orderByFields: "SITEADDR ASC",
    f: "json",
  });
  const url = `${PARCEL_LAYER}/query?${parameters}`;
  let response: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImplementation(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok || response.status < 500) break;
      lastError = new Error(`City parcel service returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  if (!response)
    throw lastError instanceof Error ? lastError : new Error("City parcel search failed");
  if (!response.ok) throw new Error(`City parcel service returned ${response.status}`);
  const data = (await response.json()) as {
    error?: { message?: string };
    features?: Array<{ attributes: Attributes }>;
  };
  if (data.error) throw new Error(data.error.message ?? "City parcel search failed");
  return (data.features ?? [])
    .map(({ attributes }) => normalizeParcelResult(attributes))
    .filter((item): item is ParcelSearchResult => Boolean(item));
}
