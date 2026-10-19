// Contract for nationwide-source-registration.ts -- the port of
// property-intelligence-app's registerNationwideSourceManifest /
// registerNationwideJurisdiction. This is the only path in the repo that can
// create a property_ingest.source_definitions row, so the live ingestion
// entrypoint has no sourceDefinitionId to dispatch against without it.
//
// Exercised against a hand-written, in-memory fake PostgresTransactionHost
// modeling property_core.jurisdictions and property_ingest.source_definitions
// (the tables 20260924140000 and 20260924150000 add). Never a network
// connection, never a real or embedded Postgres -- same approach as
// property-intelligence-attribute-visibility.test.ts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  registerNationwideJurisdiction,
  registerNationwideSourceManifest,
} from "../src/lib/property-intelligence/nationwide-source-registration.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";
import type {
  NationwideJurisdictionManifest,
  NationwideSourceManifest,
} from "../src/lib/property-intelligence/nationwide-source-manifest.ts";

type JurisdictionRow = {
  id: string;
  parent_id: string | null;
  jurisdiction_type: string;
  name: string | null;
  legal_name: string | null;
  state_code: string | null;
  state_fips: string | null;
  county_fips: string | null;
  place_fips: string | null;
  gnis_id: string | null;
  timezone: string | null;
};

type SourceDefinitionRow = {
  id: string;
  jurisdiction_id: string;
  source_key: string;
  contract_version: number;
  mapping_schema: unknown;
  expected_update_frequency: string;
  schedule_policy: string;
  scheduler_owner: string;
  known_limitations: string | null;
  active: boolean;
};

class FakeNationwideRegistry implements PostgresTransactionHost {
  jurisdictions: JurisdictionRow[] = [];
  sourceDefinitions: SourceDefinitionRow[] = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();
        const rows = (value: unknown[]) => ({ rows: value as Row[] });

        if (
          n.startsWith(
            "select id from property_core.jurisdictions where jurisdiction_type = 'state'",
          )
        ) {
          const [stateFips, stateCode] = params as [string, string];
          const found = this.jurisdictions.filter(
            (row) =>
              row.jurisdiction_type === "state" &&
              row.state_fips === stateFips &&
              row.state_code === stateCode,
          );
          return rows(n.includes("limit 1") ? found.slice(0, 1) : found);
        }

        if (
          n.startsWith(
            "insert into property_core.jurisdictions ( jurisdiction_type, name, legal_name, state_code, state_fips, timezone )",
          )
        ) {
          const [name, legalName, stateCode, stateFips, timezone] = params as (string | null)[];
          this.jurisdictions.push({
            id: randomUUID(),
            parent_id: null,
            jurisdiction_type: "state",
            name,
            legal_name: legalName,
            state_code: stateCode,
            state_fips: stateFips,
            county_fips: null,
            place_fips: null,
            gnis_id: null,
            timezone,
          });
          return rows([]);
        }

        if (
          n.startsWith(
            "select id from property_core.jurisdictions where jurisdiction_type = 'county_equivalent'",
          )
        ) {
          const [countyFips, stateCode] = params as [string, string];
          const found = this.jurisdictions.filter(
            (row) =>
              row.jurisdiction_type === "county_equivalent" &&
              row.county_fips === countyFips &&
              row.state_code === stateCode,
          );
          return rows(n.includes("limit 1") ? found.slice(0, 1) : found);
        }

        if (n.includes("values ($1, 'county_equivalent', $2, $3, $4, $5, $6, $7)")) {
          const [parentId, name, legalName, stateCode, stateFips, countyFips, timezone] =
            params as (string | null)[];
          this.jurisdictions.push({
            id: randomUUID(),
            parent_id: parentId,
            jurisdiction_type: "county_equivalent",
            name,
            legal_name: legalName,
            state_code: stateCode,
            state_fips: stateFips,
            county_fips: countyFips,
            place_fips: null,
            gnis_id: null,
            timezone,
          });
          return rows([]);
        }

        if (n.startsWith("select id, parent_id from property_core.jurisdictions")) {
          const [type] = params as [string];
          const found = this.jurisdictions.filter((row) => row.jurisdiction_type === type);
          return rows(n.includes("limit 1") ? found.slice(0, 1) : found);
        }

        if (
          n.includes(
            "place_fips, gnis_id, timezone ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          )
        ) {
          const [
            parentId,
            type,
            name,
            legalName,
            stateCode,
            stateFips,
            countyFips,
            placeFips,
            gnisId,
            timezone,
          ] = params as (string | null)[];
          this.jurisdictions.push({
            id: randomUUID(),
            parent_id: parentId,
            jurisdiction_type: type as string,
            name,
            legal_name: legalName,
            state_code: stateCode,
            state_fips: stateFips,
            county_fips: countyFips,
            place_fips: placeFips,
            gnis_id: gnisId,
            timezone,
          });
          return rows([]);
        }

        if (n.startsWith("insert into property_ingest.source_definitions")) {
          const [jurisdictionId, sourceKey, contractVersion] = params as [string, string, number];
          const conflict = this.sourceDefinitions.find(
            (row) =>
              row.jurisdiction_id === jurisdictionId &&
              row.source_key === sourceKey &&
              row.contract_version === contractVersion,
          );
          if (conflict) return rows([]);
          const created: SourceDefinitionRow = {
            id: randomUUID(),
            jurisdiction_id: jurisdictionId,
            source_key: sourceKey,
            contract_version: contractVersion,
            mapping_schema: params[12],
            expected_update_frequency: params[15] as string,
            schedule_policy: params[16] as string,
            scheduler_owner: params[17] as string,
            known_limitations: params[18] as string | null,
            active: params[19] as boolean,
          };
          this.sourceDefinitions.push(created);
          return rows([{ id: created.id }]);
        }

        if (n.startsWith("select id, mapping_schema from property_ingest.source_definitions")) {
          const [jurisdictionId, sourceKey, contractVersion] = params as [string, string, number];
          return rows(
            this.sourceDefinitions
              .filter(
                (row) =>
                  row.jurisdiction_id === jurisdictionId &&
                  row.source_key === sourceKey &&
                  row.contract_version === contractVersion,
              )
              .map((row) => ({ id: row.id, mapping_schema: row.mapping_schema })),
          );
        }

        if (n.startsWith("update property_ingest.source_definitions")) {
          const [id, frequency, policy, owner, limitations, active] = params as [
            string,
            string,
            string,
            string,
            string | null,
            boolean,
          ];
          const row = this.sourceDefinitions.find((item) => item.id === id);
          if (row) {
            row.expected_update_frequency = frequency;
            row.schedule_policy = policy;
            row.scheduler_owner = owner;
            row.known_limitations = limitations;
            row.active = active;
          }
          return rows([]);
        }

        throw new Error(`unexpected SQL in fake registry: ${n.slice(0, 120)}`);
      },
    });
  }
}

// St. Louis City is an independent city: a county_equivalent whose own FIPS
// is 29510 within Missouri (state FIPS 29). This is the real jurisdiction the
// mo_st_louis_lra_inventory_v1 contract is registered against.
const stLouisCity: NationwideJurisdictionManifest = {
  jurisdictionType: "county_equivalent",
  name: "St. Louis City",
  legalName: "St. Louis city",
  stateName: "Missouri",
  stateLegalName: "State of Missouri",
  stateCode: "MO",
  stateFips: "29",
  countyFips: "29510",
  timezone: "America/Chicago",
};

function lraManifest(overrides: Partial<NationwideSourceManifest> = {}): NationwideSourceManifest {
  return {
    sourceKey: "mo_st_louis_lra_inventory_v1",
    contractVersion: 3,
    mappingVersion: 1,
    jurisdiction: stLouisCity,
    publisherName: "City of St. Louis",
    publishingAgency: "Land Reutilization Authority",
    sourceFamily: "acquisition_inventory",
    assetClass: "real_property",
    landingPageUrl: "https://www.stlouis-mo.gov/data/",
    retrievalMethod: "arcgis_feature_service",
    sourceFormat: "api",
    parserName: "st-louis-lra-arcgis",
    parserVersion: "1.0.0",
    authoritativeIdentifierTypes: ["asr_parcel_id"],
    identityEstablishmentMode: "single_authoritative_identifier",
    recordLane: "property_record",
    withdrawalMode: "complete_snapshot",
    serviceMaximum: 2000,
    batchSize: 500,
    leaseSeconds: 900,
    schedulePolicy: { mode: "manual" },
    expectedUpdateFrequency: "weekly",
    schedulerOwner: "accountabul-ops",
    knownLimitations: null,
    active: true,
    ...overrides,
  };
}

test("registering a source creates its canonical state and county jurisdictions once", async () => {
  const database = new FakeNationwideRegistry();
  const registered = await registerNationwideSourceManifest(database, lraManifest());

  assert.equal(registered.replayed, false);
  assert.match(registered.sourceDefinitionId, /^[0-9a-f-]{36}$/);
  assert.match(registered.manifestFingerprint, /^[0-9a-f]{64}$/);

  const state = database.jurisdictions.find((row) => row.jurisdiction_type === "state");
  const county = database.jurisdictions.find(
    (row) => row.jurisdiction_type === "county_equivalent",
  );
  assert.equal(state?.state_code, "MO");
  assert.equal(state?.state_fips, "29");
  assert.equal(county?.county_fips, "29510");
  assert.equal(county?.parent_id, state?.id, "the county hangs off its own state");
  assert.equal(registered.jurisdictionId, county?.id);
  assert.equal(registered.stateJurisdictionId, state?.id);
  assert.equal(database.sourceDefinitions.length, 1);
  assert.equal(database.sourceDefinitions[0].source_key, "mo_st_louis_lra_inventory_v1");
});

test("re-registering the identical contract is a replay, not a duplicate", async () => {
  const database = new FakeNationwideRegistry();
  const first = await registerNationwideSourceManifest(database, lraManifest());
  const second = await registerNationwideSourceManifest(database, lraManifest());

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.sourceDefinitionId, first.sourceDefinitionId);
  assert.equal(second.manifestFingerprint, first.manifestFingerprint);
  assert.equal(database.sourceDefinitions.length, 1, "no duplicate source definition row");
  assert.equal(
    database.jurisdictions.filter((row) => row.jurisdiction_type === "county_equivalent").length,
    1,
    "no duplicate county jurisdiction",
  );
});

test("contract drift at the same contractVersion is refused", async () => {
  const database = new FakeNationwideRegistry();
  await registerNationwideSourceManifest(database, lraManifest());

  await assert.rejects(
    registerNationwideSourceManifest(database, lraManifest({ parserVersion: "2.0.0" })),
    /contract drift requires a new contractVersion/,
  );
  await assert.rejects(
    registerNationwideSourceManifest(database, lraManifest({ batchSize: 250 })),
    /contract drift requires a new contractVersion/,
  );
});

test("a new contractVersion registers alongside the old one instead of rewriting it", async () => {
  const database = new FakeNationwideRegistry();
  const v3 = await registerNationwideSourceManifest(database, lraManifest());
  const v4 = await registerNationwideSourceManifest(
    database,
    lraManifest({ contractVersion: 4, parserVersion: "2.0.0" }),
  );

  assert.equal(v4.replayed, false);
  assert.notEqual(v4.sourceDefinitionId, v3.sourceDefinitionId);
  assert.equal(database.sourceDefinitions.length, 2);
  assert.deepEqual(database.sourceDefinitions.map((row) => row.contract_version).sort(), [3, 4]);
});

test("operational fields update in place without counting as contract drift", async () => {
  const database = new FakeNationwideRegistry();
  await registerNationwideSourceManifest(database, lraManifest());

  const replayed = await registerNationwideSourceManifest(
    database,
    lraManifest({
      active: false,
      schedulerOwner: "accountabul-oncall",
      expectedUpdateFrequency: "daily",
      knownLimitations: "Layer is refreshed irregularly.",
      schedulePolicy: {
        mode: "interval",
        anchorUtc: "2026-09-24T00:00:00.000Z",
        intervalMinutes: 1440,
        catchUpLimit: 3,
      },
    }),
  );

  assert.equal(replayed.replayed, true);
  const stored = database.sourceDefinitions[0];
  assert.equal(stored.active, false);
  assert.equal(stored.scheduler_owner, "accountabul-oncall");
  assert.equal(stored.expected_update_frequency, "daily");
  assert.equal(stored.known_limitations, "Layer is refreshed irregularly.");
  assert.equal(JSON.parse(stored.schedule_policy).intervalMinutes, 1440);
});

test("a FIPS code shared by two canonical state rows fails closed", async () => {
  const database = new FakeNationwideRegistry();
  const duplicate = {
    parent_id: null,
    jurisdiction_type: "state",
    name: "Missouri",
    legal_name: null,
    state_code: "MO",
    state_fips: "29",
    county_fips: null,
    place_fips: null,
    gnis_id: null,
    timezone: null,
  };
  database.jurisdictions.push(
    { id: randomUUID(), ...duplicate },
    { id: randomUUID(), ...duplicate },
  );

  await assert.rejects(
    registerNationwideSourceManifest(database, lraManifest()),
    /multiple canonical state jurisdictions share the same FIPS code/,
  );
});

test("a county jurisdiction manifest without countyFips is rejected", async () => {
  const database = new FakeNationwideRegistry();
  await assert.rejects(
    registerNationwideJurisdiction(database, { ...stLouisCity, countyFips: null }),
    /county-equivalent manifest requires a five-digit county FIPS/,
  );
});

test("registering a jurisdiction alone creates geography without any source definition", async () => {
  const database = new FakeNationwideRegistry();
  const result = await registerNationwideJurisdiction(database, stLouisCity);

  assert.match(result.jurisdictionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(result.jurisdictionId, result.stateJurisdictionId);
  assert.equal(database.sourceDefinitions.length, 0);
  assert.equal(database.jurisdictions.length, 2, "one state, one county");
});
