// Ported from property-intelligence-app's app/lib/owner-research.ts.
// Owner research is only ever launched against a parcel the caller can name
// unambiguously: an explicit parcelId wins, and an address match must resolve
// to exactly one result after alias normalization. Anything ambiguous returns
// null rather than guessing a parcel.
import type { ParcelSearchResult } from "./analysis-types.ts";

export type OwnerResearchLaunch = {
  requestId: string;
  address: string;
  parcelId: string | null;
  owner: string | null;
};

const addressAliases = new Map([
  ["AVENUE", "AV"],
  ["AVE", "AV"],
  ["BOULEVARD", "BLVD"],
  ["STREET", "ST"],
  ["ROAD", "RD"],
  ["DRIVE", "DR"],
  ["PLACE", "PL"],
  ["LANE", "LN"],
  ["NORTH", "N"],
  ["SOUTH", "S"],
  ["EAST", "E"],
  ["WEST", "W"],
]);

export function normalizedStreetAddress(value: string) {
  // split always yields at least one element for a string, so the ?? "" is for
  // noUncheckedIndexedAccess rather than a reachable case.
  return ((value.split(",", 1)[0] ?? "").toUpperCase().match(/[A-Z0-9]+/g) ?? [])
    .map((token) => addressAliases.get(token) ?? token)
    .join(" ");
}

export function selectOwnerResearchParcel(
  launch: Pick<OwnerResearchLaunch, "address" | "parcelId">,
  results: ParcelSearchResult[],
) {
  if (launch.parcelId) {
    return results.find((result) => result.parcelId === launch.parcelId) ?? null;
  }
  const expectedAddress = normalizedStreetAddress(launch.address);
  const exactMatches = results.filter(
    (result) => normalizedStreetAddress(result.address) === expectedAddress,
  );
  return exactMatches.length === 1 ? exactMatches[0] : null;
}

export function buildOwnerResearchQuestion(owner: string | null) {
  const ownerName = owner?.replace(/\s+/g, " ").trim().slice(0, 200);
  return ownerName
    ? `Who is ${ownerName}, the owner or organization shown for this property? Summarize what the verified property record establishes about this owner or entity, and clearly identify what still needs an entity-registry or title search.`
    : "Who owns this property? Summarize what the verified property record establishes about the owner, and clearly identify what still needs an entity-registry or title search.";
}
