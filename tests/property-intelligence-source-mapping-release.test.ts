// Slice 4/5 gap close (Gap 2: source field-mapping governance). Exercises
// publishNationwideSourceMappingRelease / loadNationwideSourceMappingRelease
// / projectNationwideSourceRecord against a hand-written, in-memory fake
// PostgresTransactionHost modeling the tables
// 20260924180000_property_intelligence_attribute_governance.sql adds. Never
// a network connection, never a real or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  publishNationwideSourceMappingRelease,
  loadNationwideSourceMappingRelease,
  projectNationwideSourceRecord,
} from "../src/lib/property-intelligence/nationwide-source-mapping-release.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

const SOURCE_DEFINITION_ID = randomUUID();
const RUN_ID = randomUUID();
const BATCH_ID = randomUUID();
const DECISION_ID = randomUUID();
const REVIEWER_ID = randomUUID();

type MappingDecisionRow = {
  id: string;
  source_definition_id: string;
  field_path: string;
  decision_version: number;
  decision: string;
  destination_relation: string | null;
  destination_field: string | null;
  attribute_definition_id: string | null;
  active: boolean;
};

class FakeMappingReleaseDatabase implements PostgresTransactionHost {
  source = {
    source_key: "mo_st_louis_lra_inventory_v1",
    contract_version: 1,
    mapping_schema: JSON.stringify({ mappingVersion: 1 }),
  };
  run = {
    id: RUN_ID,
    source_definition_id: SOURCE_DEFINITION_ID,
    mapping_version: 1,
    rows_seen: 2,
    completed_at: "2026-09-24T00:00:00.000Z" as string | null,
  };
  batches = [{ id: BATCH_ID, ingestion_run_id: RUN_ID, status: "succeeded", returned_count: 2 }];
  batchProfiles = [
    {
      ingestion_batch_id: BATCH_ID,
      profiled_record_count: 2,
      excluded_key_count: 0,
      truncated_record_count: 0,
      field_count: 1,
    },
  ];
  batchFieldProfiles = [
    {
      ingestion_batch_id: BATCH_ID,
      field_path: "/disposition",
      null_count: 0,
      object_count: 0,
      array_count: 0,
      string_count: 2,
      number_count: 0,
      boolean_count: 0,
    },
  ];
  mappingDecisions: MappingDecisionRow[] = [
    {
      id: DECISION_ID,
      source_definition_id: SOURCE_DEFINITION_ID,
      field_path: "/disposition",
      decision_version: 1,
      decision: "raw_only",
      destination_relation: null,
      destination_field: null,
      attribute_definition_id: null,
      active: true,
    },
  ];
  releases: Array<{
    id: string;
    source_definition_id: string;
    mapping_version: number;
    source_profile_run_id: string;
    release_fingerprint: string;
    field_count: number;
    release_note: string;
    released_by: string;
    released_at: string;
  }> = [];
  releaseFields: Array<Record<string, unknown>> = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("select source_key, contract_version, mapping_schema")) {
          return { rows: [this.source] as unknown as Row[] };
        }

        if (n.startsWith("select mapping_version, rows_seen, completed_at")) {
          const [id, sourceDefinitionId] = params as [string, string];
          if (this.run.id !== id || this.run.source_definition_id !== sourceDefinitionId) {
            return { rows: [] };
          }
          return { rows: [this.run] as unknown as Row[] };
        }

        if (n.startsWith("with field_totals as")) {
          const [runId] = params as [string];
          const batches = this.batches.filter((batch) => batch.ingestion_run_id === runId);
          const fieldTotals = new Map<string, number>();
          for (const field of this.batchFieldProfiles) {
            fieldTotals.set(
              field.ingestion_batch_id,
              (fieldTotals.get(field.ingestion_batch_id) ?? 0) + 1,
            );
          }
          let profileGapCount = 0;
          let unusableBatchCount = 0;
          let excludedKeyCount = 0;
          let truncatedRecordCount = 0;
          let profiledRecordCount = 0;
          for (const batch of batches) {
            const profile = this.batchProfiles.find((p) => p.ingestion_batch_id === batch.id);
            const usable = batch.status === "succeeded" || batch.status === "partial";
            if (!usable) unusableBatchCount += 1;
            if (
              usable &&
              (!profile ||
                profile.profiled_record_count !== batch.returned_count ||
                profile.field_count !== (fieldTotals.get(batch.id) ?? 0))
            ) {
              profileGapCount += 1;
            }
            if (profile) {
              excludedKeyCount += profile.excluded_key_count;
              truncatedRecordCount += profile.truncated_record_count;
              profiledRecordCount += profile.profiled_record_count;
            }
          }
          return {
            rows: [
              {
                batch_count: batches.length,
                profile_gap_count: profileGapCount,
                unusable_batch_count: unusableBatchCount,
                excluded_key_count: excludedKeyCount,
                truncated_record_count: truncatedRecordCount,
                profiled_record_count: profiledRecordCount,
              },
            ] as unknown as Row[],
          };
        }

        if (n.startsWith("with observed as")) {
          const [runId, sourceDefinitionId] = params as [string, string];
          const byPath = new Map<string, (typeof this.batchFieldProfiles)[number][]>();
          for (const field of this.batchFieldProfiles) {
            const batch = this.batches.find((b) => b.id === field.ingestion_batch_id);
            if (!batch || batch.ingestion_run_id !== runId) continue;
            const list = byPath.get(field.field_path) ?? [];
            list.push(field);
            byPath.set(field.field_path, list);
          }
          const rows = [...byPath.entries()].map(([fieldPath, fields]) => {
            const sum = (key: keyof (typeof fields)[number]) =>
              fields.reduce((total, field) => total + (field[key] as number), 0);
            const decision = this.mappingDecisions.find(
              (d) =>
                d.source_definition_id === sourceDefinitionId &&
                d.field_path === fieldPath &&
                d.active,
            );
            return {
              field_path: fieldPath,
              null_count: sum("null_count"),
              object_count: sum("object_count"),
              array_count: sum("array_count"),
              string_count: sum("string_count"),
              number_count: sum("number_count"),
              boolean_count: sum("boolean_count"),
              mapping_decision_id: decision?.id ?? null,
              decision_version: decision?.decision_version ?? null,
              decision: decision?.decision ?? null,
              destination_relation: decision?.destination_relation ?? null,
              destination_field: decision?.destination_field ?? null,
              destination_data_type: null,
              destination_udt_name: null,
              attribute_definition_id: decision?.attribute_definition_id ?? null,
              attribute_key: null,
              attribute_entity_scope: null,
              attribute_data_type: null,
              attribute_active: null,
            };
          });
          return { rows: rows as unknown as Row[] };
        }

        if (n.startsWith("insert into property_ingest.source_mapping_releases")) {
          const [
            sourceDefinitionId,
            mappingVersion,
            sourceProfileRunId,
            fingerprint,
            fieldCount,
            releaseNote,
            releasedBy,
            releasedAt,
          ] = params as [string, number, string, string, number, string, string, string];
          const conflict = this.releases.find(
            (release) =>
              release.source_definition_id === sourceDefinitionId &&
              release.mapping_version === mappingVersion,
          );
          if (conflict) return { rows: [] };
          const id = randomUUID();
          this.releases.push({
            id,
            source_definition_id: sourceDefinitionId,
            mapping_version: mappingVersion,
            source_profile_run_id: sourceProfileRunId,
            release_fingerprint: fingerprint,
            field_count: fieldCount,
            release_note: releaseNote,
            released_by: releasedBy,
            released_at: releasedAt,
          });
          return { rows: [{ id }] as unknown as Row[] };
        }

        if (n.startsWith("insert into property_ingest.source_mapping_release_fields")) {
          const [releaseId, sourceDefinitionId, fieldsJson] = params as [string, string, string];
          const fields = JSON.parse(fieldsJson) as Array<Record<string, unknown>>;
          for (const field of fields) {
            this.releaseFields.push({
              release_id: releaseId,
              source_definition_id: sourceDefinitionId,
              ...field,
            });
          }
          return { rows: [] };
        }

        if (n.startsWith("select release.id::text, release.source_definition_id::text")) {
          const [sourceDefinitionId, mappingVersion] = params as [string, number];
          const release = this.releases.find(
            (r) =>
              r.source_definition_id === sourceDefinitionId && r.mapping_version === mappingVersion,
          );
          if (!release) return { rows: [] };
          return {
            rows: [
              {
                id: release.id,
                source_definition_id: release.source_definition_id,
                source_key: this.source.source_key,
                contract_version: this.source.contract_version,
                mapping_version: release.mapping_version,
                source_profile_run_id: release.source_profile_run_id,
                release_fingerprint: release.release_fingerprint,
                release_note: release.release_note,
                released_by: release.released_by,
                released_at: release.released_at,
                field_count: release.field_count,
              },
            ] as unknown as Row[],
          };
        }

        if (n.startsWith("select field_path, mapping_decision_id::text, decision_version")) {
          const [releaseId] = params as [string];
          const rows = this.releaseFields
            .filter((field) => field.release_id === releaseId)
            .sort((a, b) => String(a.field_path).localeCompare(String(b.field_path)));
          return { rows: rows as unknown as Row[] };
        }

        throw new Error(`unexpected query in fake mapping-release database: ${n}`);
      },
    });
  }
}

function publishInput(
  overrides: Partial<Parameters<typeof publishNationwideSourceMappingRelease>[1]> = {},
) {
  return {
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    mappingVersion: 1,
    sourceProfileRunId: RUN_ID,
    releaseNote: "initial release",
    releasedBy: REVIEWER_ID,
    releasedAt: "2026-09-24T01:00:00.000Z",
    ...overrides,
  };
}

test("a mapping release, once published, is immutable -- a second publish with different content is rejected, not silently overwritten", async () => {
  const database = new FakeMappingReleaseDatabase();

  const first = await publishNationwideSourceMappingRelease(database, publishInput());
  assert.equal(first.replayed, false);
  assert.equal(first.fields.length, 1);
  assert.equal(database.releases.length, 1);
  assert.equal(database.releaseFields.length, 1);

  // Same call again (same content) replays instead of re-inserting.
  const replay = await publishNationwideSourceMappingRelease(database, publishInput());
  assert.equal(replay.replayed, true);
  assert.equal(replay.releaseId, first.releaseId);
  assert.equal(database.releases.length, 1);

  // Publishing again for the SAME mappingVersion with different content
  // (a different releaseNote) is rejected, never silently overwritten.
  await assert.rejects(
    () =>
      publishNationwideSourceMappingRelease(
        database,
        publishInput({ releaseNote: "a different note" }),
      ),
    /already has a different immutable release/,
  );
  assert.equal(database.releases.length, 1);
  assert.equal(database.releases[0]?.release_note, "initial release");
});

test("publish rejects incomplete source-shape coverage (a gap or truncation blocks the freeze)", async () => {
  const database = new FakeMappingReleaseDatabase();
  database.batchProfiles[0]!.truncated_record_count = 1;

  await assert.rejects(
    () => publishNationwideSourceMappingRelease(database, publishInput()),
    /requires complete, untruncated source-shape coverage/,
  );
  assert.equal(database.releases.length, 0);
});

test("loadNationwideSourceMappingRelease reloads the published release and verifies its fingerprint", async () => {
  const database = new FakeMappingReleaseDatabase();
  const published = await publishNationwideSourceMappingRelease(database, publishInput());

  const loaded = await loadNationwideSourceMappingRelease(database, SOURCE_DEFINITION_ID, 1);
  assert.equal(loaded.releaseId, published.releaseId);
  assert.equal(loaded.releaseFingerprint, published.releaseFingerprint);
  assert.deepEqual(loaded.fields, published.fields);
});

test("projectNationwideSourceRecord classifies a raw_only field without needing a destination or extension mapping", async () => {
  const database = new FakeMappingReleaseDatabase();
  await publishNationwideSourceMappingRelease(database, publishInput());
  const release = await loadNationwideSourceMappingRelease(database, SOURCE_DEFINITION_ID, 1);

  const projection = projectNationwideSourceRecord(release, { disposition: "Sold" });
  assert.deepEqual(projection.rawOnlyPathsPresent, ["/disposition"]);
  assert.deepEqual(projection.destinationValues, []);
  assert.deepEqual(projection.extensionValues, []);
});

test("projectNationwideSourceRecord rejects a field path the release never saw", async () => {
  const database = new FakeMappingReleaseDatabase();
  await publishNationwideSourceMappingRelease(database, publishInput());
  const release = await loadNationwideSourceMappingRelease(database, SOURCE_DEFINITION_ID, 1);

  assert.throws(
    () => projectNationwideSourceRecord(release, { disposition: "Sold", surprise_field: "value" }),
    /unreleased field paths/,
  );
});
