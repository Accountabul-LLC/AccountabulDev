// Ported verbatim (structure + values) from property-intelligence-app's
// app/lib/us-state-catalog.ts as part of the nationwide geography catalog
// port (Slice 1 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md's nationwide
// ingestion work). No framework or `@/` imports, so this is unit-testable
// under plain node without node_modules -- see
// tests/property-intelligence-geography-catalog.test.ts.
//
// U.S. Census Bureau ANSI/FIPS state codes. The catalog contains all 50
// states plus the District of Columbia, which is a state-equivalent
// jurisdiction.
// Source: https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html
export const US_STATE_AND_DISTRICT_FIPS = [
  ["AL", "01", "Alabama"],
  ["AK", "02", "Alaska"],
  ["AZ", "04", "Arizona"],
  ["AR", "05", "Arkansas"],
  ["CA", "06", "California"],
  ["CO", "08", "Colorado"],
  ["CT", "09", "Connecticut"],
  ["DE", "10", "Delaware"],
  ["DC", "11", "District of Columbia"],
  ["FL", "12", "Florida"],
  ["GA", "13", "Georgia"],
  ["HI", "15", "Hawaii"],
  ["ID", "16", "Idaho"],
  ["IL", "17", "Illinois"],
  ["IN", "18", "Indiana"],
  ["IA", "19", "Iowa"],
  ["KS", "20", "Kansas"],
  ["KY", "21", "Kentucky"],
  ["LA", "22", "Louisiana"],
  ["ME", "23", "Maine"],
  ["MD", "24", "Maryland"],
  ["MA", "25", "Massachusetts"],
  ["MI", "26", "Michigan"],
  ["MN", "27", "Minnesota"],
  ["MS", "28", "Mississippi"],
  ["MO", "29", "Missouri"],
  ["MT", "30", "Montana"],
  ["NE", "31", "Nebraska"],
  ["NV", "32", "Nevada"],
  ["NH", "33", "New Hampshire"],
  ["NJ", "34", "New Jersey"],
  ["NM", "35", "New Mexico"],
  ["NY", "36", "New York"],
  ["NC", "37", "North Carolina"],
  ["ND", "38", "North Dakota"],
  ["OH", "39", "Ohio"],
  ["OK", "40", "Oklahoma"],
  ["OR", "41", "Oregon"],
  ["PA", "42", "Pennsylvania"],
  ["RI", "44", "Rhode Island"],
  ["SC", "45", "South Carolina"],
  ["SD", "46", "South Dakota"],
  ["TN", "47", "Tennessee"],
  ["TX", "48", "Texas"],
  ["UT", "49", "Utah"],
  ["VT", "50", "Vermont"],
  ["VA", "51", "Virginia"],
  ["WA", "53", "Washington"],
  ["WV", "54", "West Virginia"],
  ["WI", "55", "Wisconsin"],
  ["WY", "56", "Wyoming"],
] as const;

export type UsStateCode = (typeof US_STATE_AND_DISTRICT_FIPS)[number][0];

export type UsStateCatalogEntry = {
  stateCode: UsStateCode;
  stateFips: string;
  stateName: string;
  isDistrict: boolean;
};

const entries = US_STATE_AND_DISTRICT_FIPS.map(([stateCode, stateFips, stateName]) => ({
  stateCode,
  stateFips,
  stateName,
  isDistrict: stateCode === "DC",
})) satisfies UsStateCatalogEntry[];

const byCode = new Map<string, UsStateCatalogEntry>(
  entries.map((entry) => [entry.stateCode, entry]),
);
const byFips = new Map<string, UsStateCatalogEntry>(
  entries.map((entry) => [entry.stateFips, entry]),
);

export const US_STATE_CATALOG: readonly UsStateCatalogEntry[] = Object.freeze(entries);

export function getUsStateCatalogEntry(stateCode: string, stateFips: string) {
  const codeEntry = byCode.get(stateCode as UsStateCode);
  const fipsEntry = byFips.get(stateFips);
  if (!codeEntry || codeEntry !== fipsEntry) {
    throw new Error(
      `jurisdiction state code ${stateCode} does not match Census state FIPS ${stateFips}`,
    );
  }
  return codeEntry;
}
