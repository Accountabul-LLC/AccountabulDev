// Closes a gap the Slice 4 and Slice 5 commits (00f6796, b64776c) explicitly
// flagged as remaining: the source's field-shape profiling module. Ported
// near-verbatim from property-intelligence-app's
// app/lib/nationwide-source-field-profile.ts against the schema Slice 2's
// migration (20260924150000_property_intelligence_ingestion_pipeline.sql)
// already created for it -- property_ingest.ingestion_batch_profiles /
// ingestion_batch_field_profiles -- which this repo's field/column names
// match exactly, so no migration change was needed for this module.
//
// Privacy-preserving design, preserved exactly: profileSourceRecordShapes
// (and therefore persistIngestionBatchSourceShape) never reads, retains, or
// logs an actual field VALUE. It only ever counts occurrences of shapes
// (types, presence, nesting depth, max lengths) per JSON Pointer field path.
// A field key that looks like a credential (password, token, api key,
// authorization, cookie, session, ...) is excluded from the profile
// entirely, not merely from its value.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";

export type SourceFieldProfile = {
  fieldPath: string;
  depth: number;
  recordCount: number;
  occurrenceCount: number;
  nullCount: number;
  objectCount: number;
  arrayCount: number;
  stringCount: number;
  numberCount: number;
  booleanCount: number;
  numericStringCount: number;
  dateStringCount: number;
  dateTimeStringCount: number;
  maxTextLength: number | null;
  maxArrayLength: number | null;
};

export type SourceShapeProfile = {
  profiledRecordCount: number;
  excludedKeyCount: number;
  truncatedRecordCount: number;
  fields: SourceFieldProfile[];
};

export type SourceShapeProfileLimits = {
  maxDepth?: number;
  maxNodesPerRecord?: number;
  maxArrayItems?: number;
};

export type PersistedSourceShapeProfile = {
  replayed: boolean;
  profileFingerprint: string;
  profiledRecordCount: number;
  fieldCount: number;
};

type MutableFieldProfile = Omit<SourceFieldProfile, "recordCount"> & {
  recordIndexes: Set<number>;
};

const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_NODES_PER_RECORD = 10_000;
const DEFAULT_MAX_ARRAY_ITEMS = 1_000;
const SAFE_FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const SECRET_FIELD_KEY =
  /(?:^|[_ .-])(password|passwd|secret|token|api[_ .-]?key|authorization|credential|cookie|session)(?:$|[_ .-])/i;

function positiveInteger(value: number | undefined, fallback: number, field: string) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1)
    throw new Error(`${field} must be a positive integer`);
  return selected;
}

function safeFieldKey(key: string) {
  return SAFE_FIELD_KEY.test(key) && !SECRET_FIELD_KEY.test(key);
}

function pointerSegment(key: string) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pathDepth(path: string) {
  return path.split("/").length - 1;
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(new Date(value).valueOf());
}

function numericString(value: string) {
  return /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value));
}

function mutableField(path: string): MutableFieldProfile {
  return {
    fieldPath: path,
    depth: pathDepth(path),
    recordIndexes: new Set<number>(),
    occurrenceCount: 0,
    nullCount: 0,
    objectCount: 0,
    arrayCount: 0,
    stringCount: 0,
    numberCount: 0,
    booleanCount: 0,
    numericStringCount: 0,
    dateStringCount: 0,
    dateTimeStringCount: 0,
    maxTextLength: null,
    maxArrayLength: null,
  };
}

// Pure, no I/O: walks each record's JSON shape and counts type occurrences
// per JSON Pointer field path. Never reads a value into the returned
// profile -- only counts, lengths, and presence.
export function profileSourceRecordShapes(
  records: ReadonlyArray<Record<string, unknown>>,
  limits: SourceShapeProfileLimits = {},
): SourceShapeProfile {
  const maxDepth = positiveInteger(limits.maxDepth, DEFAULT_MAX_DEPTH, "maxDepth");
  const maxNodesPerRecord = positiveInteger(
    limits.maxNodesPerRecord,
    DEFAULT_MAX_NODES_PER_RECORD,
    "maxNodesPerRecord",
  );
  const maxArrayItems = positiveInteger(
    limits.maxArrayItems,
    DEFAULT_MAX_ARRAY_ITEMS,
    "maxArrayItems",
  );
  const byPath = new Map<string, MutableFieldProfile>();
  let excludedKeyCount = 0;
  let truncatedRecordCount = 0;

  records.forEach((record, recordIndex) => {
    let nodeCount = 0;
    let truncated = false;
    const ancestors = new WeakSet<object>();

    const visit = (path: string, value: unknown, depth: number): void => {
      if (depth > maxDepth || nodeCount >= maxNodesPerRecord) {
        truncated = true;
        return;
      }
      nodeCount += 1;
      const field = byPath.get(path) ?? mutableField(path);
      byPath.set(path, field);
      field.recordIndexes.add(recordIndex);
      field.occurrenceCount += 1;
      if (value === null) {
        field.nullCount += 1;
        return;
      }
      if (Array.isArray(value)) {
        field.arrayCount += 1;
        field.maxArrayLength = Math.max(field.maxArrayLength ?? 0, value.length);
        if (ancestors.has(value)) {
          truncated = true;
          return;
        }
        ancestors.add(value);
        if (value.length > maxArrayItems) truncated = true;
        value.slice(0, maxArrayItems).forEach((item) => visit(`${path}/*`, item, depth + 1));
        ancestors.delete(value);
        return;
      }
      if (typeof value === "object") {
        field.objectCount += 1;
        if (ancestors.has(value)) {
          truncated = true;
          return;
        }
        ancestors.add(value);
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          if (!safeFieldKey(key)) {
            excludedKeyCount += 1;
            continue;
          }
          visit(
            `${path}/${pointerSegment(key)}`,
            (value as Record<string, unknown>)[key],
            depth + 1,
          );
        }
        ancestors.delete(value);
        return;
      }
      if (typeof value === "string") {
        field.stringCount += 1;
        field.maxTextLength = Math.max(field.maxTextLength ?? 0, value.length);
        if (numericString(value)) field.numericStringCount += 1;
        if (validCalendarDate(value)) field.dateStringCount += 1;
        if (validDateTime(value)) field.dateTimeStringCount += 1;
        return;
      }
      if (typeof value === "number") {
        field.numberCount += 1;
        return;
      }
      if (typeof value === "boolean") field.booleanCount += 1;
    };

    for (const key of Object.keys(record).sort()) {
      if (!safeFieldKey(key)) {
        excludedKeyCount += 1;
        continue;
      }
      visit(`/${pointerSegment(key)}`, record[key], 1);
    }
    if (truncated) truncatedRecordCount += 1;
  });

  const fields = [...byPath.values()]
    .map(({ recordIndexes, ...field }) => ({ ...field, recordCount: recordIndexes.size }))
    .sort((left, right) =>
      left.fieldPath < right.fieldPath ? -1 : left.fieldPath > right.fieldPath ? 1 : 0,
    );
  return {
    profiledRecordCount: records.length,
    excludedKeyCount,
    truncatedRecordCount,
    fields,
  };
}

function uuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

// Persists a batch's shape profile once. A second call for the SAME batchId
// is replayed (returned, not re-inserted) only if it produces the
// bit-for-bit identical profile fingerprint -- a different profile for an
// already-profiled batch is rejected, matching this module's other
// immutable-once-complete guarantees.
export async function persistIngestionBatchSourceShape(
  database: PostgresTransactionHost,
  input: {
    batchId: string;
    records: ReadonlyArray<Record<string, unknown>>;
    limits?: SourceShapeProfileLimits;
  },
): Promise<PersistedSourceShapeProfile> {
  const batchId = uuid(input.batchId, "batchId");
  const profile = profileSourceRecordShapes(input.records, input.limits);
  const profileFingerprint = await stableSha256(profile);

  return database.transaction(async (transaction) => {
    const inserted = await transaction.query<{ profile_fingerprint: string }>(
      `
      insert into property_ingest.ingestion_batch_profiles (
        ingestion_batch_id, profiled_record_count, excluded_key_count,
        truncated_record_count, field_count, profile_fingerprint
      ) values ($1, $2, $3, $4, $5, $6)
      on conflict (ingestion_batch_id) do nothing
      returning profile_fingerprint
    `,
      [
        batchId,
        profile.profiledRecordCount,
        profile.excludedKeyCount,
        profile.truncatedRecordCount,
        profile.fields.length,
        profileFingerprint,
      ],
    );
    if (inserted.rows.length === 0) {
      const existing = await transaction.query<{ profile_fingerprint: string }>(
        `
        select profile_fingerprint
        from property_ingest.ingestion_batch_profiles
        where ingestion_batch_id = $1
      `,
        [batchId],
      );
      if (existing.rows[0]?.profile_fingerprint !== profileFingerprint) {
        throw new Error("ingestion batch already has a different immutable source shape profile");
      }
      return {
        replayed: true,
        profileFingerprint,
        profiledRecordCount: profile.profiledRecordCount,
        fieldCount: profile.fields.length,
      };
    }

    if (profile.fields.length > 0) {
      const rows = profile.fields.map((field) => ({
        field_path: field.fieldPath,
        depth: field.depth,
        record_count: field.recordCount,
        occurrence_count: field.occurrenceCount,
        null_count: field.nullCount,
        object_count: field.objectCount,
        array_count: field.arrayCount,
        string_count: field.stringCount,
        number_count: field.numberCount,
        boolean_count: field.booleanCount,
        numeric_string_count: field.numericStringCount,
        date_string_count: field.dateStringCount,
        date_time_string_count: field.dateTimeStringCount,
        max_text_length: field.maxTextLength,
        max_array_length: field.maxArrayLength,
      }));
      await transaction.query(
        `
        insert into property_ingest.ingestion_batch_field_profiles (
          ingestion_batch_id, field_path, depth, record_count, occurrence_count,
          null_count, object_count, array_count, string_count, number_count,
          boolean_count, numeric_string_count, date_string_count, date_time_string_count,
          max_text_length, max_array_length
        )
        select
          $1, profile.field_path, profile.depth, profile.record_count, profile.occurrence_count,
          profile.null_count, profile.object_count, profile.array_count, profile.string_count,
          profile.number_count, profile.boolean_count, profile.numeric_string_count,
          profile.date_string_count, profile.date_time_string_count,
          profile.max_text_length, profile.max_array_length
        from jsonb_to_recordset($2::jsonb) as profile(
          field_path text, depth integer, record_count integer, occurrence_count integer,
          null_count integer, object_count integer, array_count integer, string_count integer,
          number_count integer, boolean_count integer, numeric_string_count integer,
          date_string_count integer, date_time_string_count integer,
          max_text_length integer, max_array_length integer
        )
      `,
        [batchId, JSON.stringify(rows)],
      );
    }
    return {
      replayed: false,
      profileFingerprint,
      profiledRecordCount: profile.profiledRecordCount,
      fieldCount: profile.fields.length,
    };
  });
}
