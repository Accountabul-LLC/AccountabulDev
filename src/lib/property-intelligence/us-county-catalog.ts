// Ported verbatim (structure + validation logic) from
// property-intelligence-app's app/lib/us-county-catalog.ts (Slice 1 of the
// nationwide geography catalog port, docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md).
// No framework or `@/` imports, so this is unit-testable under plain node
// without node_modules -- see
// tests/property-intelligence-geography-catalog.test.ts.
//
// This module both loads and *validates* the pinned catalog file
// (catalogs/geography/us_county_equivalents_2025.v1.json) -- see that
// directory's README.md for the hash-pinning/integrity approach. A
// corrupted, truncated, or hand-edited catalog file throws at import time
// instead of silently serving bad geography.
import countyCatalogDocument from "../../../catalogs/geography/us_county_equivalents_2025.v1.json" with { type: "json" };

import { getUsStateCatalogEntry, US_STATE_CATALOG, type UsStateCode } from "./us-state-catalog.ts";
import { SHA256_HEX } from "../validation/patterns.ts";

export type UsCountyEquivalentType =
  | "borough"
  | "census_area"
  | "city_and_borough"
  | "county"
  | "district"
  | "independent_city"
  | "municipality"
  | "parish"
  | "planning_region";

export type UsCountyCatalogEntry = {
  stateCode: UsStateCode;
  stateFips: string;
  countyFips: string;
  countyName: string;
  countyLegalName: string;
  countyEquivalentType: UsCountyEquivalentType;
  ansiCode: string;
  gazetteerVintage: number;
};

const documentKeys = new Set([
  "catalogKey",
  "catalogVersion",
  "gazetteerVintage",
  "scope",
  "sourceUrl",
  "sourceArchiveSha256",
  "sourceEntryName",
  "sourceEntrySha256",
  "sourceRowCount",
  "includedRowCount",
  "excludedRows",
  "rows",
]);
const excludedRowKeys = new Set(["stateCode", "rowCount", "reason"]);

function record(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, field: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${field} contains unknown field ${unknown.sort()[0]}`);
}

function classifyCountyEquivalent(censusLegalName: string): {
  countyName: string;
  countyEquivalentType: UsCountyEquivalentType;
} {
  if (censusLegalName === "District of Columbia") {
    return { countyName: censusLegalName, countyEquivalentType: "district" };
  }
  const suffixes = [
    [" City and Borough", "city_and_borough"],
    [" Planning Region", "planning_region"],
    [" Census Area", "census_area"],
    [" Municipality", "municipality"],
    [" Borough", "borough"],
    [" Parish", "parish"],
    [" County", "county"],
  ] as const;
  for (const [suffix, countyEquivalentType] of suffixes) {
    if (censusLegalName.endsWith(suffix)) {
      return {
        countyName: censusLegalName.slice(0, -suffix.length),
        countyEquivalentType,
      };
    }
  }
  const independentCity = censusLegalName.match(/^(.*) city$/i);
  if (independentCity?.[1]) {
    return {
      countyName: `${independentCity[1]} City`,
      countyEquivalentType: "independent_city",
    };
  }
  throw new Error(`Census county-equivalent name ${censusLegalName} has an unsupported legal type`);
}

function validateDocument(input: unknown) {
  const document = record(input, "county catalog");
  exactKeys(document, documentKeys, "county catalog");
  if (
    document["catalogKey"] !== "us_county_equivalents_2025" ||
    document["catalogVersion"] !== 1 ||
    document["gazetteerVintage"] !== 2025 ||
    document["scope"] !== "fifty_states_and_district_of_columbia"
  ) {
    throw new Error("county catalog identity does not match the supported contract");
  }
  const sourceUrl = document["sourceUrl"];
  if (typeof sourceUrl !== "string" || !sourceUrl.startsWith("https://www2.census.gov/")) {
    throw new Error("county catalog must identify its official Census source");
  }
  for (const [field, value] of [
    ["sourceArchiveSha256", document["sourceArchiveSha256"]],
    ["sourceEntrySha256", document["sourceEntrySha256"]],
  ] as const) {
    if (typeof value !== "string" || !SHA256_HEX.test(value)) {
      throw new Error(`county catalog ${field} must be a SHA-256`);
    }
  }
  if (
    document["sourceEntryName"] !== "2025_Gaz_counties_national.txt" ||
    document["sourceRowCount"] !== 3_222 ||
    document["includedRowCount"] !== 3_144
  ) {
    throw new Error("county catalog source scope does not match the reviewed Census file");
  }
  const excludedRows = document["excludedRows"];
  if (!Array.isArray(excludedRows) || excludedRows.length !== 1) {
    throw new Error("county catalog must record its Puerto Rico exclusion");
  }
  const excluded = record(excludedRows[0], "county catalog exclusion");
  exactKeys(excluded, excludedRowKeys, "county catalog exclusion");
  if (
    excluded["stateCode"] !== "PR" ||
    excluded["rowCount"] !== 78 ||
    excluded["reason"] !== "territory_not_in_v1_state_catalog"
  ) {
    throw new Error("county catalog Puerto Rico exclusion does not match the reviewed scope");
  }
  const rows = document["rows"];
  if (!Array.isArray(rows) || rows.length !== 3_144) {
    throw new Error("county catalog must contain 3,144 county equivalents");
  }
  return document as unknown as {
    catalogKey: "us_county_equivalents_2025";
    catalogVersion: 1;
    gazetteerVintage: 2025;
    scope: "fifty_states_and_district_of_columbia";
    sourceUrl: string;
    sourceArchiveSha256: string;
    sourceEntryName: string;
    sourceEntrySha256: string;
    sourceRowCount: 3_222;
    includedRowCount: 3_144;
    excludedRows: [{ stateCode: "PR"; rowCount: 78; reason: "territory_not_in_v1_state_catalog" }];
    rows: unknown[];
  };
}

const document = validateDocument(countyCatalogDocument);

export const CENSUS_COUNTY_CATALOG_METADATA = Object.freeze({
  catalogKey: document.catalogKey,
  catalogVersion: document.catalogVersion,
  vintage: document.gazetteerVintage,
  scope: document.scope,
  coveredStateCodes: Object.freeze(US_STATE_CATALOG.map((state) => state.stateCode)),
  sourceUrl: document.sourceUrl,
  sourceArchiveSha256: document.sourceArchiveSha256,
  sourceEntryName: document.sourceEntryName,
  sourceEntrySha256: document.sourceEntrySha256,
  sourceRowCount: document.sourceRowCount,
  includedRowCount: document.includedRowCount,
  excludedRows: Object.freeze(document.excludedRows.map((entry) => Object.freeze({ ...entry }))),
});

function validateEntries(rawRows: readonly unknown[]) {
  const entries: UsCountyCatalogEntry[] = [];
  const countyFips = new Set<string>();
  const ansiCodes = new Set<string>();
  const representedStates = new Set<UsStateCode>();
  let previousCountyFips = "";
  for (const [index, rawRow] of rawRows.entries()) {
    if (
      !Array.isArray(rawRow) ||
      rawRow.length !== 4 ||
      rawRow.some((value) => typeof value !== "string" || !value)
    ) {
      throw new Error(`county catalog row ${index} must contain four nonempty strings`);
    }
    const [stateCode, rowCountyFips, ansiCode, countyLegalName] = rawRow as [
      string,
      string,
      string,
      string,
    ];
    const state = getUsStateCatalogEntry(stateCode, rowCountyFips.slice(0, 2));
    if (!/^\d{5}$/.test(rowCountyFips) || !rowCountyFips.startsWith(state.stateFips)) {
      throw new Error(`county FIPS ${rowCountyFips} does not belong to ${stateCode}`);
    }
    if (!/^\d{8}$/.test(ansiCode))
      throw new Error(`county ${rowCountyFips} has an invalid ANSI code`);
    if (countyFips.has(rowCountyFips) || ansiCodes.has(ansiCode)) {
      throw new Error(`county ${rowCountyFips} duplicates a Census identity`);
    }
    if (previousCountyFips && previousCountyFips >= rowCountyFips) {
      throw new Error("county catalog must be sorted by ascending county FIPS");
    }
    const classification = classifyCountyEquivalent(countyLegalName);
    entries.push(
      Object.freeze({
        stateCode: state.stateCode,
        stateFips: state.stateFips,
        countyFips: rowCountyFips,
        countyName: classification.countyName,
        countyLegalName,
        countyEquivalentType: classification.countyEquivalentType,
        ansiCode,
        gazetteerVintage: document.gazetteerVintage,
      }),
    );
    countyFips.add(rowCountyFips);
    ansiCodes.add(ansiCode);
    representedStates.add(state.stateCode);
    previousCountyFips = rowCountyFips;
  }
  if (
    entries.length !== document.includedRowCount ||
    representedStates.size !== US_STATE_CATALOG.length ||
    US_STATE_CATALOG.some((state) => !representedStates.has(state.stateCode))
  ) {
    throw new Error("county catalog must cover all 50 states plus the District of Columbia");
  }
  return entries;
}

export const CENSUS_COUNTY_CATALOG: readonly UsCountyCatalogEntry[] = Object.freeze(
  validateEntries(document.rows),
);

const byCountyFips = new Map(CENSUS_COUNTY_CATALOG.map((entry) => [entry.countyFips, entry]));
const byStateCode = new Map<UsStateCode, readonly UsCountyCatalogEntry[]>(
  US_STATE_CATALOG.map((state) => [
    state.stateCode,
    Object.freeze(CENSUS_COUNTY_CATALOG.filter((entry) => entry.stateCode === state.stateCode)),
  ]),
);

export function getCensusCountyCatalogForState(stateCode: string) {
  return byStateCode.get(stateCode as UsStateCode) ?? [];
}

export function getCensusCountyCatalogEntry(countyFips: string) {
  const entry = byCountyFips.get(countyFips);
  if (!entry)
    throw new Error(`county FIPS ${countyFips} is not loaded in the Census county baseline`);
  return entry;
}
