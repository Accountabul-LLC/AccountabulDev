// Slice 4 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-postgres-county-resolver.ts:
// maps a source's published county name/FIPS to Slice 1's jurisdiction
// ledger (`property_core.jurisdictions`), verifying the database ledger
// still agrees with Slice 1's Census county catalog byte-for-byte before
// trusting it.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  assertNationwideGeographyCatalogSchemaReady,
  getNationwideGeographyCatalogSnapshot,
  type PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import type { JurisdictionReference } from "./nationwide-property-intake-types.ts";
import { getCensusCountyCatalogForState } from "./us-county-catalog.ts";
import { US_STATE_CATALOG } from "./us-state-catalog.ts";

export type NationwideCountyLookup = {
  publishedCountyName?: unknown;
  publishedCountyFips?: unknown;
};

export type NationwideCountyResolution = {
  jurisdiction: JurisdictionReference;
  jurisdictionId: string;
};

export type CreateNationwidePostgresCountyResolverInput = {
  database: PostgresTransactionHost;
  stateCode: string;
};

export type NationwidePostgresCountyResolver = (
  input: NationwideCountyLookup,
) => Promise<NationwideCountyResolution>;

type StoredCounty = {
  jurisdiction_id: string;
  state_code: string;
  state_fips: string;
  state_name: string;
  county_fips: string;
  county_name: string;
  county_legal_name: string;
  entry_fingerprint: string;
  jurisdiction_state_code: string;
  jurisdiction_state_fips: string;
  jurisdiction_county_fips: string;
  jurisdiction_county_name: string;
  jurisdiction_county_legal_name: string | null;
  parent_state_code: string;
  parent_state_fips: string;
  parent_state_name: string;
};

function exactStateCode(value: string) {
  if (typeof value !== "string" || value !== value.trim() || !/^[A-Z]{2}$/.test(value)) {
    throw new Error("stateCode must be an exact two-letter USPS code");
  }
  const state = US_STATE_CATALOG.find((entry) => entry.stateCode === value);
  if (!state) throw new Error(`stateCode ${value} is outside the supported Census state catalog`);
  return state;
}

function normalizedCountyName(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("published county name must be text");
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  if (!normalized) return null;
  if (normalized.length > 255) throw new Error("published county name is too long");
  return normalized;
}

function normalizedCountyFips(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 99_999) {
      throw new Error("published county FIPS number must be an integer between 0 and 99999");
    }
    return String(value).padStart(5, "0");
  }
  if (typeof value !== "string")
    throw new Error("published county FIPS must be text or an integer");
  const normalized = value.trim();
  if (!/^\d{5}$/.test(normalized)) {
    throw new Error("published county FIPS text must contain exactly five digits");
  }
  return normalized;
}

export function createNationwidePostgresCountyResolver(
  input: CreateNationwidePostgresCountyResolverInput,
): NationwidePostgresCountyResolver {
  const state = exactStateCode(input.stateCode);
  const expectedCounties = getCensusCountyCatalogForState(state.stateCode);
  if (expectedCounties.length === 0) {
    throw new Error(`stateCode ${state.stateCode} has no county-equivalent baseline`);
  }
  const expectedByFips = new Map(expectedCounties.map((county) => [county.countyFips, county]));
  const fipsByNormalizedName = new Map<string, string>();
  for (const county of expectedCounties) {
    for (const publishedName of [county.countyName, county.countyLegalName]) {
      const normalizedName = normalizedCountyName(publishedName);
      if (!normalizedName) throw new Error(`county ${county.countyFips} has no canonical name`);
      const prior = fipsByNormalizedName.get(normalizedName);
      if (prior && prior !== county.countyFips) {
        throw new Error(`county name ${publishedName} is ambiguous within ${state.stateCode}`);
      }
      fipsByNormalizedName.set(normalizedName, county.countyFips);
    }
  }

  let storedSnapshot: Promise<ReadonlyMap<string, StoredCounty>> | null = null;
  function loadStoredSnapshot() {
    storedSnapshot ??= (async () => {
      await assertNationwideGeographyCatalogSchemaReady(input.database);
      const catalog = getNationwideGeographyCatalogSnapshot();
      const catalogFingerprint = await stableSha256(catalog);
      const expectedEntries = catalog.entries.filter(
        (entry) => entry.stateCode === state.stateCode,
      );
      const expectedFingerprints = new Map(
        await Promise.all(
          expectedEntries.map(
            async (entry) => [entry.countyFips, await stableSha256(entry)] as const,
          ),
        ),
      );
      return input.database.transaction(async (transaction) => {
        const rows = await transaction.query<StoredCounty>(
          `select
             entry.jurisdiction_id::text, entry.state_code, entry.state_fips, entry.state_name,
             entry.county_fips, entry.county_name, entry.county_legal_name, entry.entry_fingerprint,
             county.state_code as jurisdiction_state_code, county.state_fips as jurisdiction_state_fips,
             county.county_fips as jurisdiction_county_fips, county.name as jurisdiction_county_name,
             county.legal_name as jurisdiction_county_legal_name,
             parent.state_code as parent_state_code, parent.state_fips as parent_state_fips, parent.name as parent_state_name
           from property_ingest.geography_catalog_imports catalog
           join property_ingest.geography_catalog_entries entry on entry.catalog_import_id = catalog.id
           join property_core.jurisdictions county on county.id = entry.jurisdiction_id and county.jurisdiction_type = 'county_equivalent'
           join property_core.jurisdictions parent on parent.id = county.parent_id and parent.jurisdiction_type = 'state'
           where catalog.catalog_key = $1 and catalog.catalog_version = $2 and catalog.catalog_fingerprint = $3 and entry.state_code = $4
           order by entry.county_fips`,
          [catalog.catalogKey, catalog.catalogVersion, catalogFingerprint, state.stateCode],
        );
        if (rows.rows.length !== expectedEntries.length) {
          throw new Error(
            `database geography ledger does not contain all ${expectedEntries.length} ${state.stateCode} county equivalents`,
          );
        }
        const storedByFips = new Map<string, StoredCounty>();
        for (const expected of expectedEntries) {
          const stored = rows.rows.find((row) => row.county_fips === expected.countyFips);
          if (
            !stored ||
            storedByFips.has(stored.county_fips) ||
            stored.state_code !== expected.stateCode ||
            stored.state_fips !== expected.stateFips ||
            stored.state_name !== state.stateName ||
            stored.county_name !== expected.countyName ||
            stored.county_legal_name !== expected.countyLegalName ||
            stored.entry_fingerprint !== expectedFingerprints.get(expected.countyFips) ||
            stored.jurisdiction_state_code !== expected.stateCode ||
            stored.jurisdiction_state_fips !== expected.stateFips ||
            stored.jurisdiction_county_fips !== expected.countyFips ||
            stored.jurisdiction_county_name !== expected.countyName ||
            stored.jurisdiction_county_legal_name !== expected.countyLegalName ||
            stored.parent_state_code !== expected.stateCode ||
            stored.parent_state_fips !== expected.stateFips ||
            stored.parent_state_name !== state.stateName
          ) {
            throw new Error(
              `database geography ledger conflicts with county ${expected.countyFips}`,
            );
          }
          storedByFips.set(stored.county_fips, stored);
        }
        return storedByFips;
      });
    })();
    return storedSnapshot;
  }

  return async (lookup) => {
    const publishedName = normalizedCountyName(lookup.publishedCountyName);
    const publishedFips = normalizedCountyFips(lookup.publishedCountyFips);
    if (!publishedName && !publishedFips) {
      throw new Error("county resolution requires a published county name or county FIPS");
    }
    const fipsFromName = publishedName ? (fipsByNormalizedName.get(publishedName) ?? null) : null;
    if (publishedName && !fipsFromName) {
      throw new Error(`published county name is not recognized in ${state.stateCode}`);
    }
    if (
      publishedFips &&
      (!publishedFips.startsWith(state.stateFips) || !expectedByFips.has(publishedFips))
    ) {
      throw new Error(`published county FIPS ${publishedFips} is not in ${state.stateCode}`);
    }
    if (publishedFips && fipsFromName && publishedFips !== fipsFromName) {
      throw new Error("published county name and county FIPS identify different jurisdictions");
    }
    const countyFips = publishedFips ?? fipsFromName;
    if (!countyFips) throw new Error("published county identity could not be resolved");
    const expected = expectedByFips.get(countyFips);
    if (!expected) throw new Error(`county ${countyFips} is outside the reviewed state baseline`);
    const stored = (await loadStoredSnapshot()).get(countyFips);
    if (!stored)
      throw new Error(`county ${countyFips} is missing from the database geography ledger`);
    return {
      jurisdiction: {
        stateCode: state.stateCode,
        countyName: expected.countyName,
        countyFips: expected.countyFips,
      },
      jurisdictionId: stored.jurisdiction_id,
    };
  };
}
