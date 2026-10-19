// Closes the same gap as nationwide-source-field-profile.ts (see that
// module's header). Ported near-verbatim from property-intelligence-app's
// app/lib/nationwide-source-field-mapping.ts against
// property_ingest.source_field_mapping_decisions, added by
// 20260924180000_property_intelligence_attribute_governance.sql (this table
// did not exist anywhere in this repo before that migration -- confirmed
// absent by grep before writing it).
//
// A mapping decision classifies one profiled source JSON field path
// (identified only by its shape-profile path, never by a sampled value) as
// a core_field / mechanism_detail destination column, an extension_attribute
// (requiring an active property_core.attribute_definitions row), or
// raw_only/ignored. Append-only, one active decision per (source
// definition, field path) at a time.
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import { UUID_V1_TO_V5 as UUID } from "../validation/patterns.ts";

export const NATIONWIDE_SOURCE_FIELD_DECISIONS = [
  "core_field",
  "mechanism_detail",
  "extension_attribute",
  "raw_only",
  "ignored",
] as const;

export type NationwideSourceFieldDecision = (typeof NATIONWIDE_SOURCE_FIELD_DECISIONS)[number];

export type ReviewNationwideSourceFieldMappingInput = {
  sourceDefinitionId: string;
  fieldPath: string;
  decision: NationwideSourceFieldDecision;
  destinationRelation?: string | null;
  destinationField?: string | null;
  attributeDefinitionId?: string | null;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type ReviewedNationwideSourceFieldMapping = {
  decisionId: string;
  sourceDefinitionId: string;
  fieldPath: string;
  decisionVersion: number;
  supersedesDecisionId: string | null;
  replayed: boolean;
};

type StoredDecision = {
  id: string;
  decision_version: number;
  decision: NationwideSourceFieldDecision;
  destination_relation: string | null;
  destination_field: string | null;
  attribute_definition_id: string | null;
  rationale: string;
  reviewed_by: string;
  reviewed_at: string | Date;
  active: boolean;
};

const JSON_POINTER = /^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/;
const DESTINATION_RELATION = /^(?:property_core|property_ingest)\.[a-z][a-z0-9_]*$/;
const DESTINATION_FIELD = /^[a-z][a-z0-9_]*$/;

function uuid(value: string, field: string) {
  if (!UUID.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function text(value: string | null | undefined, field: string, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > maximum) throw new Error(`${field} cannot exceed ${maximum} characters`);
  return normalized;
}

function optionalText(value: string | null | undefined, field: string, maximum: number) {
  if (value === null || value === undefined || !value.trim()) return null;
  return text(value, field, maximum);
}

function canonicalIso(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function normalizedInput(input: ReviewNationwideSourceFieldMappingInput) {
  const sourceDefinitionId = uuid(input.sourceDefinitionId, "sourceDefinitionId");
  const reviewedBy = uuid(input.reviewedBy, "reviewedBy");
  const reviewedAt = canonicalIso(input.reviewedAt, "reviewedAt");
  const fieldPath = text(input.fieldPath, "fieldPath", 1_000);
  if (!JSON_POINTER.test(fieldPath)) {
    throw new Error("fieldPath must be a nonempty JSON Pointer with valid ~0 and ~1 escapes");
  }
  if (!NATIONWIDE_SOURCE_FIELD_DECISIONS.includes(input.decision)) {
    throw new Error("decision is not a supported source-field classification");
  }
  const destinationRelation = optionalText(input.destinationRelation, "destinationRelation", 256);
  const destinationField = optionalText(input.destinationField, "destinationField", 256);
  const attributeDefinitionId = input.attributeDefinitionId
    ? uuid(input.attributeDefinitionId, "attributeDefinitionId")
    : null;
  const rationale = text(input.rationale, "rationale", 2_000);

  if (input.decision === "core_field" || input.decision === "mechanism_detail") {
    if (!destinationRelation || !destinationField || attributeDefinitionId) {
      throw new Error(
        `${input.decision} requires one typed destination and no extension definition`,
      );
    }
    if (!DESTINATION_RELATION.test(destinationRelation)) {
      throw new Error("destinationRelation must name a private canonical write relation");
    }
    if (!DESTINATION_FIELD.test(destinationField)) {
      throw new Error("destinationField must be a lowercase database field identifier");
    }
  } else if (input.decision === "extension_attribute") {
    if (destinationRelation || destinationField || !attributeDefinitionId) {
      throw new Error(
        "extension_attribute requires one registered definition and no direct destination",
      );
    }
  } else if (destinationRelation || destinationField || attributeDefinitionId) {
    throw new Error(`${input.decision} cannot declare a normalized destination`);
  }

  return {
    sourceDefinitionId,
    fieldPath,
    decision: input.decision,
    destinationRelation,
    destinationField,
    attributeDefinitionId,
    rationale,
    reviewedBy,
    reviewedAt,
  };
}

function sameTimestamp(left: string | Date, right: string) {
  return new Date(left).valueOf() === new Date(right).valueOf();
}

function sameDecision(stored: StoredDecision, input: ReturnType<typeof normalizedInput>) {
  return (
    stored.decision === input.decision &&
    stored.destination_relation === input.destinationRelation &&
    stored.destination_field === input.destinationField &&
    stored.attribute_definition_id === input.attributeDefinitionId &&
    stored.rationale === input.rationale &&
    stored.reviewed_by === input.reviewedBy &&
    sameTimestamp(stored.reviewed_at, input.reviewedAt)
  );
}

export async function reviewNationwideSourceFieldMapping(
  database: PostgresTransactionHost,
  untrustedInput: ReviewNationwideSourceFieldMappingInput,
): Promise<ReviewedNationwideSourceFieldMapping> {
  const input = normalizedInput(untrustedInput);
  return database.transaction(async (transaction) => {
    const source = await transaction.query<{ id: string }>(
      `
      select id::text
      from property_ingest.source_definitions
      where id = $1
      for update
    `,
      [input.sourceDefinitionId],
    );
    if (source.rows.length !== 1)
      throw new Error("sourceDefinitionId does not identify a registered source contract");

    if (input.destinationRelation && input.destinationField) {
      const [tableSchema, tableName] = input.destinationRelation.split(".");
      const destination = await transaction.query<{ column_name: string }>(
        `
        select column_name
        from information_schema.columns
        where table_schema = $1 and table_name = $2 and column_name = $3
      `,
        [tableSchema, tableName, input.destinationField],
      );
      if (destination.rows.length !== 1) {
        throw new Error(
          "normalized destination does not identify an existing private canonical field",
        );
      }
    }

    if (input.attributeDefinitionId) {
      const definition = await transaction.query<{ id: string }>(
        `
        select id::text
        from property_core.attribute_definitions
        where id = $1 and active
      `,
        [input.attributeDefinitionId],
      );
      if (definition.rows.length !== 1) {
        throw new Error("attributeDefinitionId does not identify an active extension definition");
      }
    }

    const history = await transaction.query<StoredDecision>(
      `
      select
        id::text, decision_version, decision,
        destination_relation, destination_field,
        attribute_definition_id::text, rationale,
        reviewed_by::text, reviewed_at, active
      from property_ingest.source_field_mapping_decisions
      where source_definition_id = $1 and field_path = $2
      order by decision_version desc
      for update
    `,
      [input.sourceDefinitionId, input.fieldPath],
    );
    const latest = history.rows[0] ?? null;
    const active = history.rows.find((decision) => decision.active) ?? null;
    if (history.rows.filter((decision) => decision.active).length > 1) {
      throw new Error("source field has more than one active mapping decision");
    }
    if (active && latest && active.id !== latest.id) {
      throw new Error("active source-field decision is not the latest review version");
    }
    if (active && sameDecision(active, input)) {
      return {
        decisionId: active.id,
        sourceDefinitionId: input.sourceDefinitionId,
        fieldPath: input.fieldPath,
        decisionVersion: active.decision_version,
        supersedesDecisionId: history.rows[1]?.id ?? null,
        replayed: true,
      };
    }
    if (latest && new Date(input.reviewedAt).valueOf() <= new Date(latest.reviewed_at).valueOf()) {
      throw new Error("reviewedAt must be later than the latest decision for this source field");
    }

    if (active) {
      const superseded = await transaction.query<{ id: string }>(
        `
        update property_ingest.source_field_mapping_decisions
        set active = false, superseded_at = $2
        where id = $1 and active
        returning id::text
      `,
        [active.id, input.reviewedAt],
      );
      if (superseded.rows.length !== 1)
        throw new Error("active source-field decision changed during review");
    }

    const decisionVersion = (latest?.decision_version ?? 0) + 1;
    const supersedesDecisionId = latest?.id ?? null;
    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.source_field_mapping_decisions (
        source_definition_id, field_path, decision_version, decision,
        destination_relation, destination_field, attribute_definition_id,
        rationale, reviewed_by, reviewed_at, supersedes_decision_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning id::text
    `,
      [
        input.sourceDefinitionId,
        input.fieldPath,
        decisionVersion,
        input.decision,
        input.destinationRelation,
        input.destinationField,
        input.attributeDefinitionId,
        input.rationale,
        input.reviewedBy,
        input.reviewedAt,
        supersedesDecisionId,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (inserted.rows.length !== 1 || insertedRow === undefined) {
      throw new Error("source-field mapping review was not persisted");
    }
    return {
      decisionId: insertedRow.id,
      sourceDefinitionId: input.sourceDefinitionId,
      fieldPath: input.fieldPath,
      decisionVersion,
      supersedesDecisionId,
      replayed: false,
    };
  });
}
