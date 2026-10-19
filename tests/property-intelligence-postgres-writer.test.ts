// Slice 4 of the nationwide multi-state ingestion port. Exercises
// persistNormalizedPropertyRecordBundle against a hand-written, in-memory
// fake PostgresTransactionHost modeling the record/search tables it writes
// to (supabase/migrations/20260924170000_property_intelligence_record_model.sql).
// Never a network connection, never a real or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { persistNormalizedPropertyRecordBundle } from "../src/lib/property-intelligence/nationwide-postgres-writer.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";
import type { NormalizedPropertyRecordBundle } from "../src/lib/property-intelligence/nationwide-property-intake-types.ts";

const SOURCE_DEFINITION_ID = randomUUID();
const JURISDICTION_ID = randomUUID();
const INGESTION_RUN_ID = randomUUID();
const SOURCE_KEY = "mo_st_louis_lra_inventory_v1";

class FakeWriterDatabase implements PostgresTransactionHost {
  sourceDocuments: Array<{ id: string; sha256: string }> = [];
  sourceRecords: Array<{ id: string; source_record_key: string; record_fingerprint: string }> = [];
  sourceRecordOccurrences: Array<{
    id: string;
    ingestion_run_id: string;
    occurrence_key: string;
    resolution_status: string;
    resolved_property_id: string | null;
  }> = [];
  sourceRecordStates: Array<{
    source_definition_id: string;
    source_record_key: string;
    current_source_record_id: string;
    last_seen_at: string;
  }> = [];
  resolutionCases: Array<{
    id: string;
    source_record_id: string;
    algorithm_version: string;
    accepted_property_id: string | null;
  }> = [];
  propertyRecordListings: Array<{
    source_record_id: string;
    property_id: string | null;
    record_kind: string;
    lifecycle_state: string;
  }> = [];
  propertyRecordSearch: Array<{
    source_definition_id: string;
    source_record_key: string;
    property_id: string | null;
    resolution_status: string;
  }> = [];
  properties: Array<{ id: string; jurisdiction_id: string }> = [];
  propertyIdentifiers: Array<{
    property_id: string;
    issuer_jurisdiction_id: string;
    identifier_type: string;
    normalized_value: string;
  }> = [];
  propertySearch: Array<{ property_id: string }> = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("select source_key, jurisdiction_id, contract_version")) {
          return {
            rows: [
              {
                source_key: SOURCE_KEY,
                jurisdiction_id: JURISDICTION_ID,
                contract_version: 3,
                authoritative_identifier_types: [],
                identity_establishment_mode: "match_only",
              },
            ],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select state_code, county_fips, name from property_core.jurisdictions")) {
          return {
            rows: [{ state_code: "MO", county_fips: "29510", name: "St. Louis City" }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_documents")) {
          const [, , , , , , , , , sha256] = params as string[];
          const existing = this.sourceDocuments.find((row) => row.sha256 === sha256);
          if (existing)
            return { rows: [{ id: existing.id }] } as unknown as PostgresQueryResult<Row>;
          const row = { id: randomUUID(), sha256 };
          this.sourceDocuments.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("update property_ingest.ingestion_runs set source_document_id")) {
          return { rows: [{ id: INGESTION_RUN_ID }] } as unknown as PostgresQueryResult<Row>;
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
            source_record_key: sourceRecordKey,
            record_fingerprint: recordFingerprint,
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
            ,
            ,
            ,
            resolutionStatus,
            ,
            resolvedPropertyId,
          ] = params as (string | null)[];
          const row = {
            id: randomUUID(),
            ingestion_run_id: ingestionRunId as string,
            occurrence_key: occurrenceKey as string,
            resolution_status: resolutionStatus as string,
            resolved_property_id: resolvedPropertyId,
          };
          this.sourceRecordOccurrences.push(row);
          void sourceRecordId;
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.source_record_states")) {
          const [sourceDefinitionId, sourceRecordKey, currentSourceRecordId, lastSeenAt] =
            params as string[];
          this.sourceRecordStates.push({
            source_definition_id: sourceDefinitionId,
            source_record_key: sourceRecordKey,
            current_source_record_id: currentSourceRecordId,
            last_seen_at: lastSeenAt,
          });
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("update property_ingest.source_record_occurrences set resolution_status")
        ) {
          const [occurrenceId, resolutionStatus, , resolvedPropertyId] = params as (
            string | null
          )[];
          const row = this.sourceRecordOccurrences.find(
            (candidate) => candidate.id === occurrenceId,
          );
          if (!row) throw new Error("property-record occurrence resolution update failed");
          row.resolution_status = resolutionStatus as string;
          row.resolved_property_id = resolvedPropertyId;
          return { rows: [{ id: occurrenceId }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.resolution_cases")) {
          const [sourceRecordId, algorithmVersion, , , acceptedPropertyId] = params as (
            string | null
          )[];
          const row = {
            id: randomUUID(),
            source_record_id: sourceRecordId as string,
            algorithm_version: algorithmVersion as string,
            accepted_property_id: acceptedPropertyId,
          };
          this.resolutionCases.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_ingest.resolution_candidates")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select pg_advisory_xact_lock")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("select property_id::text from property_core.property_identifiers")) {
          const [jurisdictionId, identifierType, normalizedValue] = params as string[];
          const rows = this.propertyIdentifiers
            .filter(
              (row) =>
                row.issuer_jurisdiction_id === jurisdictionId &&
                row.identifier_type === identifierType &&
                row.normalized_value === normalizedValue,
            )
            .map((row) => ({ property_id: row.property_id }));
          return { rows } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.properties")) {
          const [jurisdictionId] = params as string[];
          const row = { id: randomUUID(), jurisdiction_id: jurisdictionId };
          this.properties.push(row);
          return { rows: [{ id: row.id }] } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("insert into property_core.property_identifiers") &&
          n.includes("returning property_id::text")
        ) {
          const [propertyId, issuerJurisdictionId, identifierType, , normalizedValue] =
            params as string[];
          this.propertyIdentifiers.push({
            property_id: propertyId,
            issuer_jurisdiction_id: issuerJurisdictionId,
            identifier_type: identifierType,
            normalized_value: normalizedValue,
          });
          return { rows: [{ property_id: propertyId }] } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith("insert into property_core.property_identifiers") &&
          n.includes("do update set raw_value")
        ) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.property_addresses"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("insert into property_core.property_observations"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("select p.jurisdiction_id, j.state_code")) {
          return {
            rows: [
              {
                jurisdiction_id: JURISDICTION_ID,
                state_code: "MO",
                county_fips: "29510",
                county_name: "St. Louis City",
                latitude: null,
                longitude: null,
              },
            ],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (
          n.startsWith(
            "select identifier_type, normalized_value from property_core.property_identifiers",
          )
        )
          return { rows: [] } as PostgresQueryResult<Row>;
        if (
          n.startsWith(
            "select raw_address, city, postal_code from property_core.property_addresses",
          )
        )
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("select distinct on (fact_type"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("select inventory.lifecycle_state"))
          return { rows: [] } as PostgresQueryResult<Row>;
        if (n.startsWith("insert into property_api.property_search")) {
          const [propertyId] = params as string[];
          this.propertySearch.push({ property_id: propertyId });
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_core.property_record_listings")) {
          const [sourceRecordId, propertyId, , recordKind, lifecycleState] = params as (
            string | null
          )[];
          const existing = this.propertyRecordListings.find(
            (row) => row.source_record_id === sourceRecordId,
          );
          if (existing) {
            existing.property_id = existing.property_id ?? propertyId;
          } else {
            this.propertyRecordListings.push({
              source_record_id: sourceRecordId as string,
              property_id: propertyId,
              record_kind: recordKind as string,
              lifecycle_state: lifecycleState as string,
            });
          }
          return {
            rows: [{ source_record_id: sourceRecordId }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (n.startsWith("insert into property_api.property_record_search")) {
          const [
            sourceDefinitionId,
            sourceRecordKey,
            sourceRecordId,
            propertyId,
            resolutionStatus,
          ] = params as (string | null)[];
          void sourceRecordId;
          const existing = this.propertyRecordSearch.find(
            (row) =>
              row.source_definition_id === sourceDefinitionId &&
              row.source_record_key === sourceRecordKey,
          );
          if (existing) {
            existing.property_id = propertyId;
            existing.resolution_status = resolutionStatus as string;
          } else {
            this.propertyRecordSearch.push({
              source_definition_id: sourceDefinitionId as string,
              source_record_key: sourceRecordKey as string,
              property_id: propertyId,
              resolution_status: resolutionStatus as string,
            });
          }
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        // Gap-closing attribute-visibility layer (nationwide-attribute-extensions.ts):
        // this fixture's bundles carry no extensions, so there is nothing to
        // find and the "private until reviewed" query always comes back empty.
        if (n.startsWith("select distinct on (definition.attribute_key)")) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }

        throw new Error(`FakeWriterDatabase: unmodeled query: ${n.slice(0, 100)}`);
      },
    });
  }
}

function unresolvedBundle(
  overrides: Partial<NormalizedPropertyRecordBundle> = {},
): NormalizedPropertyRecordBundle {
  return {
    jurisdiction: {
      stateCode: "MO",
      countyName: "St. Louis City",
      countyFips: "29510",
      censusGeoid: "0500000US29510",
    },
    sourceRecord: {
      sourceDefinitionKey: SOURCE_KEY,
      sourceRecordKey: "lra-parcel-1",
      sourceVersion: "1",
      recordFingerprint: "a".repeat(64),
      sourceDocumentSha256: "b".repeat(64),
      sourceDocumentUrl: "https://www.stlouis-mo.gov/lra/parcel-1",
      sourceDocumentRetrievedAt: "2026-09-24T00:00:00.000Z",
      sourceDocumentPublishedAt: null,
      sourceDocumentObjectStorageKey: null,
      sourceDocumentMimeType: null,
      sourceDocumentByteSize: null,
      sourceUrl: "https://www.stlouis-mo.gov/lra/parcel-1",
      documentTitle: "LRA inventory",
      pageLocator: null,
      rowLocator: "1",
      featureLocator: "1",
      parsingStatus: "accepted",
      warnings: [],
      rawJson: {},
    },
    propertyCandidate: {
      identifiers: [
        {
          identifierType: "parcel_number",
          issuerCountyFips: "29510",
          rawValue: "1234-56-7890",
          normalizedValue: "1234567890",
          verificationStatus: "published",
          isAuthoritative: false,
        },
      ],
      addresses: [],
      observations: [],
      latitude: null,
      longitude: null,
    },
    listing: {
      recordKind: "land_bank_inventory_item",
      lifecycleState: "available",
      publishedStatusText: "Available",
      publishedOwnerText: "Land Reutilization Authority",
      legalDescription: null,
      publishedAmount: null,
      publishedAmountType: null,
      publishedAmountLabel: null,
    },
    resolution: {
      status: "unresolved",
      automaticMethodsAllowed: [],
      addressOnlyMatchAllowed: false,
      reason:
        "No jurisdiction-scoped property identifier was published; retain the lot as searchable and unresolved.",
    },
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof persistNormalizedPropertyRecordBundle>[1]> = {},
) {
  return {
    bundle: unresolvedBundle(),
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    jurisdictionId: JURISDICTION_ID,
    ingestionRunId: INGESTION_RUN_ID,
    resolution: {
      status: "unresolved" as const,
      propertyId: null,
      method: null,
      candidatePropertyIds: [],
      matchedIdentifiers: [],
      evidenceReferences: [],
      reason: "No enabled identifier match policy authorizes automatic resolution for this source.",
    },
    resolutionAlgorithmVersion: "test-algorithm-v1",
    ...overrides,
  };
}

test("Slice 4: a non-auction record stays searchable while unresolved -- no property is linked, but it is not dropped", async () => {
  const database = new FakeWriterDatabase();
  const result = await persistNormalizedPropertyRecordBundle(database, baseInput());

  assert.equal(result.propertyId, null);
  const listing = database.propertyRecordListings.find(
    (row) => row.source_record_id === result.sourceRecordId,
  );
  assert.ok(listing, "the listing row is still written even though the record is unresolved");
  assert.equal(listing?.property_id, null);
  const search = database.propertyRecordSearch.find(
    (row) => row.source_record_key === "lra-parcel-1",
  );
  assert.ok(
    search,
    "the search projection row is still written even though the record is unresolved",
  );
  assert.equal(search?.resolution_status, "unresolved");
  assert.equal(search?.property_id, null);
});

test("Slice 4: a resolved record resolves safely -- the accepted property is linked and its search row refreshed", async () => {
  const database = new FakeWriterDatabase();
  const propertyId = randomUUID();
  const result = await persistNormalizedPropertyRecordBundle(
    database,
    baseInput({
      resolution: {
        status: "resolved",
        propertyId,
        method: "exact_scoped_identifier",
        candidatePropertyIds: [propertyId],
        matchedIdentifiers: [
          {
            sourceIdentifierType: "parcel_number",
            canonicalIdentifierType: "parcel_number",
            issuerCountyFips: "29510",
            normalizedValue: "1234567890",
            propertyId,
            policyVersion: "v1",
          },
        ],
        evidenceReferences: ["policy-doc-1"],
        reason: "All authorized exact scoped identifier matches point to one canonical property.",
      },
    }),
  );

  assert.equal(result.propertyId, propertyId);
  const listing = database.propertyRecordListings.find(
    (row) => row.source_record_id === result.sourceRecordId,
  );
  assert.equal(listing?.property_id, propertyId);
  const search = database.propertyRecordSearch.find(
    (row) => row.source_record_key === "lra-parcel-1",
  );
  assert.equal(search?.property_id, propertyId);
  assert.equal(search?.resolution_status, "resolved");
  assert.ok(
    database.propertySearch.some((row) => row.property_id === propertyId),
    "the canonical property_search row is refreshed when a property resolves",
  );
});
