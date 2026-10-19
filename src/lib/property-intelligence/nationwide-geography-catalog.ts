// Ported from property-intelligence-app's app/lib/nationwide-geography-catalog.ts
// (Slice 1 of the nationwide geography catalog port,
// docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md).
//
// This module is DORMANT LIBRARY CODE: it is not imported by any
// `createServerFn`, route, or cron in this repo, and it never opens a
// network connection or a database connection itself -- the caller supplies
// a `PostgresTransactionHost` (a thin `{ transaction(cb) }` interface, kept
// local here instead of importing the source app's
// nationwide-postgres-writer.ts, since this repo has no equivalent
// transaction-writer module yet). It is exercised in
// tests/property-intelligence-geography-import.test.ts against a fake
// in-memory implementation of that interface -- never against a real
// database or PGlite (which needs node_modules the cloud session cannot
// install). Applying this against the live warehouse
// (PRODUCTION_PROJECT_REF) is a later, explicitly-approved operator action.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import { CENSUS_COUNTY_CATALOG, CENSUS_COUNTY_CATALOG_METADATA } from "./us-county-catalog.ts";
import { getUsStateCatalogEntry, US_STATE_CATALOG } from "./us-state-catalog.ts";

export type PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
};

export type PostgresTransaction = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
};

export type PostgresTransactionHost = {
  transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result>;
};

export type ImportNationwideGeographyCatalogInput = {
  importedBy: string;
  importedAt: string;
};

const requiredGeographyRelations = [
  "property_core.jurisdictions",
  "property_ingest.geography_catalog_imports",
  "property_ingest.geography_catalog_entries",
] as const;

function required(value: string, field: string, maximum = 255) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum) {
    throw new Error(
      `${field} must be a nonempty trimmed string no longer than ${maximum} characters`,
    );
  }
  return value;
}

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

export function getNationwideGeographyCatalogSnapshot() {
  const entries = CENSUS_COUNTY_CATALOG.map((county, entryIndex) => {
    const state = getUsStateCatalogEntry(county.stateCode, county.stateFips);
    return {
      entryIndex,
      stateCode: county.stateCode,
      stateFips: county.stateFips,
      stateName: state.stateName,
      countyFips: county.countyFips,
      countyName: county.countyName,
      countyLegalName: county.countyLegalName,
      countyEquivalentType: county.countyEquivalentType,
      ansiCode: county.ansiCode,
    };
  });
  return {
    catalogKey: CENSUS_COUNTY_CATALOG_METADATA.catalogKey,
    catalogVersion: CENSUS_COUNTY_CATALOG_METADATA.catalogVersion,
    gazetteerVintage: CENSUS_COUNTY_CATALOG_METADATA.vintage,
    scope: CENSUS_COUNTY_CATALOG_METADATA.scope,
    sourceUrl: CENSUS_COUNTY_CATALOG_METADATA.sourceUrl,
    sourceArchiveSha256: CENSUS_COUNTY_CATALOG_METADATA.sourceArchiveSha256,
    sourceEntryName: CENSUS_COUNTY_CATALOG_METADATA.sourceEntryName,
    sourceEntrySha256: CENSUS_COUNTY_CATALOG_METADATA.sourceEntrySha256,
    sourceRowCount: CENSUS_COUNTY_CATALOG_METADATA.sourceRowCount,
    includedRowCount: CENSUS_COUNTY_CATALOG_METADATA.includedRowCount,
    stateEquivalentCount: US_STATE_CATALOG.length,
    excludedRows: CENSUS_COUNTY_CATALOG_METADATA.excludedRows,
    entries,
  };
}

export async function assertNationwideGeographyCatalogSchemaReady(
  database: PostgresTransactionHost,
) {
  const result = await database.transaction((transaction) =>
    transaction.query<{
      relation_name: string;
      installed_name: string | null;
    }>(
      `
    select relation_name, to_regclass(relation_name)::text as installed_name
    from unnest($1::text[]) as required(relation_name)
    order by relation_name
  `,
      [[...requiredGeographyRelations]],
    ),
  );
  const installed = new Set(
    result.rows.filter((row) => row.installed_name !== null).map((row) => row.relation_name),
  );
  const missing = requiredGeographyRelations.filter((relation) => !installed.has(relation));
  if (missing.length > 0) {
    throw new Error(
      `target warehouse is not ready for the geography catalog; missing ${missing.join(", ")}`,
    );
  }
  return { requiredRelations: [...requiredGeographyRelations] };
}

async function registerCatalogGeography(
  transaction: PostgresTransaction,
  snapshot: ReturnType<typeof getNationwideGeographyCatalogSnapshot>,
) {
  const states = US_STATE_CATALOG.map((state) => ({
    state_code: state.stateCode,
    state_fips: state.stateFips,
    state_name: state.stateName,
  }));
  await transaction.query(
    `
    insert into property_core.jurisdictions (
      jurisdiction_type, name, state_code, state_fips
    )
    select 'state', state_name, state_code, state_fips
    from jsonb_to_recordset($1::jsonb) as state(
      state_code text, state_fips text, state_name text
    )
    on conflict do nothing
  `,
    [JSON.stringify(states)],
  );

  const storedStates = await transaction.query<{
    id: string;
    parent_id: string | null;
    state_code: string;
    state_fips: string;
    name: string;
  }>(
    `
    select id, parent_id, state_code, state_fips, name
    from property_core.jurisdictions
    where jurisdiction_type = 'state' and state_code = any($1::text[])
    order by state_code
  `,
    [states.map((state) => state.state_code)],
  );
  if (storedStates.rows.length !== states.length) {
    throw new Error("geography catalog could not establish every state-equivalent jurisdiction");
  }
  const stateByCode = new Map(storedStates.rows.map((state) => [state.state_code, state]));
  for (const expected of states) {
    const stored = stateByCode.get(expected.state_code);
    if (
      !stored ||
      stored.parent_id !== null ||
      stored.state_fips !== expected.state_fips ||
      stored.name !== expected.state_name
    ) {
      throw new Error(
        `stored state jurisdiction conflicts with geography catalog ${expected.state_code}`,
      );
    }
  }

  const counties = snapshot.entries.map((entry) => ({
    state_code: entry.stateCode,
    state_fips: entry.stateFips,
    county_fips: entry.countyFips,
    county_name: entry.countyName,
    county_legal_name: entry.countyLegalName,
  }));
  await transaction.query(
    `
    insert into property_core.jurisdictions (
      parent_id, jurisdiction_type, name, legal_name,
      state_code, state_fips, county_fips
    )
    select state.id, 'county_equivalent', county.county_name,
      county.county_legal_name, county.state_code, county.state_fips,
      county.county_fips
    from jsonb_to_recordset($1::jsonb) as county(
      state_code text, state_fips text, county_fips text,
      county_name text, county_legal_name text
    )
    join property_core.jurisdictions state
      on state.jurisdiction_type = 'state'
      and state.state_code = county.state_code
      and state.state_fips = county.state_fips
    on conflict do nothing
  `,
    [JSON.stringify(counties)],
  );

  const storedCounties = await transaction.query<{
    id: string;
    parent_id: string | null;
    state_code: string;
    state_fips: string;
    county_fips: string;
    name: string;
    legal_name: string | null;
  }>(
    `
    select id, parent_id, state_code, state_fips, county_fips, name, legal_name
    from property_core.jurisdictions
    where jurisdiction_type = 'county_equivalent'
      and county_fips = any($1::text[])
    order by county_fips
  `,
    [counties.map((county) => county.county_fips)],
  );
  if (storedCounties.rows.length !== counties.length) {
    throw new Error("geography catalog could not establish every county-equivalent jurisdiction");
  }
  const countyByFips = new Map(storedCounties.rows.map((county) => [county.county_fips, county]));
  for (const expected of counties) {
    const stored = countyByFips.get(expected.county_fips);
    const state = stateByCode.get(expected.state_code);
    if (
      !stored ||
      !state ||
      stored.parent_id !== state.id ||
      stored.state_code !== expected.state_code ||
      stored.state_fips !== expected.state_fips ||
      stored.name !== expected.county_name ||
      stored.legal_name !== expected.county_legal_name
    ) {
      throw new Error(
        `stored county jurisdiction conflicts with geography catalog ${expected.county_fips}`,
      );
    }
  }
  return { stateByCode, countyByFips };
}

async function verifyStoredEntries(
  transaction: PostgresTransaction,
  catalogImportId: string,
  entries: ReturnType<typeof getNationwideGeographyCatalogSnapshot>["entries"],
  entryFingerprints: readonly string[],
  jurisdictionIdByCountyFips: ReadonlyMap<string, string>,
) {
  const stored = await transaction.query<{
    entry_index: number;
    jurisdiction_id: string;
    state_code: string;
    state_fips: string;
    state_name: string;
    county_fips: string;
    county_name: string;
    county_legal_name: string;
    county_equivalent_type: string;
    ansi_code: string;
    entry_fingerprint: string;
  }>(
    `
    select entry_index, jurisdiction_id, state_code, state_fips, state_name,
      county_fips, county_name, county_legal_name, county_equivalent_type,
      ansi_code, entry_fingerprint
    from property_ingest.geography_catalog_entries
    where catalog_import_id = $1
    order by entry_index
  `,
    [catalogImportId],
  );
  if (stored.rows.length !== entries.length) {
    throw new Error("stored geography catalog entry count does not match its immutable import");
  }
  for (const [index, expected] of entries.entries()) {
    const row = stored.rows[index];
    if (
      !row ||
      row.entry_index !== index ||
      row.jurisdiction_id !== jurisdictionIdByCountyFips.get(expected.countyFips) ||
      row.state_code !== expected.stateCode ||
      row.state_fips !== expected.stateFips ||
      row.state_name !== expected.stateName ||
      row.county_fips !== expected.countyFips ||
      row.county_name !== expected.countyName ||
      row.county_legal_name !== expected.countyLegalName ||
      row.county_equivalent_type !== expected.countyEquivalentType ||
      row.ansi_code !== expected.ansiCode ||
      row.entry_fingerprint !== entryFingerprints[index]
    ) {
      throw new Error(
        `stored geography catalog entry ${index} does not match its immutable fingerprint`,
      );
    }
  }
}

export async function importNationwideGeographyCatalog(
  database: PostgresTransactionHost,
  input: ImportNationwideGeographyCatalogInput,
) {
  const importedBy = required(input.importedBy, "importedBy");
  const importedAt = canonicalUtc(input.importedAt, "importedAt");
  const snapshot = getNationwideGeographyCatalogSnapshot();
  const catalogFingerprint = await stableSha256(snapshot);
  const entryFingerprints = await Promise.all(snapshot.entries.map((entry) => stableSha256(entry)));

  return database.transaction(async (transaction) => {
    await transaction.query("select pg_advisory_xact_lock(hashtext($1))", [
      `property_ingest.geography_catalog:${snapshot.catalogKey}:${snapshot.catalogVersion}`,
    ]);
    const geography = await registerCatalogGeography(transaction, snapshot);

    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.geography_catalog_imports (
        catalog_key, catalog_version, catalog_fingerprint, gazetteer_vintage,
        scope, source_url, source_archive_sha256, source_entry_name,
        source_entry_sha256, source_row_count, included_row_count,
        state_equivalent_count, excluded_rows, imported_by, imported_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15
      )
      on conflict (catalog_key, catalog_version) do nothing
      returning id
    `,
      [
        snapshot.catalogKey,
        snapshot.catalogVersion,
        catalogFingerprint,
        snapshot.gazetteerVintage,
        snapshot.scope,
        snapshot.sourceUrl,
        snapshot.sourceArchiveSha256,
        snapshot.sourceEntryName,
        snapshot.sourceEntrySha256,
        snapshot.sourceRowCount,
        snapshot.includedRowCount,
        snapshot.stateEquivalentCount,
        JSON.stringify(snapshot.excludedRows),
        importedBy,
        importedAt,
      ],
    );
    const replayed = inserted.rows.length === 0;
    const insertedRow = inserted.rows[0];
    if (!replayed && !insertedRow) {
      throw new Error("geography catalog insert returned no row");
    }
    const catalogImport = replayed
      ? await transaction.query<{
          id: string;
          catalog_fingerprint: string;
          metadata_match: boolean;
        }>(
          `
          select id, catalog_fingerprint,
            catalog_fingerprint = $3
              and gazetteer_vintage = $4
              and scope = $5
              and source_url = $6
              and source_archive_sha256 = $7
              and source_entry_name = $8
              and source_entry_sha256 = $9
              and source_row_count = $10
              and included_row_count = $11
              and state_equivalent_count = $12
              and excluded_rows = $13::jsonb as metadata_match
          from property_ingest.geography_catalog_imports
          where catalog_key = $1 and catalog_version = $2
        `,
          [
            snapshot.catalogKey,
            snapshot.catalogVersion,
            catalogFingerprint,
            snapshot.gazetteerVintage,
            snapshot.scope,
            snapshot.sourceUrl,
            snapshot.sourceArchiveSha256,
            snapshot.sourceEntryName,
            snapshot.sourceEntrySha256,
            snapshot.sourceRowCount,
            snapshot.includedRowCount,
            snapshot.stateEquivalentCount,
            JSON.stringify(snapshot.excludedRows),
          ],
        )
      : {
          rows: [
            {
              id: insertedRow!.id,
              catalog_fingerprint: catalogFingerprint,
              metadata_match: true,
            },
          ],
        };
    const catalogImportRow = catalogImport.rows[0];
    if (
      catalogImport.rows.length !== 1 ||
      !catalogImportRow ||
      catalogImportRow.catalog_fingerprint !== catalogFingerprint ||
      !catalogImportRow.metadata_match
    ) {
      throw new Error("geography catalog version already exists with different immutable content");
    }
    const catalogImportId = catalogImportRow.id;

    if (!replayed) {
      const databaseEntries = snapshot.entries.map((entry, entryIndex) => ({
        entry_index: entryIndex,
        state_code: entry.stateCode,
        state_fips: entry.stateFips,
        state_name: entry.stateName,
        county_fips: entry.countyFips,
        county_name: entry.countyName,
        county_legal_name: entry.countyLegalName,
        county_equivalent_type: entry.countyEquivalentType,
        ansi_code: entry.ansiCode,
        entry_fingerprint: entryFingerprints[entryIndex],
      }));
      await transaction.query(
        `
        insert into property_ingest.geography_catalog_entries (
          catalog_import_id, entry_index, jurisdiction_id, state_code,
          state_fips, state_name, county_fips, county_name, county_legal_name,
          county_equivalent_type, ansi_code, entry_fingerprint
        )
        select $1, entry.entry_index, jurisdiction.id, entry.state_code,
          entry.state_fips, entry.state_name, entry.county_fips,
          entry.county_name, entry.county_legal_name,
          entry.county_equivalent_type, entry.ansi_code,
          entry.entry_fingerprint
        from jsonb_to_recordset($2::jsonb) as entry(
          entry_index integer, state_code text, state_fips text,
          state_name text, county_fips text, county_name text,
          county_legal_name text, county_equivalent_type text,
          ansi_code text, entry_fingerprint text
        )
        join property_core.jurisdictions jurisdiction
          on jurisdiction.jurisdiction_type = 'county_equivalent'
          and jurisdiction.county_fips = entry.county_fips
        order by entry.entry_index
      `,
        [catalogImportId, JSON.stringify(databaseEntries)],
      );
    }

    await verifyStoredEntries(
      transaction,
      catalogImportId,
      snapshot.entries,
      entryFingerprints,
      new Map([...geography.countyByFips].map(([countyFips, county]) => [countyFips, county.id])),
    );
    return {
      catalogImportId,
      catalogFingerprint,
      catalogKey: snapshot.catalogKey,
      catalogVersion: snapshot.catalogVersion,
      stateEquivalentCount: snapshot.stateEquivalentCount,
      countyEquivalentCount: snapshot.includedRowCount,
      replayed,
    };
  });
}
