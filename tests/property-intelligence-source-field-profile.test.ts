// Slice 4/5 gap close (Gap 2: source field-mapping governance).
// profileSourceRecordShapes is pure (no I/O); persistIngestionBatchSourceShape
// is exercised against a hand-written, in-memory fake PostgresTransactionHost
// modeling property_ingest.ingestion_batch_profiles /
// ingestion_batch_field_profiles. Never a network connection, never a real
// or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  profileSourceRecordShapes,
  persistIngestionBatchSourceShape,
} from "../src/lib/property-intelligence/nationwide-source-field-profile.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

test("shape profiling compares nested fields without retaining values", () => {
  const records = [
    { owner: "Jane Q. Public", amount: 1200.5, active: true, meta: { county: "St. Louis" } },
    { owner: "Someone Else", amount: 900, active: false, meta: { county: "Jackson" } },
  ];
  const profile = profileSourceRecordShapes(records);

  // Every serialized field's JSON representation is a type/shape descriptor,
  // never the source string. Fail loudly if any actual value leaked in.
  const serialized = JSON.stringify(profile);
  for (const record of records) {
    assert.ok(!serialized.includes(record.owner), `profile leaked owner value ${record.owner}`);
    assert.ok(
      !serialized.includes((record.meta as { county: string }).county),
      "profile leaked county value",
    );
  }

  const ownerField = profile.fields.find((field) => field.fieldPath === "/owner");
  assert.ok(ownerField);
  assert.equal(ownerField?.stringCount, 2);
  assert.equal(ownerField?.recordCount, 2);

  const amountField = profile.fields.find((field) => field.fieldPath === "/amount");
  assert.equal(amountField?.numberCount, 2);

  const countyField = profile.fields.find((field) => field.fieldPath === "/meta/county");
  assert.ok(countyField, "nested field paths use JSON Pointer segments");
  assert.equal(countyField?.depth, 2);
});

test("shape profiling excludes secret-looking field keys and their whole subtree", () => {
  const profile = profileSourceRecordShapes([{ api_key: "sk-should-never-appear", value: 1 }]);
  const serialized = JSON.stringify(profile);
  assert.ok(!serialized.includes("sk-should-never-appear"));
  assert.equal(profile.excludedKeyCount, 1);
  assert.ok(!profile.fields.some((field) => field.fieldPath.includes("api_key")));
});

test("shape profiling records null/object/array occurrence counts distinctly per field path", () => {
  const profile = profileSourceRecordShapes([{ tags: ["a", "b"] }, { tags: [] }, { tags: null }]);
  const tagsField = profile.fields.find((field) => field.fieldPath === "/tags");
  assert.ok(tagsField);
  assert.equal(tagsField?.arrayCount, 2);
  assert.equal(tagsField?.nullCount, 1);
  assert.equal(tagsField?.recordCount, 3);

  const itemField = profile.fields.find((field) => field.fieldPath === "/tags/*");
  assert.ok(itemField, "array items get a wildcard field path, never an index");
  assert.equal(itemField?.stringCount, 2);
});

class FakeShapeProfileDatabase implements PostgresTransactionHost {
  batchProfiles: Array<{ ingestion_batch_id: string; profile_fingerprint: string }> = [];
  batchFieldProfiles: Array<Record<string, unknown>> = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("insert into property_ingest.ingestion_batch_profiles")) {
          const [batchId, , , , , fingerprint] = params as [
            string,
            number,
            number,
            number,
            number,
            string,
          ];
          const existing = this.batchProfiles.find((row) => row.ingestion_batch_id === batchId);
          if (existing) return { rows: [] };
          this.batchProfiles.push({
            ingestion_batch_id: batchId,
            profile_fingerprint: fingerprint,
          });
          return { rows: [{ profile_fingerprint: fingerprint }] as unknown as Row[] };
        }

        if (n.startsWith("select profile_fingerprint")) {
          const [batchId] = params as [string];
          const existing = this.batchProfiles.find((row) => row.ingestion_batch_id === batchId);
          return { rows: (existing ? [existing] : []) as unknown as Row[] };
        }

        if (n.startsWith("insert into property_ingest.ingestion_batch_field_profiles")) {
          const [batchId, rowsJson] = params as [string, string];
          const rows = JSON.parse(rowsJson) as Array<Record<string, unknown>>;
          for (const row of rows)
            this.batchFieldProfiles.push({ ingestion_batch_id: batchId, ...row });
          return { rows: [] };
        }

        throw new Error(`unexpected query in fake shape-profile database: ${n}`);
      },
    });
  }
}

test("persistIngestionBatchSourceShape persists shape metadata once and replays an identical re-profile", async () => {
  const database = new FakeShapeProfileDatabase();
  const batchId = randomUUID();
  const records = [{ owner: "Jane Q. Public", amount: 1200.5 }];

  const first = await persistIngestionBatchSourceShape(database, { batchId, records });
  assert.equal(first.replayed, false);
  assert.equal(first.fieldCount, 2);
  assert.equal(database.batchFieldProfiles.length, 2);
  const serializedRows = JSON.stringify(database.batchFieldProfiles);
  assert.ok(
    !serializedRows.includes("Jane Q. Public"),
    "persisted field-profile rows never carry a source value",
  );

  const replay = await persistIngestionBatchSourceShape(database, { batchId, records });
  assert.equal(replay.replayed, true);
  assert.equal(replay.profileFingerprint, first.profileFingerprint);
  assert.equal(
    database.batchFieldProfiles.length,
    2,
    "a replay never re-inserts field-profile rows",
  );
});

test("persistIngestionBatchSourceShape rejects a different profile for an already-profiled batch", async () => {
  const database = new FakeShapeProfileDatabase();
  const batchId = randomUUID();
  await persistIngestionBatchSourceShape(database, { batchId, records: [{ owner: "Jane" }] });

  await assert.rejects(
    () =>
      persistIngestionBatchSourceShape(database, {
        batchId,
        records: [{ owner: "Someone else entirely" }],
      }),
    /different immutable source shape profile/,
  );
});
