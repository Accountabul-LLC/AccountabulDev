// Slice 1 of the nationwide geography catalog port
// (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Exercises
// importNationwideGeographyCatalog against a hand-written, in-memory fake
// implementation of PostgresTransactionHost -- never a network connection,
// never a real or embedded Postgres (PGlite, which the source app's own
// equivalent test uses, needs node_modules the cloud session in this repo
// cannot install). The fake implements just enough of the SQL surface the
// import module actually issues (see
// src/lib/property-intelligence/nationwide-geography-catalog.ts) to model
// property_core.jurisdictions and the property_ingest geography ledger
// tables faithfully enough to test idempotency/replay-safety and
// conflict-detection, matching this module's own tests in the source app
// (tests/nationwide-geography-catalog.test.mjs).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  getNationwideGeographyCatalogSnapshot,
  importNationwideGeographyCatalog,
  type PostgresQueryResult,
  type PostgresTransaction,
  type PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

type JurisdictionRow = {
  id: string;
  parent_id: string | null;
  jurisdiction_type: string;
  name: string;
  legal_name: string | null;
  state_code: string | null;
  state_fips: string | null;
  county_fips: string | null;
};

type ImportRow = {
  id: string;
  catalog_key: string;
  catalog_version: number;
  catalog_fingerprint: string;
  gazetteer_vintage: number;
  scope: string;
  source_url: string;
  source_archive_sha256: string;
  source_entry_name: string;
  source_entry_sha256: string;
  source_row_count: number;
  included_row_count: number;
  state_equivalent_count: number;
  excluded_rows: unknown;
};

type EntryRow = {
  catalog_import_id: string;
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
};

/**
 * A tiny fake warehouse modeling just the tables and queries
 * nationwide-geography-catalog.ts actually issues. Each `.transaction()`
 * call snapshots the fake tables first and restores them if the callback
 * throws, modeling Postgres's real transactional rollback.
 */
class FakeGeographyWarehouse implements PostgresTransactionHost {
  jurisdictions: JurisdictionRow[] = [];
  imports: ImportRow[] = [];
  entries: EntryRow[] = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    const snapshot = {
      jurisdictions: structuredClone(this.jurisdictions),
      imports: structuredClone(this.imports),
      entries: structuredClone(this.entries),
    };
    try {
      return await callback(this.makeTransaction());
    } catch (error) {
      this.jurisdictions = snapshot.jurisdictions;
      this.imports = snapshot.imports;
      this.entries = snapshot.entries;
      throw error;
    }
  }

  private makeTransaction(): PostgresTransaction {
    return {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const normalized = sql.replace(/\s+/g, " ").trim();

        if (normalized.startsWith("select pg_advisory_xact_lock")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "insert into property_core.jurisdictions ( jurisdiction_type, name, state_code, state_fips",
          )
        ) {
          const states = JSON.parse(params[0] as string) as Array<{
            state_code: string;
            state_fips: string;
            state_name: string;
          }>;
          for (const state of states) {
            const exists = this.jurisdictions.some(
              (row) => row.jurisdiction_type === "state" && row.state_code === state.state_code,
            );
            if (!exists) {
              this.jurisdictions.push({
                id: randomUUID(),
                parent_id: null,
                jurisdiction_type: "state",
                name: state.state_name,
                legal_name: null,
                state_code: state.state_code,
                state_fips: state.state_fips,
                county_fips: null,
              });
            }
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "select id, parent_id, state_code, state_fips, name from property_core.jurisdictions where jurisdiction_type = 'state'",
          )
        ) {
          const codes = params[0] as string[];
          const rows = this.jurisdictions
            .filter(
              (row) => row.jurisdiction_type === "state" && codes.includes(row.state_code ?? ""),
            )
            .sort((a, b) => (a.state_code! < b.state_code! ? -1 : 1))
            .map((row) => ({
              id: row.id,
              parent_id: row.parent_id,
              state_code: row.state_code,
              state_fips: row.state_fips,
              name: row.name,
            }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "insert into property_core.jurisdictions ( parent_id, jurisdiction_type, name, legal_name",
          )
        ) {
          const counties = JSON.parse(params[0] as string) as Array<{
            state_code: string;
            state_fips: string;
            county_fips: string;
            county_name: string;
            county_legal_name: string;
          }>;
          for (const county of counties) {
            const exists = this.jurisdictions.some(
              (row) =>
                row.jurisdiction_type === "county_equivalent" &&
                row.county_fips === county.county_fips,
            );
            if (exists) continue;
            const state = this.jurisdictions.find(
              (row) =>
                row.jurisdiction_type === "state" &&
                row.state_code === county.state_code &&
                row.state_fips === county.state_fips,
            );
            if (!state) continue; // join finds no match -> no row inserted, same as real SQL
            this.jurisdictions.push({
              id: randomUUID(),
              parent_id: state.id,
              jurisdiction_type: "county_equivalent",
              name: county.county_name,
              legal_name: county.county_legal_name,
              state_code: county.state_code,
              state_fips: county.state_fips,
              county_fips: county.county_fips,
            });
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "select id, parent_id, state_code, state_fips, county_fips, name, legal_name from property_core.jurisdictions where jurisdiction_type = 'county_equivalent'",
          )
        ) {
          const fipsList = params[0] as string[];
          const rows = this.jurisdictions
            .filter(
              (row) =>
                row.jurisdiction_type === "county_equivalent" &&
                fipsList.includes(row.county_fips ?? ""),
            )
            .sort((a, b) => (a.county_fips! < b.county_fips! ? -1 : 1))
            .map((row) => ({
              id: row.id,
              parent_id: row.parent_id,
              state_code: row.state_code,
              state_fips: row.state_fips,
              county_fips: row.county_fips,
              name: row.name,
              legal_name: row.legal_name,
            }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        if (normalized.startsWith("insert into property_ingest.geography_catalog_imports")) {
          const [
            catalog_key,
            catalog_version,
            catalog_fingerprint,
            gazetteer_vintage,
            scope,
            source_url,
            source_archive_sha256,
            source_entry_name,
            source_entry_sha256,
            source_row_count,
            included_row_count,
            state_equivalent_count,
            excluded_rows_json,
          ] = params as [
            string,
            number,
            string,
            number,
            string,
            string,
            string,
            string,
            string,
            number,
            number,
            number,
            string,
          ];
          const conflict = this.imports.find(
            (row) => row.catalog_key === catalog_key && row.catalog_version === catalog_version,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const id = randomUUID();
          this.imports.push({
            id,
            catalog_key,
            catalog_version,
            catalog_fingerprint,
            gazetteer_vintage,
            scope,
            source_url,
            source_archive_sha256,
            source_entry_name,
            source_entry_sha256,
            source_row_count,
            included_row_count,
            state_equivalent_count,
            excluded_rows: JSON.parse(excluded_rows_json),
          });
          return { rows: [{ id }] } as unknown as PostgresQueryResult<Row>;
        }

        if (normalized.startsWith("select id, catalog_fingerprint, catalog_fingerprint = $3")) {
          const [
            catalog_key,
            catalog_version,
            catalog_fingerprint,
            gazetteer_vintage,
            scope,
            source_url,
            source_archive_sha256,
            source_entry_name,
            source_entry_sha256,
            source_row_count,
            included_row_count,
            state_equivalent_count,
            excluded_rows_json,
          ] = params as [
            string,
            number,
            string,
            number,
            string,
            string,
            string,
            string,
            string,
            number,
            number,
            number,
            string,
          ];
          const row = this.imports.find(
            (candidate) =>
              candidate.catalog_key === catalog_key &&
              candidate.catalog_version === catalog_version,
          );
          if (!row) return { rows: [] } as unknown as PostgresQueryResult<Row>;
          const metadata_match =
            row.gazetteer_vintage === gazetteer_vintage &&
            row.scope === scope &&
            row.source_url === source_url &&
            row.source_archive_sha256 === source_archive_sha256 &&
            row.source_entry_name === source_entry_name &&
            row.source_entry_sha256 === source_entry_sha256 &&
            row.source_row_count === source_row_count &&
            row.included_row_count === included_row_count &&
            row.state_equivalent_count === state_equivalent_count &&
            JSON.stringify(row.excluded_rows) === excluded_rows_json;
          return {
            rows: [{ id: row.id, catalog_fingerprint: row.catalog_fingerprint, metadata_match }],
          } as unknown as PostgresQueryResult<Row>;
        }

        if (normalized.startsWith("insert into property_ingest.geography_catalog_entries")) {
          const [catalogImportId, entriesJson] = params as [string, string];
          const entries = JSON.parse(entriesJson) as Array<{
            entry_index: number;
            state_code: string;
            state_fips: string;
            state_name: string;
            county_fips: string;
            county_name: string;
            county_legal_name: string;
            county_equivalent_type: string;
            ansi_code: string;
            entry_fingerprint: string;
          }>;
          for (const entry of entries) {
            const jurisdiction = this.jurisdictions.find(
              (row) =>
                row.jurisdiction_type === "county_equivalent" &&
                row.county_fips === entry.county_fips,
            );
            if (!jurisdiction) continue;
            this.entries.push({
              catalog_import_id: catalogImportId,
              entry_index: entry.entry_index,
              jurisdiction_id: jurisdiction.id,
              state_code: entry.state_code,
              state_fips: entry.state_fips,
              state_name: entry.state_name,
              county_fips: entry.county_fips,
              county_name: entry.county_name,
              county_legal_name: entry.county_legal_name,
              county_equivalent_type: entry.county_equivalent_type,
              ansi_code: entry.ansi_code,
              entry_fingerprint: entry.entry_fingerprint,
            });
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          normalized.startsWith(
            "select entry_index, jurisdiction_id, state_code, state_fips, state_name",
          )
        ) {
          const catalogImportId = params[0] as string;
          const rows = this.entries
            .filter((row) => row.catalog_import_id === catalogImportId)
            .sort((a, b) => a.entry_index - b.entry_index);
          return { rows } as unknown as PostgresQueryResult<Row>;
        }

        throw new Error(`FakeGeographyWarehouse: unmodeled query: ${normalized.slice(0, 80)}`);
      },
    };
  }
}

const importInput = {
  importedBy: "accountabul-geography-review",
  importedAt: "2026-08-20T23:20:00.000Z",
};

test("Slice 1: a fresh import establishes the national state and county registry exactly once", async () => {
  const database = new FakeGeographyWarehouse();
  const result = await importNationwideGeographyCatalog(database, importInput);

  assert.equal(result.replayed, false);
  assert.equal(result.stateEquivalentCount, 51);
  assert.equal(result.countyEquivalentCount, 3_144);
  assert.match(result.catalogFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    database.jurisdictions.filter((row) => row.jurisdiction_type === "state").length,
    51,
  );
  assert.equal(
    database.jurisdictions.filter((row) => row.jurisdiction_type === "county_equivalent").length,
    3_144,
  );
  assert.equal(
    database.jurisdictions.filter(
      (row) => row.jurisdiction_type === "county_equivalent" && row.state_code === "MS",
    ).length,
    82,
  );
  assert.equal(database.imports.length, 1);
  assert.equal(database.entries.length, 3_144);

  const desoto = database.jurisdictions.find((row) => row.county_fips === "28033");
  assert.ok(desoto);
  assert.equal(desoto?.name, "DeSoto");
  assert.equal(desoto?.legal_name, "DeSoto County");
});

test("Slice 1: an exact geography import replay preserves ledger and jurisdiction identities (idempotent)", async () => {
  const database = new FakeGeographyWarehouse();
  const first = await importNationwideGeographyCatalog(database, importInput);
  const desotoBefore = database.jurisdictions.find((row) => row.county_fips === "28033")?.id;

  const replay = await importNationwideGeographyCatalog(database, {
    importedBy: "second-authorized-operator",
    importedAt: "2026-08-20T23:25:00.000Z",
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.catalogImportId, first.catalogImportId);
  assert.equal(replay.catalogFingerprint, first.catalogFingerprint);
  assert.equal(database.jurisdictions.find((row) => row.county_fips === "28033")?.id, desotoBefore);
  // Replaying does not duplicate any jurisdiction or ledger row.
  assert.equal(database.jurisdictions.length, 3_195);
  assert.equal(database.imports.length, 1);
  assert.equal(database.entries.length, 3_144);
});

test("Slice 1: a conflicting existing jurisdiction fails the import closed and rolls back every new row", async () => {
  const database = new FakeGeographyWarehouse();
  database.jurisdictions.push({
    id: randomUUID(),
    parent_id: null,
    jurisdiction_type: "state",
    name: "Mississipi", // misspelled on purpose, matching the source's own regression case
    legal_name: null,
    state_code: "MS",
    state_fips: "28",
    county_fips: null,
  });

  await assert.rejects(
    importNationwideGeographyCatalog(database, importInput),
    /stored state jurisdiction conflicts.*MS/i,
  );
  // The transaction rolled back: only the pre-existing conflicting row remains.
  assert.equal(database.jurisdictions.length, 1);
  assert.equal(database.imports.length, 0);
  assert.equal(database.entries.length, 0);
});

test("Slice 1: metadata drift on an existing import prevents a replay from completing", async () => {
  const database = new FakeGeographyWarehouse();
  await importNationwideGeographyCatalog(database, importInput);
  const drifted = database.imports.find(
    (row) => row.catalog_key === "us_county_equivalents_2025" && row.catalog_version === 1,
  );
  assert.ok(drifted);
  drifted!.scope = "drifted scope";

  await assert.rejects(
    importNationwideGeographyCatalog(database, importInput),
    /catalog version already exists with different immutable content/i,
  );
});

test("Slice 1: malformed importedBy/importedAt input is rejected before any query is issued", async () => {
  const database: PostgresTransactionHost = {
    transaction: async () => {
      throw new Error("must not be called for invalid input");
    },
  };

  await assert.rejects(
    importNationwideGeographyCatalog(database, {
      importedBy: "",
      importedAt: importInput.importedAt,
    }),
    /importedBy must be a nonempty trimmed string/,
  );
  await assert.rejects(
    importNationwideGeographyCatalog(database, {
      importedBy: "  padded  ",
      importedAt: importInput.importedAt,
    }),
    /importedBy must be a nonempty trimmed string/,
  );
  await assert.rejects(
    importNationwideGeographyCatalog(database, {
      importedBy: importInput.importedBy,
      importedAt: "not-a-date",
    }),
    /importedAt must be a canonical UTC ISO date-time/,
  );
  await assert.rejects(
    importNationwideGeographyCatalog(database, {
      importedBy: importInput.importedBy,
      importedAt: "2026-08-20T23:20:00Z", // missing milliseconds -> not canonical
    }),
    /importedAt must be a canonical UTC ISO date-time/,
  );
});

test("Slice 1: the catalog snapshot is deterministic and covers exactly 3,144 counties across 51 state equivalents", () => {
  const snapshot = getNationwideGeographyCatalogSnapshot();
  assert.equal(snapshot.entries.length, 3_144);
  assert.equal(snapshot.stateEquivalentCount, 51);
  assert.equal(snapshot.entries[0].countyFips, "01001");
  assert.equal(snapshot.entries.at(-1)?.countyFips, "56045");
  assert.deepEqual(snapshot, getNationwideGeographyCatalogSnapshot());
});
