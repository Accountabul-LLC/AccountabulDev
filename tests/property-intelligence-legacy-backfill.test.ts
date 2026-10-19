// Slice 5 (final) of the nationwide multi-state ingestion port. Covers
// nationwide-legacy-backfill.ts: the three pure `normalizeLegacy*`
// normalizers (matching property-intelligence-app's
// tests/legacy-lovable-intake.test.mjs contract) and the backfill executor
// functions (`executeLegacyLraBackfill` / `executeLegacyStLouisTaxSaleBackfill`
// / `executeLegacyCookCountyBackfill`), matching the load-bearing behavior
// of the source's tests/nationwide-lovable-backfill.test.mjs
// ("Lovable exports flow into separate searchable/auction lanes") against a
// hand-written, in-memory fake PostgresTransactionHost combining this
// repo's established run-store and writer fake-DB test style
// (tests/property-intelligence-postgres-run-store.test.ts,
// tests/property-intelligence-postgres-writer.test.ts). Never a network
// connection, never a real or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  executeLegacyCookCountyBackfill,
  executeLegacyLraBackfill,
  executeLegacyStLouisTaxSaleBackfill,
  normalizeLegacyCookCountyProperty,
  normalizeLegacyLraProperty,
  normalizeLegacyStLouisTaxSale,
} from "../src/lib/property-intelligence/nationwide-legacy-backfill.ts";
import { buildPropertyRecordSearchDocument } from "../src/lib/property-intelligence/nationwide-property-search.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";
import type { PropertyResolutionResult } from "../src/lib/property-intelligence/nationwide-property-resolution.ts";

const stLouis = { stateCode: "MO", countyName: "St. Louis City", countyFips: "29510" };
const cook = { stateCode: "IL", countyName: "Cook County", countyFips: "17031" };
const document = {
  url: "https://example.gov/property-inventory.csv",
  title: "Published property inventory",
  sha256: "a".repeat(64),
  retrievedAt: "2026-08-19T12:00:00.000Z",
  publishedAt: "2026-08-18T12:00:00.000Z",
};

const unresolved: PropertyResolutionResult = {
  status: "unresolved",
  propertyId: null,
  method: null,
  candidatePropertyIds: [],
  matchedIdentifiers: [],
  evidenceReferences: [],
  reason: "No approved exact match exists.",
};

const lraRow = {
  id: "legacy-row-id",
  parcel_id: "00209030000",
  apn: "00209030000",
  parcel_status: "Available",
  usage: "Side Lot",
  property_source: "LRA",
  address: "10 ASHLEY ST",
  zip: "63147",
  ward: 8,
  neighborhood_number: 79,
  neighborhood: "Near North Riverfront",
  property_type: "Lot",
  side_lot_eligible: true,
  nbr_of_units: "1 Family",
  sqft: 53051,
  latitude: 38.7001,
  longitude: -90.215,
  legal_description: "Published legal description",
  updated_at: "2026-08-19T12:01:00.000Z",
};

test("legacy LRA rows retain one county-scoped parcel identity without duplicating the APN alias", async () => {
  const bundle = await normalizeLegacyLraProperty({
    jurisdiction: stLouis,
    document,
    rowNumber: 1,
    row: lraRow,
  });
  assert.equal(bundle.sourceRecord.sourceRecordKey, "29510:lra:00209030000");
  assert.equal(bundle.sourceRecord.parsingStatus, "accepted");
  assert.deepEqual(
    bundle.propertyCandidate.identifiers.map((item) => item.identifierType),
    ["parcel_number"],
  );
  assert.match(bundle.sourceRecord.warnings[0] ?? "", /duplicates parcel_id/i);
  assert.equal(
    bundle.propertyCandidate.observations.find((item) => item.factType === "unit_count")?.value,
    1,
  );
  assert.equal(bundle.listing.lifecycleState, "available");

  const moved = await normalizeLegacyLraProperty({
    jurisdiction: stLouis,
    document: { ...document, sha256: "b".repeat(64), retrievedAt: "2026-08-20T12:00:00.000Z" },
    rowNumber: 99,
    row: { ...lraRow, updated_at: "2026-08-20T12:00:00.000Z" },
  });
  assert.equal(moved.sourceRecord.recordFingerprint, bundle.sourceRecord.recordFingerprint);

  const changed = await normalizeLegacyLraProperty({
    jurisdiction: stLouis,
    document,
    rowNumber: 1,
    row: { ...lraRow, parcel_status: "Unavailable" },
  });
  assert.notEqual(changed.sourceRecord.recordFingerprint, bundle.sourceRecord.recordFingerprint);
  const changedUnmodeledField = await normalizeLegacyLraProperty({
    jurisdiction: stLouis,
    document,
    rowNumber: 1,
    row: { ...lraRow, vendor_extra_field: "new published value" },
  });
  assert.notEqual(
    changedUnmodeledField.sourceRecord.recordFingerprint,
    bundle.sourceRecord.recordFingerprint,
  );

  const search = buildPropertyRecordSearchDocument(bundle, unresolved);
  assert.equal(search.propertyId, null);
  assert.equal(search.recordKind, "land_bank_inventory_item");
  assert.equal(search.landSquareFeet, 53051);
  assert.match(search.searchText, /10 ashley st/);
  assert.match(search.searchText, /00209030000/);
});

test("legacy St. Louis tax-sale rows preserve the land-tax number without inventing an APN", async () => {
  const bundle = await normalizeLegacyStLouisTaxSale({
    jurisdiction: stLouis,
    document: { ...document, title: "Sheriff Land Tax Sale 236" },
    rowNumber: 2,
    row: {
      sale_number: "236",
      land_tax_number: "236-119",
      apn: "236-119",
      owner: "SECOND STREET SANDWICHES INC",
      address: "3150 S GRAND BLVD",
      total_amount: "378,379.00",
      zip: "63118",
    },
  });
  assert.equal(bundle.auction.saleMechanism, "sheriff_or_judicial_sale");
  assert.equal(bundle.auction.lifecycle[0]?.eventType, "advertised");
  assert.equal(bundle.auction.amounts[0]?.amount, 378379);
  assert.deepEqual(
    bundle.propertyCandidate.identifiers.map((item) => item.identifierType),
    ["tax_sale_parcel_reference"],
  );
  assert.equal(bundle.propertyCandidate.addresses[0]?.role, "unknown_published");
  assert.match(bundle.sourceRecord.warnings[0] ?? "", /not promoted as a cadastral identifier/i);
});

test("legacy Cook County rows retain separate APN and PIN candidates and searchable assessor facts", async () => {
  const bundle = await normalizeLegacyCookCountyProperty({
    jurisdiction: cook,
    document,
    rowNumber: 3,
    row: {
      source_name: "cook_county",
      source_record_id: "42",
      apn: "12-34-567-890-0000",
      pin: "PIN-12345678900001",
      address: "100 W RANDOLPH ST",
      city: "Chicago",
      state: "IL",
      zip: "60601",
      property_type: "Commercial",
      land_use: "Office",
      building_sqft: 100000,
      land_sqft: 20000,
      assessed_land: 500000,
      assessed_improvement: 1500000,
      market_value: 8000000,
      latitude: 41.884,
      longitude: -87.631,
      raw: { published_field: "retained" },
    },
  });
  assert.deepEqual(
    bundle.propertyCandidate.identifiers.map((item) => item.identifierType),
    ["apn", "pin"],
  );
  assert.equal(
    bundle.propertyCandidate.identifiers.every((item) => item.issuerCountyFips === "17031"),
    true,
  );
  assert.equal(bundle.sourceRecord.rawJson.published_field, "retained");
  const search = buildPropertyRecordSearchDocument(bundle, unresolved);
  assert.equal(search.assessedValue, 2000000);
  assert.equal(search.marketValue, 8000000);
  assert.match(search.searchText, /chicago/);
});

test("legacy adapters reject invalid geography and negative published values", async () => {
  await assert.rejects(
    normalizeLegacyLraProperty({
      jurisdiction: { ...stLouis, countyFips: "2951" },
      document,
      rowNumber: 1,
      row: lraRow,
    }),
    /five-digit Census county GEOID/i,
  );
  await assert.rejects(
    normalizeLegacyStLouisTaxSale({
      jurisdiction: stLouis,
      document,
      rowNumber: 1,
      row: {
        sale_number: "236",
        land_tax_number: "236-001",
        address: "1 MAIN ST",
        total_amount: -1,
      },
    }),
    /cannot be negative/i,
  );
});

// --- Backfill executor: combined run-store + writer fake DB ---------------

const SOURCE_DEFINITION_ID = randomUUID();
const JURISDICTION_ID = randomUUID();
const TAX_SOURCE_DEFINITION_ID = randomUUID();
const TAX_JURISDICTION_ID = randomUUID();

type OccurrenceRow = {
  id: string;
  ingestion_run_id: string;
  resolution_status: string;
  resolved_property_id: string | null;
  created_new_version: boolean;
  parsing_status: string;
};

class FakeLegacyBackfillDatabase implements PostgresTransactionHost {
  runs: Array<{
    id: string;
    source_definition_id: string;
    run_key: string;
    withdrawal_mode: string;
    completed_at: string | null;
    withdrawals_allowed: boolean;
    source_reported_count: number;
    service_maximum: number;
    expected_set_fingerprint: string;
    run_contract_fingerprint: string;
    discovery_status: string;
    mapping_version: number;
    expected_unique_count: number;
  }> = [];
  snapshotMembers: Array<{
    ingestion_run_id: string;
    source_object_key: string;
    expected: boolean;
    returned_occurrences: number;
  }> = [];
  batches: Array<{
    id: string;
    ingestion_run_id: string;
    batch_number: number;
    status: string;
    error_summary: string | null;
    request_fingerprint: string;
    result_fingerprint: string;
  }> = [];
  batchMembers: Array<{
    ingestion_batch_id: string;
    source_object_key: string;
    requested: boolean;
    returned_occurrences: number;
  }> = [];
  sourceDocuments: Array<{ id: string; sha256: string }> = [];
  sourceRecords: Array<{ id: string; source_record_key: string; record_fingerprint: string }> = [];
  occurrences: OccurrenceRow[] = [];
  propertyRecordListings: Array<{
    source_record_id: string;
    property_id: string | null;
    record_kind: string;
  }> = [];
  propertyRecordSearch: Array<{
    source_definition_id: string;
    source_record_key: string;
    property_id: string | null;
    resolution_status: string;
  }> = [];
  auctionEvents: Array<{ id: string }> = [];
  auctionLots: Array<{ id: string }> = [];
  auctionLotSearch: Array<{
    source_definition_id: string;
    sale_mechanism: string;
    state_code: string;
    county_fips: string;
    published_identifier_text: string | null;
    published_address_text: string | null;
    total_due: number | null;
    resolution_status: string;
    search_text: string;
  }> = [];

  private contracts = new Map<
    string,
    { sourceKey: string; jurisdictionId: string; identityMode: string }
  >();

  registerContract(sourceDefinitionId: string, jurisdictionId: string, sourceKey: string) {
    this.contracts.set(sourceDefinitionId, {
      sourceKey,
      jurisdictionId,
      identityMode: "match_only",
    });
  }

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("select id from property_ingest.source_definitions where id = $1")) {
          return { rows: [{ id: params[0] }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.ingestion_runs")) {
          const [
            sourceDefinitionId,
            runKey,
            ,
            attempt,
            mappingVersion,
            ,
            serviceMaximum,
            expectedSetFingerprint,
            runContractFingerprint,
            withdrawalMode,
            discoveryStatus,
            ,
            ,
            ,
            ,
            ,
            reportedCount,
            expectedUniqueCount,
          ] = params as [
            string,
            string,
            string,
            number,
            number,
            string,
            number,
            string,
            string,
            string,
            string,
            unknown,
            unknown,
            unknown,
            unknown,
            string,
            number,
            number,
            string,
          ];
          const conflict = this.runs.find(
            (row) => row.source_definition_id === sourceDefinitionId && row.run_key === runKey,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const row = {
            id: randomUUID(),
            source_definition_id: sourceDefinitionId,
            run_key: runKey,
            withdrawal_mode: withdrawalMode,
            completed_at: null,
            withdrawals_allowed: false,
            source_reported_count: reportedCount,
            service_maximum: serviceMaximum,
            expected_set_fingerprint: expectedSetFingerprint,
            run_contract_fingerprint: runContractFingerprint,
            discovery_status: discoveryStatus,
            mapping_version: mappingVersion,
            expected_unique_count: expectedUniqueCount,
          };
          this.runs.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("insert into property_ingest.snapshot_members (") &&
          n.includes("true, 0")
        ) {
          const [runId, sourceObjectKey] = params as [string, string];
          this.snapshotMembers.push({
            ingestion_run_id: runId,
            source_object_key: sourceObjectKey,
            expected: true,
            returned_occurrences: 0,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select id, mapping_version, service_maximum, expected_set_fingerprint")) {
          const [sourceDefinitionId, runKey] = params as [string, string];
          const row = this.runs.find(
            (candidate) =>
              candidate.source_definition_id === sourceDefinitionId && candidate.run_key === runKey,
          );
          if (!row) throw new Error("run replay lookup failed");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("select completed_at, service_maximum from property_ingest.ingestion_runs")
        ) {
          const [runId] = params as [string];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("runId does not identify an ingestion run");
          return {
            rows: [{ completed_at: row.completed_at, service_maximum: row.service_maximum }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.ingestion_batches")) {
          const [
            runId,
            batchNumber,
            ,
            ,
            status,
            requestFingerprint,
            resultFingerprint,
            ,
            ,
            ,
            ,
            ,
            ,
            errorSummary,
          ] = params as [
            string,
            number,
            number,
            number,
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            number | null,
            string,
            string,
            string | null,
          ];
          const conflict = this.batches.find(
            (row) => row.ingestion_run_id === runId && row.batch_number === batchNumber,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const row = {
            id: randomUUID(),
            ingestion_run_id: runId,
            batch_number: batchNumber,
            status,
            error_summary: errorSummary,
            request_fingerprint: requestFingerprint,
            result_fingerprint: resultFingerprint,
          };
          this.batches.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith(
            "select id, request_fingerprint, result_fingerprint from property_ingest.ingestion_batches",
          )
        ) {
          const [runId, batchNumber] = params as [string, number];
          const row = this.batches.find(
            (candidate) =>
              candidate.ingestion_run_id === runId && candidate.batch_number === batchNumber,
          );
          if (!row) throw new Error("batch replay lookup failed");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.ingestion_batch_members")) {
          const [batchId, sourceObjectKey, requested, returnedOccurrences] = params as [
            string,
            string,
            boolean,
            number,
          ];
          this.batchMembers.push({
            ingestion_batch_id: batchId,
            source_object_key: sourceObjectKey,
            requested,
            returned_occurrences: returnedOccurrences,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("insert into property_ingest.snapshot_members (") &&
          n.includes("false, $3")
        ) {
          const [runId, sourceObjectKey, returnedOccurrences] = params as [string, string, number];
          const existing = this.snapshotMembers.find(
            (row) => row.ingestion_run_id === runId && row.source_object_key === sourceObjectKey,
          );
          if (existing) existing.returned_occurrences += returnedOccurrences;
          else
            this.snapshotMembers.push({
              ingestion_run_id: runId,
              source_object_key: sourceObjectKey,
              expected: false,
              returned_occurrences: returnedOccurrences,
            });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("select source_key, jurisdiction_id, contract_version")) {
          const [sourceDefinitionId] = params as [string];
          const contract = this.contracts.get(sourceDefinitionId);
          if (!contract)
            throw new Error("sourceDefinitionId does not identify a registered source definition");
          return {
            rows: [
              {
                source_key: contract.sourceKey,
                jurisdiction_id: contract.jurisdictionId,
                contract_version: 2,
                authoritative_identifier_types: [],
                identity_establishment_mode: contract.identityMode,
              },
            ],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select state_code, county_fips, name from property_core.jurisdictions")) {
          const [jurisdictionId] = params as [string];
          if (jurisdictionId === JURISDICTION_ID) {
            return {
              rows: [{ state_code: "MO", county_fips: "29510", name: "St. Louis City" }],
            } as unknown as PostgresQueryResult<Row>;
          }
          if (jurisdictionId === TAX_JURISDICTION_ID) {
            return {
              rows: [{ state_code: "MO", county_fips: "29510", name: "St. Louis City" }],
            } as unknown as PostgresQueryResult<Row>;
          }
          return {
            rows: [{ state_code: "IL", county_fips: "17031", name: "Cook" }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_documents")) {
          const [, , , , , , , , , sha256] = params as string[];
          const existing = this.sourceDocuments.find((row) => row.sha256 === sha256);
          if (existing)
            return { rows: [{ id: existing.id }] } as unknown as PostgresQueryResult<Row>;
          const row = { id: randomUUID(), sha256: sha256 as string };
          this.sourceDocuments.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("update property_ingest.ingestion_runs set source_document_id")) {
          const [, runId] = params as [string, string];
          return { rows: [{ id: runId }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_records")) {
          const [, , , sourceRecordKey, , recordFingerprint] = params as string[];
          const conflict = this.sourceRecords.find(
            (row) =>
              row.source_record_key === sourceRecordKey &&
              row.record_fingerprint === recordFingerprint,
          );
          if (conflict) return { rows: [] } as PostgresQueryResult<Row>;
          const row = {
            id: randomUUID(),
            source_record_key: sourceRecordKey as string,
            record_fingerprint: recordFingerprint as string,
          };
          this.sourceRecords.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("update property_ingest.source_records set last_seen_at")) {
          const [, sourceRecordKey, recordFingerprint] = params as string[];
          const row = this.sourceRecords.find(
            (candidate) =>
              candidate.source_record_key === sourceRecordKey &&
              candidate.record_fingerprint === recordFingerprint,
          );
          if (!row) throw new Error("source record lookup after idempotent insert failed");
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_record_occurrences")) {
          const [
            sourceRecordId,
            ,
            ingestionRunId,
            occurrenceKey,
            ,
            ,
            ,
            ,
            parsingStatus,
            ,
            createdNewVersion,
            resolutionStatus,
            ,
            resolvedPropertyId,
          ] = params as (string | boolean | null)[];
          void sourceRecordId;
          void occurrenceKey;
          const row: OccurrenceRow = {
            id: randomUUID(),
            ingestion_run_id: ingestionRunId as string,
            resolution_status: resolutionStatus as string,
            resolved_property_id: resolvedPropertyId as string | null,
            created_new_version: createdNewVersion as boolean,
            parsing_status: parsingStatus as string,
          };
          this.occurrences.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_record_states")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("update property_ingest.source_record_occurrences set resolution_status")
        ) {
          const [occurrenceId, resolutionStatus, , resolvedPropertyId] = params as (
            string | null
          )[];
          const row = this.occurrences.find((candidate) => candidate.id === occurrenceId);
          if (!row) throw new Error("property-record occurrence resolution update failed");
          row.resolution_status = resolutionStatus as string;
          row.resolved_property_id = resolvedPropertyId;
          return { rows: [{ id: occurrenceId }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.resolution_cases")) {
          return { rows: [{ id: randomUUID() }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.resolution_candidates")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.property_record_listings")) {
          const [sourceRecordId, propertyId, , recordKind] = params as (string | null)[];
          this.propertyRecordListings.push({
            source_record_id: sourceRecordId as string,
            property_id: propertyId,
            record_kind: recordKind as string,
          });
          return {
            rows: [{ source_record_id: sourceRecordId }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_api.property_record_search")) {
          const [sourceDefinitionId, sourceRecordKey, , propertyId, resolutionStatus] = params as (
            string | null
          )[];
          this.propertyRecordSearch.push({
            source_definition_id: sourceDefinitionId as string,
            source_record_key: sourceRecordKey as string,
            property_id: propertyId,
            resolution_status: resolutionStatus as string,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (n.startsWith("insert into property_core.auction_events")) {
          const row = { id: randomUUID() };
          this.auctionEvents.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.auction_lots")) {
          const row = { id: randomUUID() };
          this.auctionLots.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.auction_amounts"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("insert into property_core.auction_parties"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("insert into property_core.auction_lifecycle_events"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("update property_core.auction_lot_properties set active = false"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("insert into property_api.auction_lot_search")) {
          const [
            ,
            sourceDefinitionId,
            ,
            ,
            resolutionStatus,
            ,
            stateCode,
            countyFips,
            ,
            saleMechanism,
            ,
            ,
            ,
            ,
            publishedIdentifierText,
            publishedAddressText,
            ,
            ,
            totalDue,
          ] = params as (string | number | null)[];
          this.auctionLotSearch.push({
            source_definition_id: sourceDefinitionId as string,
            sale_mechanism: saleMechanism as string,
            state_code: stateCode as string,
            county_fips: countyFips as string,
            published_identifier_text: publishedIdentifierText as string | null,
            published_address_text: publishedAddressText as string | null,
            total_due: totalDue as number | null,
            resolution_status: resolutionStatus as string,
            search_text: "",
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        if (
          n.startsWith(
            "select id, source_definition_id, source_reported_count, service_maximum, withdrawal_mode",
          )
        ) {
          const [runId] = params as [string];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("runId does not identify an ingestion run");
          return { rows: [row] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select source_object_key from property_ingest.snapshot_members")) {
          const [runId] = params as [string];
          const rows = this.snapshotMembers
            .filter((row) => row.ingestion_run_id === runId && row.expected)
            .map((row) => ({ source_object_key: row.source_object_key }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith(
            "select id, batch_number, status, error_summary from property_ingest.ingestion_batches",
          )
        ) {
          const [runId] = params as [string];
          const rows = this.batches.filter((row) => row.ingestion_run_id === runId);
          return { rows } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select member.ingestion_batch_id, member.source_object_key")) {
          const [runId] = params as [string];
          const batchIds = new Set(
            this.batches.filter((row) => row.ingestion_run_id === runId).map((row) => row.id),
          );
          const rows = this.batchMembers.filter((row) => batchIds.has(row.ingestion_batch_id));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }
        if (n.includes("as accepted,")) {
          const [runId] = params as [string];
          const occurrences = this.occurrences.filter((row) => row.ingestion_run_id === runId);
          return {
            rows: [
              {
                accepted: occurrences.length,
                unchanged: occurrences.filter((row) => !row.created_new_version).length,
                partial_parses: occurrences.filter((row) => row.parsing_status === "partial")
                  .length,
                unresolved: occurrences.filter((row) => row.resolution_status !== "resolved")
                  .length,
                linked: occurrences.filter((row) => row.resolution_status === "resolved").length,
                rejected: 0,
              },
            ],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select distinct error_summary from property_ingest.ingestion_batches")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith(
            "select source_record_key from property_ingest.source_record_states where withdrawal_run_id",
          )
        ) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("update property_ingest.ingestion_runs set")) {
          const [runId, completedAt, , , , , , , , , , , , coverageStatus, withdrawalsAllowed] =
            params as [
              string,
              string,
              string,
              string,
              string,
              string,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
              string,
              boolean,
            ];
          const row = this.runs.find((candidate) => candidate.id === runId);
          if (!row) throw new Error("run finalization update failed");
          row.completed_at = completedAt;
          row.withdrawals_allowed = withdrawalsAllowed;
          void coverageStatus;
          return { rows: [{ id: runId }] } as unknown as PostgresQueryResult<Row>;
        }

        // Gap-closing attribute-visibility layer (nationwide-attribute-extensions.ts):
        // this fixture's bundles carry no extensions, so there is nothing to
        // find and the "private until reviewed" query always comes back empty.
        if (n.startsWith("select distinct on (definition.attribute_key)")) {
          return { rows: [] } as unknown as PostgresQueryResult<Row>;
        }

        throw new Error(`FakeLegacyBackfillDatabase: unmodeled query: ${n.slice(0, 120)}`);
      },
    });
  }
}

test("Slice 5: Lovable-shaped exports flow into separate searchable property and auction lanes, and replay the same run", async () => {
  const database = new FakeLegacyBackfillDatabase();
  database.registerContract(SOURCE_DEFINITION_ID, JURISDICTION_ID, "mo_st_louis_lra_inventory_v1");
  database.registerContract(
    TAX_SOURCE_DEFINITION_ID,
    TAX_JURISDICTION_ID,
    "mo_st_louis_sheriff_tax_sale_v1",
  );

  const lraInput = {
    database,
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    jurisdictionId: JURISDICTION_ID,
    rows: [{ rowNumber: 1, row: lraRow }],
    document,
    sourceArtifact: {
      sha256: document.sha256,
      objectStorageKey: "legacy/lra/export.json",
      mimeType: "application/json",
      byteSize: 512,
    },
    runKey: "run-lra-2026-08-20",
    scheduledFor: "2026-08-20T14:00:00.000Z",
    initiatedBy: "legacy-backfill-test",
  };
  const lraRun = await executeLegacyLraBackfill(lraInput);

  const property = database.propertyRecordSearch.find(
    (row) => row.source_definition_id === SOURCE_DEFINITION_ID,
  );
  assert.ok(property);
  assert.equal(property?.resolution_status, "unresolved");
  assert.equal(property?.property_id, null);

  const taxRow = {
    sale_number: "236",
    land_tax_number: "236-119",
    owner: "SECOND STREET SANDWICHES INC",
    address: "3150 S GRAND BLVD",
    total_amount: 378_379,
    zip: "63118",
  };
  const taxRun = await executeLegacyStLouisTaxSaleBackfill({
    database,
    sourceDefinitionId: TAX_SOURCE_DEFINITION_ID,
    jurisdictionId: TAX_JURISDICTION_ID,
    rows: [{ rowNumber: 1, row: taxRow }],
    document: { ...document, sha256: "c".repeat(64) },
    sourceArtifact: {
      sha256: "c".repeat(64),
      objectStorageKey: "legacy/tax/export.json",
      mimeType: "application/json",
      byteSize: 512,
    },
    runKey: "run-tax-2026-08-20",
    scheduledFor: "2026-08-20T14:05:00.000Z",
    initiatedBy: "legacy-backfill-test",
  });

  const auction = database.auctionLotSearch.find(
    (row) => row.source_definition_id === TAX_SOURCE_DEFINITION_ID,
  );
  assert.ok(auction);
  assert.equal(auction?.sale_mechanism, "sheriff_or_judicial_sale");
  assert.equal(auction?.published_identifier_text, "236-119");
  assert.equal(auction?.total_due, 378_379);
  assert.equal(auction?.resolution_status, "unresolved");

  const replay = await executeLegacyLraBackfill(lraInput);
  assert.equal(replay.runId, lraRun.runId);
  const runRow = database.runs.find((row) => row.id === lraRun.runId);
  assert.equal(runRow?.source_definition_id, SOURCE_DEFINITION_ID);
  void taxRun;
});

test("Slice 5: a duplicate source object key in a legacy export fails closed before any database write", async () => {
  const database: PostgresTransactionHost = {
    async transaction() {
      throw new Error("must not be called -- duplicate detection happens before any query");
    },
  };
  await assert.rejects(
    executeLegacyCookCountyBackfill({
      database,
      sourceDefinitionId: SOURCE_DEFINITION_ID,
      jurisdictionId: JURISDICTION_ID,
      rows: [
        { rowNumber: 1, row: { source_name: "cook_county", apn: "12-34-567-890-0000" } },
        { rowNumber: 2, row: { source_name: "cook_county", apn: "12-34-567-890-0000" } },
      ],
      document,
      sourceArtifact: {
        sha256: document.sha256,
        objectStorageKey: "x",
        mimeType: "application/json",
        byteSize: 1,
      },
      runKey: "run-cook-dup",
      scheduledFor: "2026-08-20T14:00:00.000Z",
      initiatedBy: "legacy-backfill-test",
    }),
    /duplicate source object key/i,
  );
});

test("Slice 5: a mismatched source artifact SHA-256 fails closed before any database write", async () => {
  const database: PostgresTransactionHost = {
    async transaction() {
      throw new Error("must not be called -- SHA-256 validation happens before any query");
    },
  };
  await assert.rejects(
    executeLegacyLraBackfill({
      database,
      sourceDefinitionId: SOURCE_DEFINITION_ID,
      jurisdictionId: JURISDICTION_ID,
      rows: [{ rowNumber: 1, row: lraRow }],
      document,
      sourceArtifact: {
        sha256: "f".repeat(64),
        objectStorageKey: "x",
        mimeType: "application/json",
        byteSize: 1,
      },
      runKey: "run-lra-mismatch",
      scheduledFor: "2026-08-20T14:00:00.000Z",
      initiatedBy: "legacy-backfill-test",
    }),
    /source artifact SHA-256 must match/i,
  );
});
