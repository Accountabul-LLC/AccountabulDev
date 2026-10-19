// Closes the same gap as nationwide-source-field-profile.ts (see that
// module's header). Ported near-verbatim from property-intelligence-app's
// app/lib/nationwide-source-field-review.ts: aggregates a source contract's
// latest completed run's per-batch field-shape profiles
// (property_ingest.ingestion_batch_field_profiles) together with its
// mapping and visibility review decisions into one queue view.
//
// Privacy-preserving design, preserved exactly: this module only ever reads
// and returns shape-profile aggregates (counts, depths, lengths) and review
// decision metadata -- never a source record's actual field value. No path
// here queries anything but property_ingest.*/property_core.attribute_definitions
// metadata tables.
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import type { NationwideSourceFieldDecision } from "./nationwide-source-field-mapping.ts";
import { UUID_V1_TO_V5 as UUID } from "../validation/patterns.ts";

export type NationwideSourceFieldReviewItem = {
  fieldPath: string;
  depth: number;
  recordsPresent: number;
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
  decisionId: string | null;
  decisionVersion: number | null;
  decision: NationwideSourceFieldDecision | null;
  destinationRelation: string | null;
  destinationField: string | null;
  attributeDefinitionId: string | null;
  attributeKey: string | null;
  attributeEntityScope: "property" | "auction_event" | "auction_lot" | null;
  attributeDataType: "text" | "numeric" | "boolean" | "date" | "json" | null;
  attributeActive: boolean | null;
  attributeSearchVisibility: "private" | "public_search" | null;
  visibilityDecisionId: string | null;
  visibilityDecisionVersion: number | null;
  visibilityDecision: "private" | "public_search" | null;
  visibilityRationale: string | null;
  visibilityReviewedBy: string | null;
  visibilityReviewedAt: string | null;
  visibilityReviewConsistent: boolean | null;
  rationale: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type NationwideSourceFieldReviewQueue = {
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  latestCompletedRunId: string | null;
  latestRunKey: string | null;
  latestScheduledFor: string | null;
  latestCompletedAt: string | null;
  latestRowsSeen: number;
  batchCount: number;
  profiledBatchCount: number;
  profiledRecordCount: number;
  excludedKeyCount: number;
  truncatedRecordCount: number;
  profileGapCount: number;
  unusableBatchCount: number;
  profileComplete: boolean;
  fieldCount: number;
  unreviewedFieldCount: number;
  mappingReviewComplete: boolean;
  visibilityReviewDebtCount: number;
  visibilityReviewComplete: boolean;
  fields: NationwideSourceFieldReviewItem[];
};

function uuid(value: string, field: string) {
  if (!UUID.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function integer(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return parsed;
}

function optionalInteger(value: unknown, field: string) {
  return value === null || value === undefined ? null : integer(value, field);
}

function iso(value: unknown, field: string) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(`${field} must be a database date-time`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new Error(`${field} must be a database date-time`);
  return parsed.toISOString();
}

export async function getNationwideSourceFieldReviewQueue(
  database: PostgresTransactionHost,
  sourceDefinitionIdValue: string,
): Promise<NationwideSourceFieldReviewQueue> {
  const sourceDefinitionId = uuid(sourceDefinitionIdValue, "sourceDefinitionId");
  return database.transaction(async (transaction) => {
    const source = await transaction.query<{
      source_key: string;
      contract_version: number;
    }>(
      `
      select source_key, contract_version
      from property_ingest.source_definitions
      where id = $1
    `,
      [sourceDefinitionId],
    );
    const sourceRow = source.rows[0];
    if (source.rows.length !== 1 || sourceRow === undefined) {
      throw new Error("sourceDefinitionId does not identify a registered source contract");
    }

    const latest = await transaction.query<{
      id: string;
      run_key: string;
      scheduled_for: string | Date;
      completed_at: string | Date;
      rows_seen: number;
    }>(
      `
      select id::text, run_key, scheduled_for, completed_at, rows_seen
      from property_ingest.ingestion_runs
      where source_definition_id = $1 and completed_at is not null
      order by scheduled_for desc, attempt desc, completed_at desc, id desc
      limit 1
    `,
      [sourceDefinitionId],
    );

    if (latest.rows.length === 0) {
      return {
        sourceDefinitionId,
        sourceKey: sourceRow.source_key,
        contractVersion: integer(sourceRow.contract_version, "contractVersion"),
        latestCompletedRunId: null,
        latestRunKey: null,
        latestScheduledFor: null,
        latestCompletedAt: null,
        latestRowsSeen: 0,
        batchCount: 0,
        profiledBatchCount: 0,
        profiledRecordCount: 0,
        excludedKeyCount: 0,
        truncatedRecordCount: 0,
        profileGapCount: 0,
        unusableBatchCount: 0,
        profileComplete: false,
        fieldCount: 0,
        unreviewedFieldCount: 0,
        mappingReviewComplete: false,
        visibilityReviewDebtCount: 0,
        visibilityReviewComplete: false,
        fields: [],
      };
    }

    const run = latest.rows[0];
    if (run === undefined) throw new Error("latest completed ingestion run row is missing");
    const summary = await transaction.query<{
      batch_count: number | string;
      profiled_batch_count: number | string;
      profiled_record_count: number | string;
      excluded_key_count: number | string;
      truncated_record_count: number | string;
      profile_gap_count: number | string;
      unusable_batch_count: number | string;
    }>(
      `
      with field_totals as (
        select ingestion_batch_id, count(*) as field_count
        from property_ingest.ingestion_batch_field_profiles
        group by ingestion_batch_id
      )
      select
        count(batch.id) as batch_count,
        count(profile.ingestion_batch_id) as profiled_batch_count,
        coalesce(sum(profile.profiled_record_count), 0) as profiled_record_count,
        coalesce(sum(profile.excluded_key_count), 0) as excluded_key_count,
        coalesce(sum(profile.truncated_record_count), 0) as truncated_record_count,
        count(*) filter (
          where batch.status in ('succeeded', 'partial')
            and (
              profile.ingestion_batch_id is null
              or profile.profiled_record_count <> batch.returned_count
              or profile.field_count <> coalesce(field.field_count, 0)
            )
        ) as profile_gap_count,
        count(*) filter (where batch.status not in ('succeeded', 'partial')) as unusable_batch_count
      from property_ingest.ingestion_batches batch
      left join property_ingest.ingestion_batch_profiles profile
        on profile.ingestion_batch_id = batch.id
      left join field_totals field on field.ingestion_batch_id = batch.id
      where batch.ingestion_run_id = $1
    `,
      [run.id],
    );
    const counts = summary.rows[0];
    if (counts === undefined) throw new Error("field-profile summary row is missing");
    const batchCount = integer(counts.batch_count, "batchCount");
    const profiledBatchCount = integer(counts.profiled_batch_count, "profiledBatchCount");
    const profiledRecordCount = integer(counts.profiled_record_count, "profiledRecordCount");
    const excludedKeyCount = integer(counts.excluded_key_count, "excludedKeyCount");
    const truncatedRecordCount = integer(counts.truncated_record_count, "truncatedRecordCount");
    const profileGapCount = integer(counts.profile_gap_count, "profileGapCount");
    const unusableBatchCount = integer(counts.unusable_batch_count, "unusableBatchCount");
    const latestRowsSeen = integer(run.rows_seen, "latestRowsSeen");
    const profileComplete =
      profileGapCount === 0 &&
      unusableBatchCount === 0 &&
      excludedKeyCount === 0 &&
      truncatedRecordCount === 0 &&
      (latestRowsSeen === 0 || batchCount > 0);

    const fieldResult = await transaction.query<{
      field_path: string;
      depth: number;
      records_present: number | string;
      occurrence_count: number | string;
      null_count: number | string;
      object_count: number | string;
      array_count: number | string;
      string_count: number | string;
      number_count: number | string;
      boolean_count: number | string;
      numeric_string_count: number | string;
      date_string_count: number | string;
      date_time_string_count: number | string;
      max_text_length: number | null;
      max_array_length: number | null;
      decision_id: string | null;
      decision_version: number | null;
      decision: NationwideSourceFieldDecision | null;
      destination_relation: string | null;
      destination_field: string | null;
      attribute_definition_id: string | null;
      attribute_key: string | null;
      attribute_entity_scope: "property" | "auction_event" | "auction_lot" | null;
      attribute_data_type: "text" | "numeric" | "boolean" | "date" | "json" | null;
      attribute_active: boolean | null;
      attribute_search_visibility: "private" | "public_search" | null;
      visibility_decision_id: string | null;
      visibility_decision_version: number | null;
      visibility_decision: "private" | "public_search" | null;
      visibility_rationale: string | null;
      visibility_reviewed_by: string | null;
      visibility_reviewed_at: string | Date | null;
      rationale: string | null;
      reviewed_by: string | null;
      reviewed_at: string | Date | null;
    }>(
      `
      select
        field.field_path,
        max(field.depth) as depth,
        sum(field.record_count) as records_present,
        sum(field.occurrence_count) as occurrence_count,
        sum(field.null_count) as null_count,
        sum(field.object_count) as object_count,
        sum(field.array_count) as array_count,
        sum(field.string_count) as string_count,
        sum(field.number_count) as number_count,
        sum(field.boolean_count) as boolean_count,
        sum(field.numeric_string_count) as numeric_string_count,
        sum(field.date_string_count) as date_string_count,
        sum(field.date_time_string_count) as date_time_string_count,
        max(field.max_text_length) as max_text_length,
        max(field.max_array_length) as max_array_length,
        decision.id::text as decision_id,
        decision.decision_version,
        decision.decision,
        decision.destination_relation,
        decision.destination_field,
        decision.attribute_definition_id::text,
        definition.attribute_key,
        definition.entity_scope as attribute_entity_scope,
        definition.data_type as attribute_data_type,
        definition.active as attribute_active,
        definition.search_visibility as attribute_search_visibility,
        visibility.id::text as visibility_decision_id,
        visibility.decision_version as visibility_decision_version,
        visibility.search_visibility as visibility_decision,
        visibility.rationale as visibility_rationale,
        visibility.reviewed_by::text as visibility_reviewed_by,
        visibility.reviewed_at as visibility_reviewed_at,
        decision.rationale,
        decision.reviewed_by::text,
        decision.reviewed_at
      from property_ingest.ingestion_batches batch
      join property_ingest.ingestion_batch_field_profiles field
        on field.ingestion_batch_id = batch.id
      left join property_ingest.source_field_mapping_decisions decision
        on decision.source_definition_id = $2
       and decision.field_path = field.field_path
       and decision.active
      left join property_core.attribute_definitions definition
        on definition.id = decision.attribute_definition_id
      left join property_ingest.attribute_visibility_decisions visibility
        on visibility.attribute_definition_id = definition.id
       and visibility.active
      where batch.ingestion_run_id = $1
      group by
        field.field_path,
        decision.id, decision.decision_version, decision.decision,
        decision.destination_relation, decision.destination_field,
        decision.attribute_definition_id, decision.rationale,
        decision.reviewed_by, decision.reviewed_at,
        definition.attribute_key, definition.entity_scope, definition.data_type,
        definition.active, definition.search_visibility,
        visibility.id, visibility.decision_version, visibility.search_visibility,
        visibility.rationale, visibility.reviewed_by, visibility.reviewed_at
      order by field.field_path
    `,
      [run.id, sourceDefinitionId],
    );

    const fields = fieldResult.rows.map((field): NationwideSourceFieldReviewItem => ({
      fieldPath: field.field_path,
      depth: integer(field.depth, `${field.field_path}.depth`),
      recordsPresent: integer(field.records_present, `${field.field_path}.recordsPresent`),
      occurrenceCount: integer(field.occurrence_count, `${field.field_path}.occurrenceCount`),
      nullCount: integer(field.null_count, `${field.field_path}.nullCount`),
      objectCount: integer(field.object_count, `${field.field_path}.objectCount`),
      arrayCount: integer(field.array_count, `${field.field_path}.arrayCount`),
      stringCount: integer(field.string_count, `${field.field_path}.stringCount`),
      numberCount: integer(field.number_count, `${field.field_path}.numberCount`),
      booleanCount: integer(field.boolean_count, `${field.field_path}.booleanCount`),
      numericStringCount: integer(
        field.numeric_string_count,
        `${field.field_path}.numericStringCount`,
      ),
      dateStringCount: integer(field.date_string_count, `${field.field_path}.dateStringCount`),
      dateTimeStringCount: integer(
        field.date_time_string_count,
        `${field.field_path}.dateTimeStringCount`,
      ),
      maxTextLength: optionalInteger(field.max_text_length, `${field.field_path}.maxTextLength`),
      maxArrayLength: optionalInteger(field.max_array_length, `${field.field_path}.maxArrayLength`),
      decisionId: field.decision_id,
      decisionVersion: optionalInteger(
        field.decision_version,
        `${field.field_path}.decisionVersion`,
      ),
      decision: field.decision,
      destinationRelation: field.destination_relation,
      destinationField: field.destination_field,
      attributeDefinitionId: field.attribute_definition_id,
      attributeKey: field.attribute_key,
      attributeEntityScope: field.attribute_entity_scope,
      attributeDataType: field.attribute_data_type,
      attributeActive: field.attribute_active,
      attributeSearchVisibility: field.attribute_search_visibility,
      visibilityDecisionId: field.visibility_decision_id,
      visibilityDecisionVersion: optionalInteger(
        field.visibility_decision_version,
        `${field.field_path}.visibilityDecisionVersion`,
      ),
      visibilityDecision: field.visibility_decision,
      visibilityRationale: field.visibility_rationale,
      visibilityReviewedBy: field.visibility_reviewed_by,
      visibilityReviewedAt:
        field.visibility_reviewed_at === null
          ? null
          : iso(field.visibility_reviewed_at, `${field.field_path}.visibilityReviewedAt`),
      visibilityReviewConsistent:
        field.decision !== "extension_attribute"
          ? null
          : field.attribute_active === true &&
            ((field.attribute_search_visibility === "private" &&
              field.visibility_decision_id === null) ||
              field.visibility_decision === field.attribute_search_visibility),
      rationale: field.rationale,
      reviewedBy: field.reviewed_by,
      reviewedAt:
        field.reviewed_at === null
          ? null
          : iso(field.reviewed_at, `${field.field_path}.reviewedAt`),
    }));
    const unreviewedFieldCount = fields.filter((field) => field.decision === null).length;
    const visibilityReviewDebtCount = fields.filter(
      (field) => field.visibilityReviewConsistent === false,
    ).length;
    return {
      sourceDefinitionId,
      sourceKey: sourceRow.source_key,
      contractVersion: integer(sourceRow.contract_version, "contractVersion"),
      latestCompletedRunId: run.id,
      latestRunKey: run.run_key,
      latestScheduledFor: iso(run.scheduled_for, "latestScheduledFor"),
      latestCompletedAt: iso(run.completed_at, "latestCompletedAt"),
      latestRowsSeen,
      batchCount,
      profiledBatchCount,
      profiledRecordCount,
      excludedKeyCount,
      truncatedRecordCount,
      profileGapCount,
      unusableBatchCount,
      profileComplete,
      fieldCount: fields.length,
      unreviewedFieldCount,
      mappingReviewComplete: profileComplete && unreviewedFieldCount === 0,
      visibilityReviewDebtCount,
      visibilityReviewComplete: profileComplete && visibilityReviewDebtCount === 0,
      fields,
    };
  });
}
