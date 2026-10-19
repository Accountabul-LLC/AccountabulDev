// Closes the same gap as nationwide-source-field-profile.ts (see that
// module's header). Ported near-verbatim from property-intelligence-app's
// app/lib/nationwide-source-mapping-release.ts against
// property_ingest.source_mapping_releases / source_mapping_release_fields,
// added by 20260924180000_property_intelligence_attribute_governance.sql.
//
// "Freeze" invariant, preserved exactly: publishNationwideSourceMappingRelease
// requires complete, untruncated source-shape coverage and a fully reviewed
// field set before it will insert a release row, and a second publish for
// the SAME (source_definition_id, mapping_version) is only ever replayed
// (returned unchanged) if its computed release_fingerprint matches the
// stored one bit-for-bit -- publishing again with genuinely different
// content throws, it is never silently overwritten. The migration's
// validate_source_mapping_release_field / _complete triggers, and the grant
// that gives service_role only SELECT/INSERT (no UPDATE/DELETE) on these two
// tables, back this same invariant at the database layer.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import { profileSourceRecordShapes } from "./nationwide-source-field-profile.ts";
import type { NationwideSourceFieldDecision } from "./nationwide-source-field-mapping.ts";
import { UUID_V1_TO_V5 as UUID } from "../validation/patterns.ts";

export type NationwideSourceValueType =
  "null" | "object" | "array" | "string" | "number" | "boolean";

export type NationwideSourceMappingReleaseField = {
  fieldPath: string;
  mappingDecisionId: string;
  decisionVersion: number;
  sourceValueTypes: NationwideSourceValueType[];
  decision: NationwideSourceFieldDecision;
  destinationRelation: string | null;
  destinationField: string | null;
  destinationDataType: string | null;
  destinationUdtName: string | null;
  attributeDefinitionId: string | null;
  attributeKey: string | null;
  attributeEntityScope: "property" | "auction_event" | "auction_lot" | null;
  attributeDataType: "text" | "numeric" | "boolean" | "date" | "json" | null;
};

export type NationwideSourceMappingRelease = {
  releaseId: string;
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  mappingVersion: number;
  sourceProfileRunId: string;
  releaseFingerprint: string;
  releaseNote: string;
  releasedBy: string;
  releasedAt: string;
  fields: NationwideSourceMappingReleaseField[];
};

export type PublishedNationwideSourceMappingRelease = NationwideSourceMappingRelease & {
  replayed: boolean;
};

export type NationwideProjectedDestinationValue = {
  mappingDecisionId: string;
  sourceFieldPath: string;
  destinationRelation: string;
  destinationField: string;
  destinationDataType: string;
  destinationUdtName: string;
  value: unknown;
};

export type NationwideProjectedExtensionValue = {
  mappingDecisionId: string;
  sourceFieldPath: string;
  attributeDefinitionId: string;
  attributeKey: string;
  entityScope: "property" | "auction_event" | "auction_lot";
  dataType: "text" | "numeric" | "boolean" | "date" | "json";
  value: unknown;
};

export type NationwideReviewedSourceProjection = {
  releaseId: string;
  releaseFingerprint: string;
  destinationValues: NationwideProjectedDestinationValue[];
  extensionValues: NationwideProjectedExtensionValue[];
  rawOnlyPathsPresent: string[];
  ignoredPathsPresent: string[];
};

type MappingReleaseDatabaseRow = {
  id: string;
  source_definition_id: string;
  source_key: string;
  contract_version: number | string;
  mapping_version: number | string;
  source_profile_run_id: string;
  release_fingerprint: string;
  release_note: string;
  released_by: string;
  released_at: string | Date;
  field_count: number | string;
};

type MappingFieldDatabaseRow = {
  field_path: string;
  mapping_decision_id: string | null;
  decision_version: number | string | null;
  source_value_types: NationwideSourceValueType[] | string | null;
  decision: NationwideSourceFieldDecision | null;
  destination_relation: string | null;
  destination_field: string | null;
  destination_data_type: string | null;
  destination_udt_name: string | null;
  attribute_definition_id: string | null;
  attribute_key: string | null;
  attribute_entity_scope: "property" | "auction_event" | "auction_lot" | null;
  attribute_data_type: "text" | "numeric" | "boolean" | "date" | "json" | null;
  attribute_active?: boolean | null;
  null_count?: number | string;
  object_count?: number | string;
  array_count?: number | string;
  string_count?: number | string;
  number_count?: number | string;
  boolean_count?: number | string;
};

const NUMERIC = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const INTEGER = /^[-+]?\d+$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_VALUE_TYPE_ORDER: NationwideSourceValueType[] = [
  "null",
  "object",
  "array",
  "string",
  "number",
  "boolean",
];

function uuid(value: string, field: string) {
  if (!UUID.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${field} must be a positive safe integer`);
  return parsed;
}

function nonnegativeInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return parsed;
}

function required(value: string, field: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > maximum) throw new Error(`${field} cannot exceed ${maximum} characters`);
  return normalized;
}

function canonicalIso(value: string | Date, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new Error(`${field} must be a date-time`);
  const iso = parsed.toISOString();
  if (typeof value === "string" && iso !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return iso;
}

function databaseJson(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function sourceValueTypes(row: MappingFieldDatabaseRow) {
  const pairs: Array<[NationwideSourceValueType, unknown]> = [
    ["null", row.null_count],
    ["object", row.object_count],
    ["array", row.array_count],
    ["string", row.string_count],
    ["number", row.number_count],
    ["boolean", row.boolean_count],
  ];
  const types = pairs
    .filter(([, count]) => nonnegativeInteger(count, "source profile type count") > 0)
    .map(([type]) => type);
  if (types.length === 0)
    throw new Error(`reviewed field ${row.field_path} has no observed source value type`);
  return types;
}

function parsedSourceValueTypes(
  value: MappingFieldDatabaseRow["source_value_types"],
  fieldPath: string,
) {
  const parsed = databaseJson(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`mapping release field ${fieldPath} has no source value types`);
  }
  const result = parsed.map((item) => {
    if (
      typeof item !== "string" ||
      !SOURCE_VALUE_TYPE_ORDER.includes(item as NationwideSourceValueType)
    ) {
      throw new Error(`mapping release field ${fieldPath} has an unsupported source value type`);
    }
    return item as NationwideSourceValueType;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`mapping release field ${fieldPath} repeats a source value type`);
  }
  const sorted = SOURCE_VALUE_TYPE_ORDER.filter((type) => result.includes(type));
  if (sorted.some((type, index) => result[index] !== type)) {
    throw new Error(`mapping release field ${fieldPath} source value types are not canonical`);
  }
  return result;
}

function normalizedField(row: MappingFieldDatabaseRow): NationwideSourceMappingReleaseField {
  if (!row.mapping_decision_id || !row.decision || row.decision_version === null) {
    throw new Error(`source field ${row.field_path} has no active reviewed mapping decision`);
  }
  return {
    fieldPath: row.field_path,
    mappingDecisionId: uuid(row.mapping_decision_id, `${row.field_path}.mappingDecisionId`),
    decisionVersion: positiveInteger(row.decision_version, `${row.field_path}.decisionVersion`),
    sourceValueTypes:
      row.source_value_types === undefined
        ? sourceValueTypes(row)
        : parsedSourceValueTypes(row.source_value_types, row.field_path),
    decision: row.decision,
    destinationRelation: row.destination_relation,
    destinationField: row.destination_field,
    destinationDataType: row.destination_data_type,
    destinationUdtName: row.destination_udt_name,
    attributeDefinitionId: row.attribute_definition_id,
    attributeKey: row.attribute_key,
    attributeEntityScope: row.attribute_entity_scope,
    attributeDataType: row.attribute_data_type,
  };
}

function fingerprintPayload(input: {
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  mappingVersion: number;
  sourceProfileRunId: string;
  fields: NationwideSourceMappingReleaseField[];
}) {
  return {
    sourceDefinitionId: input.sourceDefinitionId,
    sourceKey: input.sourceKey,
    contractVersion: input.contractVersion,
    mappingVersion: input.mappingVersion,
    sourceProfileRunId: input.sourceProfileRunId,
    fields: input.fields,
  };
}

async function releaseFingerprint(input: Parameters<typeof fingerprintPayload>[0]) {
  return stableSha256(fingerprintPayload(input));
}

function releaseFromRows(
  header: MappingReleaseDatabaseRow,
  fields: NationwideSourceMappingReleaseField[],
): NationwideSourceMappingRelease {
  const expectedCount = nonnegativeInteger(header.field_count, "fieldCount");
  if (expectedCount !== fields.length)
    throw new Error("mapping release field count does not match its header");
  return {
    releaseId: uuid(header.id, "releaseId"),
    sourceDefinitionId: uuid(header.source_definition_id, "sourceDefinitionId"),
    sourceKey: header.source_key,
    contractVersion: positiveInteger(header.contract_version, "contractVersion"),
    mappingVersion: positiveInteger(header.mapping_version, "mappingVersion"),
    sourceProfileRunId: uuid(header.source_profile_run_id, "sourceProfileRunId"),
    releaseFingerprint: header.release_fingerprint,
    releaseNote: header.release_note,
    releasedBy: uuid(header.released_by, "releasedBy"),
    releasedAt: canonicalIso(header.released_at, "releasedAt"),
    fields,
  };
}

async function assertReleaseFingerprint(release: NationwideSourceMappingRelease) {
  const expected = await releaseFingerprint(release);
  if (expected !== release.releaseFingerprint) {
    throw new Error("mapping release fingerprint does not match its immutable fields");
  }
}

export async function publishNationwideSourceMappingRelease(
  database: PostgresTransactionHost,
  input: {
    sourceDefinitionId: string;
    mappingVersion: number;
    sourceProfileRunId: string;
    releaseNote: string;
    releasedBy: string;
    releasedAt: string;
  },
): Promise<PublishedNationwideSourceMappingRelease> {
  const sourceDefinitionId = uuid(input.sourceDefinitionId, "sourceDefinitionId");
  const mappingVersion = positiveInteger(input.mappingVersion, "mappingVersion");
  const sourceProfileRunId = uuid(input.sourceProfileRunId, "sourceProfileRunId");
  const releaseNote = required(input.releaseNote, "releaseNote", 2_000);
  const releasedBy = uuid(input.releasedBy, "releasedBy");
  const releasedAt = canonicalIso(input.releasedAt, "releasedAt");

  return database.transaction(async (transaction) => {
    const source = await transaction.query<{
      source_key: string;
      contract_version: number | string;
      mapping_schema: unknown;
    }>(
      `
      select source_key, contract_version, mapping_schema
      from property_ingest.source_definitions
      where id = $1
      for update
    `,
      [sourceDefinitionId],
    );
    const sourceRow = source.rows[0];
    if (source.rows.length !== 1 || sourceRow === undefined) {
      throw new Error("sourceDefinitionId does not identify a registered source contract");
    }
    const mappingSchema = databaseJson(sourceRow.mapping_schema);
    if (!mappingSchema || typeof mappingSchema !== "object" || Array.isArray(mappingSchema)) {
      throw new Error("source contract has no valid immutable mapping schema");
    }
    if (
      positiveInteger(
        (mappingSchema as Record<string, unknown>)["mappingVersion"],
        "source mappingVersion",
      ) !== mappingVersion
    ) {
      throw new Error("mappingVersion does not match the immutable source contract");
    }

    const run = await transaction.query<{
      mapping_version: number | string;
      rows_seen: number | string;
      completed_at: string | Date | null;
    }>(
      `
      select mapping_version, rows_seen, completed_at
      from property_ingest.ingestion_runs
      where id = $1 and source_definition_id = $2
    `,
      [sourceProfileRunId, sourceDefinitionId],
    );
    const runRow = run.rows[0];
    if (run.rows.length !== 1 || runRow === undefined) {
      throw new Error("sourceProfileRunId does not belong to the source contract");
    }
    if (runRow.completed_at === null)
      throw new Error("mapping release requires a completed profile run");
    if (positiveInteger(runRow.mapping_version, "run.mappingVersion") !== mappingVersion) {
      throw new Error("profile run mappingVersion does not match the release");
    }
    const rowsSeen = positiveInteger(runRow.rows_seen, "run.rowsSeen");

    const summary = await transaction.query<{
      batch_count: number | string;
      profile_gap_count: number | string;
      unusable_batch_count: number | string;
      excluded_key_count: number | string;
      truncated_record_count: number | string;
      profiled_record_count: number | string;
    }>(
      `
      with field_totals as (
        select ingestion_batch_id, count(*) as field_count
        from property_ingest.ingestion_batch_field_profiles
        group by ingestion_batch_id
      )
      select
        count(batch.id) as batch_count,
        count(*) filter (
          where batch.status in ('succeeded', 'partial')
            and (
              profile.ingestion_batch_id is null
              or profile.profiled_record_count <> batch.returned_count
              or profile.field_count <> coalesce(field.field_count, 0)
            )
        ) as profile_gap_count,
        count(*) filter (where batch.status not in ('succeeded', 'partial')) as unusable_batch_count,
        coalesce(sum(profile.excluded_key_count), 0) as excluded_key_count,
        coalesce(sum(profile.truncated_record_count), 0) as truncated_record_count,
        coalesce(sum(profile.profiled_record_count), 0) as profiled_record_count
      from property_ingest.ingestion_batches batch
      left join property_ingest.ingestion_batch_profiles profile
        on profile.ingestion_batch_id = batch.id
      left join field_totals field on field.ingestion_batch_id = batch.id
      where batch.ingestion_run_id = $1
    `,
      [sourceProfileRunId],
    );
    const profile = summary.rows[0];
    if (profile === undefined) throw new Error("mapping release profile summary row is missing");
    if (
      positiveInteger(profile.batch_count, "profile.batchCount") < 1 ||
      nonnegativeInteger(profile.profile_gap_count, "profile.gapCount") !== 0 ||
      nonnegativeInteger(profile.unusable_batch_count, "profile.unusableBatchCount") !== 0 ||
      nonnegativeInteger(profile.excluded_key_count, "profile.excludedKeyCount") !== 0 ||
      nonnegativeInteger(profile.truncated_record_count, "profile.truncatedRecordCount") !== 0 ||
      nonnegativeInteger(profile.profiled_record_count, "profile.recordCount") !== rowsSeen
    ) {
      throw new Error("mapping release requires complete, untruncated source-shape coverage");
    }

    const fieldResult = await transaction.query<MappingFieldDatabaseRow>(
      `
      with observed as (
        select
          profile.field_path,
          sum(profile.null_count) as null_count,
          sum(profile.object_count) as object_count,
          sum(profile.array_count) as array_count,
          sum(profile.string_count) as string_count,
          sum(profile.number_count) as number_count,
          sum(profile.boolean_count) as boolean_count
        from property_ingest.ingestion_batches batch
        join property_ingest.ingestion_batch_field_profiles profile
          on profile.ingestion_batch_id = batch.id
        where batch.ingestion_run_id = $1
        group by profile.field_path
      )
      select
        observed.*,
        decision.id::text as mapping_decision_id,
        decision.decision_version,
        decision.decision,
        decision.destination_relation,
        decision.destination_field,
        columns.data_type as destination_data_type,
        columns.udt_name as destination_udt_name,
        decision.attribute_definition_id::text,
        definition.attribute_key,
        definition.entity_scope as attribute_entity_scope,
        definition.data_type as attribute_data_type,
        definition.active as attribute_active
      from observed
      left join property_ingest.source_field_mapping_decisions decision
        on decision.source_definition_id = $2
       and decision.field_path = observed.field_path
       and decision.active
      left join information_schema.columns columns
        on columns.table_schema = split_part(decision.destination_relation, '.', 1)
       and columns.table_name = split_part(decision.destination_relation, '.', 2)
       and columns.column_name = decision.destination_field
       and split_part(decision.destination_relation, '.', 3) = ''
      left join property_core.attribute_definitions definition
        on definition.id = decision.attribute_definition_id
      order by observed.field_path
    `,
      [sourceProfileRunId, sourceDefinitionId],
    );
    if (fieldResult.rows.length === 0)
      throw new Error("mapping release requires at least one profiled source field");
    const fields = fieldResult.rows.map((row) => {
      const field = normalizedField(row);
      if (
        (field.decision === "core_field" || field.decision === "mechanism_detail") &&
        (!field.destinationRelation ||
          !field.destinationField ||
          !field.destinationDataType ||
          !field.destinationUdtName)
      ) {
        throw new Error(
          `reviewed destination for ${field.fieldPath} is absent from the canonical schema`,
        );
      }
      if (
        field.decision === "extension_attribute" &&
        (row.attribute_active !== true ||
          !field.attributeDefinitionId ||
          !field.attributeKey ||
          !field.attributeEntityScope ||
          !field.attributeDataType)
      ) {
        throw new Error(`reviewed extension for ${field.fieldPath} is not active and typed`);
      }
      return field;
    });
    const contractVersion = positiveInteger(sourceRow.contract_version, "contractVersion");
    const sourceKey = sourceRow.source_key;
    const fingerprint = await releaseFingerprint({
      sourceDefinitionId,
      sourceKey,
      contractVersion,
      mappingVersion,
      sourceProfileRunId,
      fields,
    });
    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.source_mapping_releases (
        source_definition_id, mapping_version, source_profile_run_id,
        release_fingerprint, field_count, release_note, released_by, released_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (source_definition_id, mapping_version) do nothing
      returning id::text
    `,
      [
        sourceDefinitionId,
        mappingVersion,
        sourceProfileRunId,
        fingerprint,
        fields.length,
        releaseNote,
        releasedBy,
        releasedAt,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (inserted.rows.length === 1 && insertedRow !== undefined) {
      await transaction.query(
        `
        insert into property_ingest.source_mapping_release_fields (
          release_id, source_definition_id, field_path, mapping_decision_id,
          decision_version, source_value_types, decision,
          destination_relation, destination_field, destination_data_type, destination_udt_name,
          attribute_definition_id, attribute_key, attribute_entity_scope, attribute_data_type
        )
        select
          $1, $2, field.field_path, field.mapping_decision_id,
          field.decision_version, field.source_value_types, field.decision,
          field.destination_relation, field.destination_field,
          field.destination_data_type, field.destination_udt_name,
          field.attribute_definition_id, field.attribute_key,
          field.attribute_entity_scope, field.attribute_data_type
        from jsonb_to_recordset($3::jsonb) as field(
          field_path text, mapping_decision_id uuid, decision_version integer,
          source_value_types text[], decision text,
          destination_relation text, destination_field text,
          destination_data_type text, destination_udt_name text,
          attribute_definition_id uuid, attribute_key text,
          attribute_entity_scope text, attribute_data_type text
        )
      `,
        [
          insertedRow.id,
          sourceDefinitionId,
          JSON.stringify(
            fields.map((field) => ({
              field_path: field.fieldPath,
              mapping_decision_id: field.mappingDecisionId,
              decision_version: field.decisionVersion,
              source_value_types: field.sourceValueTypes,
              decision: field.decision,
              destination_relation: field.destinationRelation,
              destination_field: field.destinationField,
              destination_data_type: field.destinationDataType,
              destination_udt_name: field.destinationUdtName,
              attribute_definition_id: field.attributeDefinitionId,
              attribute_key: field.attributeKey,
              attribute_entity_scope: field.attributeEntityScope,
              attribute_data_type: field.attributeDataType,
            })),
          ),
        ],
      );
      return {
        releaseId: insertedRow.id,
        sourceDefinitionId,
        sourceKey,
        contractVersion,
        mappingVersion,
        sourceProfileRunId,
        releaseFingerprint: fingerprint,
        releaseNote,
        releasedBy,
        releasedAt,
        fields,
        replayed: false,
      };
    }

    const existing = await transaction.query<MappingReleaseDatabaseRow>(
      `
      select
        release.id::text, release.source_definition_id::text,
        source.source_key, source.contract_version,
        release.mapping_version, release.source_profile_run_id::text,
        release.release_fingerprint, release.release_note,
        release.released_by::text, release.released_at, release.field_count
      from property_ingest.source_mapping_releases release
      join property_ingest.source_definitions source on source.id = release.source_definition_id
      where release.source_definition_id = $1 and release.mapping_version = $2
    `,
      [sourceDefinitionId, mappingVersion],
    );
    const header = existing.rows[0];
    if (existing.rows.length !== 1 || header === undefined) {
      throw new Error("mapping release conflict could not be reconciled");
    }
    if (
      header.release_fingerprint !== fingerprint ||
      header.source_profile_run_id !== sourceProfileRunId ||
      header.release_note !== releaseNote ||
      header.released_by !== releasedBy ||
      canonicalIso(header.released_at, "stored releasedAt") !== releasedAt
    ) {
      throw new Error("mappingVersion already has a different immutable release");
    }
    return { ...releaseFromRows(header, fields), replayed: true };
  });
}

export async function loadNationwideSourceMappingRelease(
  database: PostgresTransactionHost,
  sourceDefinitionIdValue: string,
  mappingVersionValue: number,
): Promise<NationwideSourceMappingRelease> {
  const sourceDefinitionId = uuid(sourceDefinitionIdValue, "sourceDefinitionId");
  const mappingVersion = positiveInteger(mappingVersionValue, "mappingVersion");
  return database.transaction(async (transaction) => {
    const headerResult = await transaction.query<MappingReleaseDatabaseRow>(
      `
      select
        release.id::text, release.source_definition_id::text,
        source.source_key, source.contract_version,
        release.mapping_version, release.source_profile_run_id::text,
        release.release_fingerprint, release.release_note,
        release.released_by::text, release.released_at, release.field_count
      from property_ingest.source_mapping_releases release
      join property_ingest.source_definitions source on source.id = release.source_definition_id
      where release.source_definition_id = $1 and release.mapping_version = $2
    `,
      [sourceDefinitionId, mappingVersion],
    );
    const headerRow = headerResult.rows[0];
    if (headerResult.rows.length !== 1 || headerRow === undefined) {
      throw new Error("source contract has no immutable release for mappingVersion");
    }
    const fieldsResult = await transaction.query<MappingFieldDatabaseRow>(
      `
      select
        field_path, mapping_decision_id::text, decision_version,
        source_value_types, decision,
        destination_relation, destination_field,
        destination_data_type, destination_udt_name,
        attribute_definition_id::text, attribute_key,
        attribute_entity_scope, attribute_data_type
      from property_ingest.source_mapping_release_fields
      where release_id = $1
      order by field_path
    `,
      [headerRow.id],
    );
    const release = releaseFromRows(headerRow, fieldsResult.rows.map(normalizedField));
    await assertReleaseFingerprint(release);
    return release;
  });
}

function sourceValueType(value: unknown): NationwideSourceValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  throw new Error("source row contains a value outside the JSON data model");
}

function pointerSegments(pointer: string) {
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function valuesAtPointer(root: Record<string, unknown>, pointer: string) {
  let values: unknown[] = [root];
  for (const segment of pointerSegments(pointer)) {
    const next: unknown[] = [];
    for (const value of values) {
      if (segment === "*") {
        if (Array.isArray(value)) next.push(...value);
        else if (value !== null)
          throw new Error(`source field ${pointer} expected an array wildcard`);
      } else if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        next.push((value as Record<string, unknown>)[segment]);
      }
    }
    values = next;
  }
  return values;
}

function validCalendarDate(value: string) {
  if (!CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function jsonValue(value: unknown, fieldPath: string) {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    throw new Error(`source field ${fieldPath} is not valid JSON`);
  }
}

function publishedBoolean(value: unknown, fieldPath: string) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  throw new Error(`source field ${fieldPath} must be a published boolean value`);
}

function directValue(field: NationwideSourceMappingReleaseField, value: unknown): unknown {
  const udt = field.destinationUdtName;
  if (!udt) throw new Error(`source field ${field.fieldPath} has no released destination type`);
  if (["text", "varchar", "bpchar", "name", "citext"].includes(udt)) {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
    throw new Error(`source field ${field.fieldPath} must be a scalar text value`);
  }
  if (["numeric", "float4", "float8"].includes(udt)) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && NUMERIC.test(value.trim()) && Number.isFinite(Number(value))) {
      return value.trim();
    }
    throw new Error(`source field ${field.fieldPath} must be numeric`);
  }
  if (["int2", "int4", "int8"].includes(udt)) {
    const candidate =
      typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (!INTEGER.test(candidate) || !Number.isSafeInteger(Number(candidate))) {
      throw new Error(`source field ${field.fieldPath} must be a safe integer`);
    }
    return Number(candidate);
  }
  if (udt === "bool") {
    return publishedBoolean(value, field.fieldPath);
  }
  if (udt === "date") {
    if (typeof value !== "string" || !validCalendarDate(value)) {
      throw new Error(`source field ${field.fieldPath} must be a calendar date`);
    }
    return value;
  }
  if (udt === "timestamptz" || udt === "timestamp") {
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      !Number.isFinite(new Date(value).valueOf())
    ) {
      throw new Error(`source field ${field.fieldPath} must be a date-time`);
    }
    return udt === "timestamptz" ? new Date(value).toISOString() : value;
  }
  if (udt === "uuid") {
    if (typeof value !== "string" || !UUID.test(value))
      throw new Error(`source field ${field.fieldPath} must be a UUID`);
    return value;
  }
  if (udt === "json" || udt === "jsonb") return jsonValue(value, field.fieldPath);
  throw new Error(`source field ${field.fieldPath} uses unsupported destination type ${udt}`);
}

function extensionValue(field: NationwideSourceMappingReleaseField, value: unknown): unknown {
  if (field.attributeDataType === "text") {
    if (typeof value !== "string") throw new Error(`source field ${field.fieldPath} must be text`);
    return value;
  }
  if (field.attributeDataType === "numeric") {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && NUMERIC.test(value.trim()) && Number.isFinite(Number(value))) {
      return value.trim();
    }
    throw new Error(`source field ${field.fieldPath} must be numeric`);
  }
  if (field.attributeDataType === "boolean") {
    return publishedBoolean(value, field.fieldPath);
  }
  if (field.attributeDataType === "date") {
    if (typeof value !== "string" || !validCalendarDate(value)) {
      throw new Error(`source field ${field.fieldPath} must be a calendar date`);
    }
    return value;
  }
  if (field.attributeDataType === "json") return jsonValue(value, field.fieldPath);
  throw new Error(`source field ${field.fieldPath} has no supported extension type`);
}

// Pure, no I/O: projects one raw source row through its already-loaded
// (immutable, fingerprint-verified) mapping release. Re-profiles the row's
// shape and rejects it if profiling excluded/truncated anything, or if it
// contains a field path or value type the release never saw.
export function projectNationwideSourceRecord(
  release: NationwideSourceMappingRelease,
  raw: Record<string, unknown>,
): NationwideReviewedSourceProjection {
  const profile = profileSourceRecordShapes([raw]);
  if (profile.excludedKeyCount > 0 || profile.truncatedRecordCount > 0) {
    throw new Error(
      "source row cannot be projected because profiling excluded or truncated fields",
    );
  }
  const releasedPaths = new Set(release.fields.map((field) => field.fieldPath));
  const unexpected = profile.fields
    .map((field) => field.fieldPath)
    .filter((path) => !releasedPaths.has(path));
  if (unexpected.length > 0) {
    throw new Error(`source row contains unreleased field paths: ${unexpected.join(", ")}`);
  }

  const destinationValues: NationwideProjectedDestinationValue[] = [];
  const extensionValues: NationwideProjectedExtensionValue[] = [];
  const rawOnlyPathsPresent: string[] = [];
  const ignoredPathsPresent: string[] = [];
  for (const field of release.fields) {
    const values = valuesAtPointer(raw, field.fieldPath);
    if (values.length === 0) continue;
    for (const value of values) {
      const observedType = sourceValueType(value);
      if (!field.sourceValueTypes.includes(observedType)) {
        throw new Error(`source field ${field.fieldPath} changed from its released value types`);
      }
      if (field.decision === "raw_only") {
        if (!rawOnlyPathsPresent.includes(field.fieldPath))
          rawOnlyPathsPresent.push(field.fieldPath);
      } else if (field.decision === "ignored") {
        if (!ignoredPathsPresent.includes(field.fieldPath))
          ignoredPathsPresent.push(field.fieldPath);
      } else if (value === null) {
        continue;
      } else if (field.decision === "extension_attribute") {
        if (
          !field.attributeDefinitionId ||
          !field.attributeKey ||
          !field.attributeEntityScope ||
          !field.attributeDataType
        ) {
          throw new Error(`source field ${field.fieldPath} has an incomplete extension release`);
        }
        extensionValues.push({
          mappingDecisionId: field.mappingDecisionId,
          sourceFieldPath: field.fieldPath,
          attributeDefinitionId: field.attributeDefinitionId,
          attributeKey: field.attributeKey,
          entityScope: field.attributeEntityScope,
          dataType: field.attributeDataType,
          value: extensionValue(field, value),
        });
      } else {
        if (
          !field.destinationRelation ||
          !field.destinationField ||
          !field.destinationDataType ||
          !field.destinationUdtName
        ) {
          throw new Error(`source field ${field.fieldPath} has an incomplete destination release`);
        }
        destinationValues.push({
          mappingDecisionId: field.mappingDecisionId,
          sourceFieldPath: field.fieldPath,
          destinationRelation: field.destinationRelation,
          destinationField: field.destinationField,
          destinationDataType: field.destinationDataType,
          destinationUdtName: field.destinationUdtName,
          value: directValue(field, value),
        });
      }
    }
  }
  return {
    releaseId: release.releaseId,
    releaseFingerprint: release.releaseFingerprint,
    destinationValues,
    extensionValues,
    rawOnlyPathsPresent,
    ignoredPathsPresent,
  };
}
