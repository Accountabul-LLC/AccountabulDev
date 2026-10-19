// Ported from property-intelligence-app's app/lib/nationwide-source-discovery.ts
// (@785747d), unchanged apart from this import block: this repo keeps the
// manifest's pure validation in nationwide-source-manifest.ts and its
// database writes in nationwide-source-registration.ts, so
// registerNationwideJurisdictionInTransaction comes from the latter.
//
// The source-qualification pipeline: discover a candidate, assess it
// (versioned, fingerprinted, append-only), and promote a qualified assessment
// into a real source_definitions contract. A candidate can only be promoted
// from its LATEST qualified assessment with a completely reviewed field
// inventory, and the database enforces that independently -- see the
// enforce_source_candidate_promotion trigger in
// 20260924150000_property_intelligence_ingestion_pipeline.sql.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import { registerNationwideJurisdictionInTransaction } from "./nationwide-source-registration.ts";
import type {
  NationwideJurisdictionManifest,
  NationwideRecordLane,
  NationwideSourceFormat,
} from "./nationwide-source-manifest.ts";
import type { PostgresTransaction, PostgresTransactionHost } from "./nationwide-postgres-writer.ts";
import { CENSUS_COUNTY_CATALOG, CENSUS_COUNTY_CATALOG_METADATA } from "./us-county-catalog.ts";
import { US_STATE_CATALOG } from "./us-state-catalog.ts";
import {
  SHA256_HEX as SHA256_PATTERN,
  UUID_V1_TO_V5 as UUID_PATTERN,
} from "../validation/patterns.ts";

export type NationwideSourceCandidateDisposition =
  "needs_review" | "qualified" | "rejected" | "retired";
export type NationwideSourceCandidateAccessMode =
  "public" | "public_with_terms" | "authorized_export_required" | "manual_verified" | "unavailable";
export type NationwideSourceCandidateFormat = NationwideSourceFormat | "unknown";
export type NationwideSourceCandidateLane = NationwideRecordLane | "mixed" | "unknown";
export type NationwideSourceCandidateTermsStatus =
  "not_started" | "approved" | "restricted" | "prohibited";
export type NationwideSourceCandidateStructureStatus =
  "not_started" | "sampled" | "mapped" | "incompatible";
export type NationwideSourceCandidateIdentityStatus =
  "not_started" | "reviewed_match_only" | "reviewed_authoritative" | "insufficient";
export type NationwideSourceCandidateFieldValueType =
  "null" | "object" | "array" | "string" | "number" | "boolean";
export type NationwideSourceCandidateFieldSemanticRole =
  | "source_identity"
  | "property_identifier"
  | "address"
  | "geography"
  | "party"
  | "amount"
  | "event_date"
  | "status_lifecycle"
  | "legal_description"
  | "property_attribute"
  | "source_metadata"
  | "parser_evidence"
  | "other";
export type NationwideSourceCandidateFieldMappingDecision =
  "unreviewed" | "core_field" | "extension_attribute" | "raw_only" | "ignored";

export type NationwideSourceCandidateFieldInventoryEntry = {
  fieldPath: string;
  publishedLabel: string | null;
  sourceValueTypes: NationwideSourceCandidateFieldValueType[];
  semanticRole: NationwideSourceCandidateFieldSemanticRole;
  mappingDecision: NationwideSourceCandidateFieldMappingDecision;
  destination: {
    relation: string;
    field: string;
  } | null;
  extensionKey: string | null;
  fieldNotes: string | null;
};

export type DiscoverNationwideSourceCandidateInput = {
  jurisdiction: NationwideJurisdictionManifest;
  candidateKey: string;
  discoveredBy: string;
  discoveredAt: string;
};

export type NationwideSourceCandidateAssessmentDraft = {
  assessmentVersion: number;
  disposition: NationwideSourceCandidateDisposition;
  publisherName: string;
  publishingAgency: string | null;
  sourceFamily: string;
  assetClass: "real_property" | "personal_property" | "mixed";
  landingPageUrl: string;
  officialSource: boolean;
  accessMode: NationwideSourceCandidateAccessMode;
  retrievalMethodHint: string | null;
  sourceFormatHint: NationwideSourceCandidateFormat;
  recordLaneHint: NationwideSourceCandidateLane;
  expectedUpdateFrequency: string | null;
  termsReviewStatus: NationwideSourceCandidateTermsStatus;
  structureReviewStatus: NationwideSourceCandidateStructureStatus;
  identityReviewStatus: NationwideSourceCandidateIdentityStatus;
  fieldInventory?: NationwideSourceCandidateFieldInventoryEntry[];
  sampleArtifact: {
    sha256: string;
    objectStorageKey: string;
    mimeType: string;
    byteSize: number;
  } | null;
  decisionNotes: string | null;
  assessedBy: string;
  assessedAt: string;
};

export type AssessNationwideSourceCandidateInput = NationwideSourceCandidateAssessmentDraft & {
  candidateId: string;
};

export type PromoteNationwideSourceCandidateInput = {
  candidateId: string;
  assessmentId: string;
  sourceDefinitionId: string;
  promotedBy: string;
  promotedAt: string;
};

const KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const JSON_POINTER_PATTERN = /^\/(?:[^~/]|~[01]|\*)+(?:\/(?:[^~/]|~[01]|\*)+)*$/;
const DESTINATION_RELATION_PATTERN = /^(?:property_core|property_ingest)\.[a-z][a-z0-9_]*$/;
const DESTINATION_FIELD_PATTERN = /^[a-z][a-z0-9_]*$/;
const dispositions = new Set<NationwideSourceCandidateDisposition>([
  "needs_review",
  "qualified",
  "rejected",
  "retired",
]);
const accessModes = new Set<NationwideSourceCandidateAccessMode>([
  "public",
  "public_with_terms",
  "authorized_export_required",
  "manual_verified",
  "unavailable",
]);
const formats = new Set<NationwideSourceCandidateFormat>([
  "unknown",
  "api",
  "csv",
  "xlsx",
  "pdf_text",
  "pdf_ocr",
  "html",
  "manual_verified",
]);
const lanes = new Set<NationwideSourceCandidateLane>([
  "unknown",
  "auction",
  "property_record",
  "mixed",
]);
const termsStatuses = new Set<NationwideSourceCandidateTermsStatus>([
  "not_started",
  "approved",
  "restricted",
  "prohibited",
]);
const structureStatuses = new Set<NationwideSourceCandidateStructureStatus>([
  "not_started",
  "sampled",
  "mapped",
  "incompatible",
]);
const identityStatuses = new Set<NationwideSourceCandidateIdentityStatus>([
  "not_started",
  "reviewed_match_only",
  "reviewed_authoritative",
  "insufficient",
]);
const fieldValueTypeOrder: NationwideSourceCandidateFieldValueType[] = [
  "null",
  "object",
  "array",
  "string",
  "number",
  "boolean",
];
const fieldValueTypes = new Set(fieldValueTypeOrder);
const fieldSemanticRoles = new Set<NationwideSourceCandidateFieldSemanticRole>([
  "source_identity",
  "property_identifier",
  "address",
  "geography",
  "party",
  "amount",
  "event_date",
  "status_lifecycle",
  "legal_description",
  "property_attribute",
  "source_metadata",
  "parser_evidence",
  "other",
]);
const fieldMappingDecisions = new Set<NationwideSourceCandidateFieldMappingDecision>([
  "unreviewed",
  "core_field",
  "extension_attribute",
  "raw_only",
  "ignored",
]);
const assessmentKeys = new Set([
  "assessmentVersion",
  "disposition",
  "publisherName",
  "publishingAgency",
  "sourceFamily",
  "assetClass",
  "landingPageUrl",
  "officialSource",
  "accessMode",
  "retrievalMethodHint",
  "sourceFormatHint",
  "recordLaneHint",
  "expectedUpdateFrequency",
  "termsReviewStatus",
  "structureReviewStatus",
  "identityReviewStatus",
  "fieldInventory",
  "sampleArtifact",
  "decisionNotes",
  "assessedBy",
  "assessedAt",
]);
const sampleArtifactKeys = new Set(["sha256", "objectStorageKey", "mimeType", "byteSize"]);
const fieldInventoryKeys = new Set([
  "fieldPath",
  "publishedLabel",
  "sourceValueTypes",
  "semanticRole",
  "mappingDecision",
  "destination",
  "extensionKey",
  "fieldNotes",
]);
const fieldDestinationKeys = new Set(["relation", "field"]);

function required(value: string, field: string, maximum = 2_048) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > maximum) {
    throw new Error(`${field} must be a trimmed nonblank string of at most ${maximum} characters`);
  }
  return value;
}

function optional(value: string | null, field: string, maximum = 4_096) {
  if (value === null) return null;
  return required(value, field, maximum);
}

function uuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function publicUrl(value: string) {
  if (value !== value.trim() || value.length > 2_048) {
    throw new Error("landingPageUrl must be a trimmed public HTTP(S) URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("landingPageUrl must be a trimmed public HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      "landingPageUrl must be a public HTTP(S) URL without credentials or a fragment",
    );
  }
  return parsed.toString();
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function record(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, field: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${field} contains unknown field ${unknown.sort()[0]}`);
}

function normalizedFieldInventory(input: unknown) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 5_000) {
    throw new Error("fieldInventory must be an array of at most 5000 value-free field contracts");
  }
  const paths = new Set<string>();
  return input.map((rawField, index): NationwideSourceCandidateFieldInventoryEntry => {
    const field = record(rawField, `fieldInventory[${index}]`);
    exactKeys(field, fieldInventoryKeys, `fieldInventory[${index}]`);
    const fieldPath = required(
      field["fieldPath"] as string,
      `fieldInventory[${index}].fieldPath`,
      1_024,
    );
    if (!JSON_POINTER_PATTERN.test(fieldPath)) {
      throw new Error(
        `fieldInventory[${index}].fieldPath must be a canonical non-root JSON Pointer`,
      );
    }
    if (paths.has(fieldPath)) throw new Error(`fieldInventory repeats fieldPath ${fieldPath}`);
    paths.add(fieldPath);
    if (
      !Array.isArray(field["sourceValueTypes"]) ||
      field["sourceValueTypes"].length < 1 ||
      field["sourceValueTypes"].length > fieldValueTypeOrder.length
    ) {
      throw new Error(
        `fieldInventory[${index}].sourceValueTypes must be a nonempty canonical type list`,
      );
    }
    const sourceValueTypes = field["sourceValueTypes"] as NationwideSourceCandidateFieldValueType[];
    if (sourceValueTypes.some((valueType) => !fieldValueTypes.has(valueType))) {
      throw new Error(`fieldInventory[${index}].sourceValueTypes contains an unsupported type`);
    }
    if (
      new Set(sourceValueTypes).size !== sourceValueTypes.length ||
      JSON.stringify(sourceValueTypes) !==
        JSON.stringify(
          fieldValueTypeOrder.filter((valueType) => sourceValueTypes.includes(valueType)),
        )
    ) {
      throw new Error(
        `fieldInventory[${index}].sourceValueTypes must be unique and canonically ordered`,
      );
    }
    if (
      !fieldSemanticRoles.has(field["semanticRole"] as NationwideSourceCandidateFieldSemanticRole)
    ) {
      throw new Error(`fieldInventory[${index}].semanticRole is not supported`);
    }
    if (
      !fieldMappingDecisions.has(
        field["mappingDecision"] as NationwideSourceCandidateFieldMappingDecision,
      )
    ) {
      throw new Error(`fieldInventory[${index}].mappingDecision is not supported`);
    }
    const destination =
      field["destination"] === null
        ? null
        : record(field["destination"], `fieldInventory[${index}].destination`);
    if (destination)
      exactKeys(destination, fieldDestinationKeys, `fieldInventory[${index}].destination`);
    const normalizedDestination = destination
      ? {
          relation: required(
            destination["relation"] as string,
            `fieldInventory[${index}].destination.relation`,
            255,
          ),
          field: required(
            destination["field"] as string,
            `fieldInventory[${index}].destination.field`,
            255,
          ),
        }
      : null;
    if (
      normalizedDestination &&
      (!DESTINATION_RELATION_PATTERN.test(normalizedDestination.relation) ||
        !DESTINATION_FIELD_PATTERN.test(normalizedDestination.field))
    ) {
      throw new Error(
        `fieldInventory[${index}].destination must identify a private canonical field`,
      );
    }
    const mappingDecision = field[
      "mappingDecision"
    ] as NationwideSourceCandidateFieldMappingDecision;
    const extensionKey = optional(
      field["extensionKey"] as string | null,
      `fieldInventory[${index}].extensionKey`,
      255,
    );
    if (extensionKey !== null && !KEY_PATTERN.test(extensionKey)) {
      throw new Error(`fieldInventory[${index}].extensionKey must use lowercase snake case`);
    }
    if (
      (mappingDecision === "core_field") !== (normalizedDestination !== null) ||
      (mappingDecision === "extension_attribute") !== (extensionKey !== null) ||
      (mappingDecision !== "core_field" && normalizedDestination !== null) ||
      (mappingDecision !== "extension_attribute" && extensionKey !== null)
    ) {
      throw new Error(`fieldInventory[${index}] has fields inconsistent with mappingDecision`);
    }
    return {
      fieldPath,
      publishedLabel: optional(
        field["publishedLabel"] as string | null,
        `fieldInventory[${index}].publishedLabel`,
        1_024,
      ),
      sourceValueTypes: [...sourceValueTypes],
      semanticRole: field["semanticRole"] as NationwideSourceCandidateFieldSemanticRole,
      mappingDecision,
      destination: normalizedDestination,
      extensionKey,
      fieldNotes: optional(
        field["fieldNotes"] as string | null,
        `fieldInventory[${index}].fieldNotes`,
        4_096,
      ),
    };
  });
}

function normalizedAssessmentDraft(input: NationwideSourceCandidateAssessmentDraft) {
  const assessmentVersion = positiveInteger(input.assessmentVersion, "assessmentVersion");
  if (!dispositions.has(input.disposition)) throw new Error("disposition is not supported");
  if (!accessModes.has(input.accessMode)) throw new Error("accessMode is not supported");
  if (!formats.has(input.sourceFormatHint)) throw new Error("sourceFormatHint is not supported");
  if (!lanes.has(input.recordLaneHint)) throw new Error("recordLaneHint is not supported");
  if (!termsStatuses.has(input.termsReviewStatus))
    throw new Error("termsReviewStatus is not supported");
  if (!structureStatuses.has(input.structureReviewStatus))
    throw new Error("structureReviewStatus is not supported");
  if (!identityStatuses.has(input.identityReviewStatus))
    throw new Error("identityReviewStatus is not supported");
  if (!["real_property", "personal_property", "mixed"].includes(input.assetClass)) {
    throw new Error("assetClass is not supported");
  }
  if (typeof input.officialSource !== "boolean") throw new Error("officialSource must be boolean");
  const fieldInventory = normalizedFieldInventory(input.fieldInventory);
  const assessment = {
    assessmentVersion,
    disposition: input.disposition,
    publisherName: required(input.publisherName, "publisherName"),
    publishingAgency: optional(input.publishingAgency, "publishingAgency"),
    sourceFamily: required(input.sourceFamily, "sourceFamily"),
    assetClass: input.assetClass,
    landingPageUrl: publicUrl(input.landingPageUrl),
    officialSource: input.officialSource,
    accessMode: input.accessMode,
    retrievalMethodHint: optional(input.retrievalMethodHint, "retrievalMethodHint"),
    sourceFormatHint: input.sourceFormatHint,
    recordLaneHint: input.recordLaneHint,
    expectedUpdateFrequency: optional(input.expectedUpdateFrequency, "expectedUpdateFrequency"),
    termsReviewStatus: input.termsReviewStatus,
    structureReviewStatus: input.structureReviewStatus,
    identityReviewStatus: input.identityReviewStatus,
    ...(fieldInventory === undefined ? {} : { fieldInventory }),
    sampleArtifact:
      input.sampleArtifact === null
        ? null
        : {
            sha256: input.sampleArtifact.sha256,
            objectStorageKey: required(
              input.sampleArtifact.objectStorageKey,
              "sampleArtifact.objectStorageKey",
            ),
            mimeType: required(input.sampleArtifact.mimeType, "sampleArtifact.mimeType", 255),
            byteSize: input.sampleArtifact.byteSize,
          },
    decisionNotes: optional(input.decisionNotes, "decisionNotes", 16_384),
    assessedBy: required(input.assessedBy, "assessedBy", 255),
    assessedAt: canonicalUtc(input.assessedAt, "assessedAt"),
  };
  if (assessment.sampleArtifact) {
    if (!SHA256_PATTERN.test(assessment.sampleArtifact.sha256)) {
      throw new Error("sampleArtifact.sha256 must be a lowercase SHA-256 digest");
    }
    if (
      !Number.isSafeInteger(assessment.sampleArtifact.byteSize) ||
      assessment.sampleArtifact.byteSize < 0
    ) {
      throw new Error("sampleArtifact.byteSize must be a nonnegative safe integer");
    }
  }
  if (["rejected", "retired"].includes(assessment.disposition) && !assessment.decisionNotes) {
    throw new Error(`${assessment.disposition} assessments require decisionNotes`);
  }
  if (
    fieldInventory &&
    assessment.structureReviewStatus === "not_started" &&
    fieldInventory.length > 0
  ) {
    throw new Error("fieldInventory requires a sampled, mapped, or incompatible structure review");
  }
  if (
    fieldInventory &&
    assessment.structureReviewStatus === "mapped" &&
    fieldInventory.some((field) => field.mappingDecision === "unreviewed")
  ) {
    throw new Error("mapped fieldInventory cannot contain unreviewed fields");
  }
  if (assessment.disposition === "qualified") {
    const valid =
      assessment.officialSource &&
      assessment.accessMode !== "unavailable" &&
      assessment.retrievalMethodHint !== null &&
      assessment.sourceFormatHint !== "unknown" &&
      ["auction", "property_record"].includes(assessment.recordLaneHint) &&
      assessment.expectedUpdateFrequency !== null &&
      assessment.termsReviewStatus === "approved" &&
      assessment.structureReviewStatus === "mapped" &&
      ["reviewed_match_only", "reviewed_authoritative"].includes(assessment.identityReviewStatus) &&
      assessment.sampleArtifact !== null &&
      fieldInventory !== undefined &&
      fieldInventory.length > 0 &&
      fieldInventory.every((field) => field.mappingDecision !== "unreviewed");
    if (!valid) {
      throw new Error(
        "qualified assessments require official, approved, mapped, archived, lane-specific source evidence",
      );
    }
  }
  return assessment;
}

export function validateNationwideSourceCandidateAssessmentDraft(input: unknown) {
  const value = record(input, "source candidate assessment");
  exactKeys(value, assessmentKeys, "source candidate assessment");
  if (value["sampleArtifact"] !== null) {
    const sampleArtifact = record(value["sampleArtifact"], "sampleArtifact");
    exactKeys(sampleArtifact, sampleArtifactKeys, "sampleArtifact");
  }
  return normalizedAssessmentDraft(value as NationwideSourceCandidateAssessmentDraft);
}

function normalizedAssessment(input: AssessNationwideSourceCandidateInput) {
  return {
    candidateId: uuid(input.candidateId, "candidateId"),
    ...normalizedAssessmentDraft(input),
  };
}

async function assertFieldInventoryDestinations(
  transaction: PostgresTransaction,
  fieldInventory: NationwideSourceCandidateFieldInventoryEntry[],
) {
  const destinations = [
    ...new Set(
      fieldInventory
        .map((field) => field.destination)
        .filter(
          (destination): destination is NonNullable<typeof destination> => destination !== null,
        )
        .map((destination) => `${destination.relation}.${destination.field}`),
    ),
  ];
  if (destinations.length === 0) return;
  const result = await transaction.query<{ destination: string }>(
    `
    select table_schema || '.' || table_name || '.' || column_name as destination
    from information_schema.columns
    where table_schema in ('property_core', 'property_ingest')
      and table_schema || '.' || table_name || '.' || column_name = any($1::text[])
  `,
    [destinations],
  );
  const found = new Set(result.rows.map((row) => row.destination));
  const missing = destinations.filter((destination) => !found.has(destination));
  if (missing.length > 0) {
    throw new Error(
      `fieldInventory destination does not identify an existing private canonical field: ${missing[0]}`,
    );
  }
}

async function fieldInventoryFingerprints(
  fieldInventory: NationwideSourceCandidateFieldInventoryEntry[],
) {
  return Promise.all(fieldInventory.map((field) => stableSha256(field)));
}

async function assertStoredFieldInventory(
  transaction: PostgresTransaction,
  assessmentId: string,
  fieldInventory: NationwideSourceCandidateFieldInventoryEntry[],
  fingerprints: string[],
) {
  const stored = await transaction.query<{
    field_index: number | string;
    field_fingerprint: string;
  }>(
    `
    select field_index, field_fingerprint
    from property_ingest.source_candidate_assessment_fields
    where assessment_id = $1
    order by field_index
  `,
    [assessmentId],
  );
  if (
    stored.rows.length !== fieldInventory.length ||
    stored.rows.some(
      (row, index) =>
        Number(row.field_index) !== index || row.field_fingerprint !== fingerprints[index],
    )
  ) {
    throw new Error(
      "stored source candidate field inventory does not match its immutable assessment",
    );
  }
}

async function persistFieldInventory(
  transaction: PostgresTransaction,
  assessmentId: string,
  fieldInventory: NationwideSourceCandidateFieldInventoryEntry[],
  fingerprints: string[],
) {
  const batchSize = 250;
  for (let offset = 0; offset < fieldInventory.length; offset += batchSize) {
    const fields = fieldInventory.slice(offset, offset + batchSize);
    const parameters: unknown[] = [];
    const rows = fields.map((field, batchIndex) => {
      const fieldIndex = offset + batchIndex;
      const base = parameters.length;
      parameters.push(
        assessmentId,
        fieldIndex,
        field.fieldPath,
        field.publishedLabel,
        field.sourceValueTypes,
        field.semanticRole,
        field.mappingDecision,
        field.destination?.relation ?? null,
        field.destination?.field ?? null,
        field.extensionKey,
        field.fieldNotes,
        fingerprints[fieldIndex],
      );
      return `(${Array.from({ length: 12 }, (_unused, index) => `$${base + index + 1}`).join(", ")})`;
    });
    await transaction.query(
      `
      insert into property_ingest.source_candidate_assessment_fields (
        assessment_id, field_index, field_path, published_label,
        source_value_types, semantic_role, mapping_decision,
        destination_relation, destination_field, extension_key,
        field_notes, field_fingerprint
      ) values ${rows.join(", ")}
    `,
      parameters,
    );
  }
}

export async function discoverNationwideSourceCandidate(
  database: PostgresTransactionHost,
  input: DiscoverNationwideSourceCandidateInput,
) {
  return database.transaction((transaction) =>
    discoverNationwideSourceCandidateInTransaction(transaction, input),
  );
}

export async function discoverNationwideSourceCandidateInTransaction(
  transaction: PostgresTransaction,
  input: DiscoverNationwideSourceCandidateInput,
) {
  const candidateKey = required(input.candidateKey, "candidateKey", 255);
  if (!KEY_PATTERN.test(candidateKey)) {
    throw new Error("candidateKey must contain lowercase letters, numbers, and single underscores");
  }
  const discoveredBy = required(input.discoveredBy, "discoveredBy", 255);
  const discoveredAt = canonicalUtc(input.discoveredAt, "discoveredAt");
  const jurisdiction = await registerNationwideJurisdictionInTransaction(
    transaction,
    input.jurisdiction,
  );
  const inserted = await transaction.query<{ id: string }>(
    `
    insert into property_ingest.source_candidates (
      jurisdiction_id, candidate_key, discovered_by, discovered_at
    ) values ($1, $2, $3, $4::timestamptz)
    on conflict (jurisdiction_id, candidate_key) do nothing
    returning id
  `,
    [jurisdiction.jurisdictionId, candidateKey, discoveredBy, discoveredAt],
  );
  const insertedRow = inserted.rows[0];
  if (insertedRow !== undefined) {
    return { candidateId: insertedRow.id, ...jurisdiction, replayed: false };
  }
  const existing = await transaction.query<{ id: string }>(
    `
    select id from property_ingest.source_candidates
    where jurisdiction_id = $1 and candidate_key = $2
  `,
    [jurisdiction.jurisdictionId, candidateKey],
  );
  const existingRow = existing.rows[0];
  if (existing.rows.length !== 1 || existingRow === undefined) {
    throw new Error("source candidate registration failed");
  }
  return { candidateId: existingRow.id, ...jurisdiction, replayed: true };
}

export async function assessNationwideSourceCandidate(
  database: PostgresTransactionHost,
  input: AssessNationwideSourceCandidateInput,
) {
  return database.transaction((transaction) =>
    assessNationwideSourceCandidateInTransaction(transaction, input),
  );
}

export async function assessNationwideSourceCandidateInTransaction(
  transaction: PostgresTransaction,
  input: AssessNationwideSourceCandidateInput,
) {
  const assessment = normalizedAssessment(input);
  const assessmentFingerprint = await stableSha256(assessment);
  const fieldInventory = assessment.fieldInventory ?? [];
  const inventoryFingerprints = await fieldInventoryFingerprints(fieldInventory);
  await assertFieldInventoryDestinations(transaction, fieldInventory);
  const candidate = await transaction.query<{ id: string }>(
    `
      select id from property_ingest.source_candidates
      where id = $1
      for update
    `,
    [assessment.candidateId],
  );
  if (candidate.rows.length !== 1) throw new Error("source candidate does not exist");
  const existing = await transaction.query<{ id: string; assessment_fingerprint: string }>(
    `
      select id, assessment_fingerprint
      from property_ingest.source_candidate_assessments
      where candidate_id = $1 and assessment_version = $2
    `,
    [assessment.candidateId, assessment.assessmentVersion],
  );
  const existingAssessment = existing.rows[0];
  if (existingAssessment !== undefined) {
    if (existingAssessment.assessment_fingerprint !== assessmentFingerprint) {
      throw new Error("source candidate assessment version is immutable");
    }
    await assertStoredFieldInventory(
      transaction,
      existingAssessment.id,
      fieldInventory,
      inventoryFingerprints,
    );
    return {
      assessmentId: existingAssessment.id,
      assessmentVersion: assessment.assessmentVersion,
      assessmentFingerprint,
      replayed: true,
    };
  }
  const latest = await transaction.query<{ latest_version: number | string | null }>(
    `
      select max(assessment_version) as latest_version
      from property_ingest.source_candidate_assessments
      where candidate_id = $1
    `,
    [assessment.candidateId],
  );
  const latestVersion = Number(latest.rows[0]?.latest_version ?? 0);
  if (assessment.assessmentVersion !== latestVersion + 1) {
    throw new Error(`assessmentVersion must be ${latestVersion + 1} for this source candidate`);
  }
  const artifact = assessment.sampleArtifact;
  const inserted = await transaction.query<{ id: string }>(
    `
      insert into property_ingest.source_candidate_assessments (
        candidate_id, assessment_version, assessment_fingerprint, disposition,
        publisher_name, publishing_agency, source_family, asset_class,
        landing_page_url, official_source, access_mode, retrieval_method_hint,
        source_format_hint, record_lane_hint, expected_update_frequency,
        terms_review_status, structure_review_status, identity_review_status,
        field_inventory_count,
        sample_artifact_sha256, sample_object_storage_key, sample_mime_type,
        sample_byte_size, decision_notes, assessed_by, assessed_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::timestamptz
      ) returning id
    `,
    [
      assessment.candidateId,
      assessment.assessmentVersion,
      assessmentFingerprint,
      assessment.disposition,
      assessment.publisherName,
      assessment.publishingAgency,
      assessment.sourceFamily,
      assessment.assetClass,
      assessment.landingPageUrl,
      assessment.officialSource,
      assessment.accessMode,
      assessment.retrievalMethodHint,
      assessment.sourceFormatHint,
      assessment.recordLaneHint,
      assessment.expectedUpdateFrequency,
      assessment.termsReviewStatus,
      assessment.structureReviewStatus,
      assessment.identityReviewStatus,
      fieldInventory.length,
      artifact?.sha256 ?? null,
      artifact?.objectStorageKey ?? null,
      artifact?.mimeType ?? null,
      artifact?.byteSize ?? null,
      assessment.decisionNotes,
      assessment.assessedBy,
      assessment.assessedAt,
    ],
  );
  const insertedAssessment = inserted.rows[0];
  if (insertedAssessment === undefined) {
    throw new Error("source candidate assessment registration failed");
  }
  await persistFieldInventory(
    transaction,
    insertedAssessment.id,
    fieldInventory,
    inventoryFingerprints,
  );
  return {
    assessmentId: insertedAssessment.id,
    assessmentVersion: assessment.assessmentVersion,
    assessmentFingerprint,
    replayed: false,
  };
}

export async function promoteNationwideSourceCandidate(
  database: PostgresTransactionHost,
  input: PromoteNationwideSourceCandidateInput,
) {
  const candidateId = uuid(input.candidateId, "candidateId");
  const assessmentId = uuid(input.assessmentId, "assessmentId");
  const sourceDefinitionId = uuid(input.sourceDefinitionId, "sourceDefinitionId");
  const promotedBy = required(input.promotedBy, "promotedBy", 255);
  const promotedAt = canonicalUtc(input.promotedAt, "promotedAt");
  return database.transaction(async (transaction) => {
    const jurisdiction = await transaction.query<{ jurisdiction_id: string }>(
      `
      select jurisdiction_id from property_ingest.source_candidates where id = $1
    `,
      [candidateId],
    );
    const jurisdictionRow = jurisdiction.rows[0];
    if (jurisdiction.rows.length !== 1 || jurisdictionRow === undefined) {
      throw new Error("source candidate does not exist");
    }
    const jurisdictionId = jurisdictionRow.jurisdiction_id;
    const inserted = await transaction.query<{ candidate_id: string }>(
      `
      insert into property_ingest.source_candidate_promotions (
        candidate_id, assessment_id, source_definition_id, jurisdiction_id,
        promoted_by, promoted_at
      ) values ($1, $2, $3, $4, $5, $6::timestamptz)
      on conflict (candidate_id) do nothing
      returning candidate_id
    `,
      [candidateId, assessmentId, sourceDefinitionId, jurisdictionId, promotedBy, promotedAt],
    );
    if (inserted.rows.length === 1) return { candidateId, sourceDefinitionId, replayed: false };
    const existing = await transaction.query<{
      assessment_id: string;
      source_definition_id: string;
      promoted_by: string;
      promoted_at: string | Date;
    }>(
      `
      select assessment_id, source_definition_id, promoted_by, promoted_at
      from property_ingest.source_candidate_promotions
      where candidate_id = $1
    `,
      [candidateId],
    );
    const row = existing.rows[0];
    const storedPromotedAt = row ? new Date(row.promoted_at).toISOString() : null;
    if (
      !row ||
      row.assessment_id !== assessmentId ||
      row.source_definition_id !== sourceDefinitionId ||
      row.promoted_by !== promotedBy ||
      storedPromotedAt !== promotedAt
    ) {
      throw new Error("source candidate promotion is immutable");
    }
    return { candidateId, sourceDefinitionId, replayed: true };
  });
}

export async function requireCurrentNationwideSourceCandidatePromotion(
  database: PostgresTransactionHost,
  input: { sourceKey: string; contractVersion: number },
) {
  const sourceKey = required(input.sourceKey, "sourceKey", 255);
  if (!KEY_PATTERN.test(sourceKey)) {
    throw new Error("sourceKey must use lowercase letters, numbers, and single underscores");
  }
  if (!Number.isInteger(input.contractVersion) || input.contractVersion < 1) {
    throw new Error("contractVersion must be a positive integer");
  }
  return database.transaction(async (transaction) => {
    const result = await transaction.query<{ source_definition_id: string }>(
      `
      select promotion.source_definition_id::text
      from property_ingest.source_candidate_promotions promotion
      join property_ingest.source_candidate_assessments assessment
        on assessment.id = promotion.assessment_id
      join property_ingest.source_definitions definition
        on definition.id = promotion.source_definition_id
      where definition.source_key = $1
        and definition.contract_version = $2
        and assessment.disposition = 'qualified'
        and assessment.id = (
          select latest.id
          from property_ingest.source_candidate_assessments latest
          where latest.candidate_id = promotion.candidate_id
          order by latest.assessment_version desc
          limit 1
        )
    `,
      [sourceKey, input.contractVersion],
    );
    const promotionRow = result.rows[0];
    if (result.rows.length !== 1 || promotionRow === undefined) {
      throw new Error("source execution requires one current qualified candidate promotion");
    }
    return { sourceDefinitionId: promotionRow.source_definition_id };
  });
}

type CoverageRow = {
  candidate_id: string;
  candidate_key: string;
  jurisdiction_id: string;
  jurisdiction_type: string;
  jurisdiction_name: string;
  state_code: string;
  state_fips: string;
  county_fips: string | null;
  disposition: NationwideSourceCandidateDisposition | null;
  promoted: boolean;
};

export async function getNationwideSourceDiscoveryCoverage(database: PostgresTransactionHost) {
  return database.transaction((transaction) =>
    getNationwideSourceDiscoveryCoverageInTransaction(transaction),
  );
}

export async function getNationwideSourceDiscoveryCoverageInTransaction(
  transaction: PostgresTransaction,
) {
  const result = await transaction.query<CoverageRow>(
    `
    with latest_assessments as (
      select distinct on (candidate_id)
        candidate_id, disposition
      from property_ingest.source_candidate_assessments
      order by candidate_id, assessment_version desc
    )
    select
      candidate.id as candidate_id,
      candidate.candidate_key,
      jurisdiction.id as jurisdiction_id,
      jurisdiction.jurisdiction_type,
      jurisdiction.name as jurisdiction_name,
      jurisdiction.state_code,
      jurisdiction.state_fips,
      jurisdiction.county_fips,
      assessment.disposition,
      (promotion.candidate_id is not null) as promoted
    from property_ingest.source_candidates candidate
    join property_core.jurisdictions jurisdiction on jurisdiction.id = candidate.jurisdiction_id
    left join latest_assessments assessment on assessment.candidate_id = candidate.id
    left join property_ingest.source_candidate_promotions promotion on promotion.candidate_id = candidate.id
    order by jurisdiction.state_code, jurisdiction.county_fips nulls first,
      jurisdiction.jurisdiction_type, jurisdiction.name, candidate.candidate_key
  `,
    [],
  );
  const knownStateCodes = new Set(US_STATE_CATALOG.map((state) => state.stateCode));
  const baselineStateCodes = new Set<string>(CENSUS_COUNTY_CATALOG_METADATA.coveredStateCodes);
  const knownBaselineCountyFips = new Set(CENSUS_COUNTY_CATALOG.map((county) => county.countyFips));
  type CoverageCandidateRow = (typeof result.rows)[number];
  const candidateRowsByState = new Map<string, CoverageCandidateRow[]>();
  const candidateRowsByCounty = new Map<string, CoverageCandidateRow[]>();
  for (const row of result.rows) {
    if (!knownStateCodes.has(row.state_code as (typeof US_STATE_CATALOG)[number]["stateCode"])) {
      throw new Error(`source candidate references unsupported state ${row.state_code}`);
    }
    if (
      row.county_fips &&
      baselineStateCodes.has(row.state_code) &&
      !knownBaselineCountyFips.has(row.county_fips)
    ) {
      throw new Error(`source candidate references unsupported county ${row.county_fips}`);
    }
    const stateRows = candidateRowsByState.get(row.state_code) ?? [];
    stateRows.push(row);
    candidateRowsByState.set(row.state_code, stateRows);
    if (row.county_fips) {
      const countyRows = candidateRowsByCounty.get(row.county_fips) ?? [];
      countyRows.push(row);
      candidateRowsByCounty.set(row.county_fips, countyRows);
    }
  }
  const countyCoverage = CENSUS_COUNTY_CATALOG.map((county) => {
    const rows = candidateRowsByCounty.get(county.countyFips) ?? [];
    return {
      ...county,
      candidateCount: rows.length,
      directCountyCandidateCount: rows.filter(
        (row) => row.jurisdiction_type === "county_equivalent",
      ).length,
      containedLocalCandidateCount: rows.filter(
        (row) => row.jurisdiction_type !== "county_equivalent",
      ).length,
      reviewCount: rows.filter(
        (row) => row.disposition === null || row.disposition === "needs_review",
      ).length,
      qualifiedCount: rows.filter((row) => row.disposition === "qualified").length,
      promotedCount: rows.filter((row) => row.promoted).length,
      rejectedCount: rows.filter(
        (row) => row.disposition === "rejected" || row.disposition === "retired",
      ).length,
      candidateJurisdictionCount: new Set(rows.map((row) => row.jurisdiction_id)).size,
    };
  });
  const countyCoverageByState = new Map<string, typeof countyCoverage>();
  for (const county of countyCoverage) {
    const counties = countyCoverageByState.get(county.stateCode) ?? [];
    counties.push(county);
    countyCoverageByState.set(county.stateCode, counties);
  }
  const stateCoverage = US_STATE_CATALOG.map((state) => {
    const rows = candidateRowsByState.get(state.stateCode) ?? [];
    const counties = countyCoverageByState.get(state.stateCode) ?? [];
    const countyBaselineLoaded = baselineStateCodes.has(state.stateCode);
    return {
      ...state,
      candidateCount: rows.length,
      reviewCount: rows.filter(
        (row) => row.disposition === null || row.disposition === "needs_review",
      ).length,
      qualifiedCount: rows.filter((row) => row.disposition === "qualified").length,
      promotedCount: rows.filter((row) => row.promoted).length,
      rejectedCount: rows.filter(
        (row) => row.disposition === "rejected" || row.disposition === "retired",
      ).length,
      jurisdictionCount: new Set(rows.map((row) => row.jurisdiction_id)).size,
      countyBaselineStatus: countyBaselineLoaded ? ("complete" as const) : ("not_loaded" as const),
      countyEquivalentCount: countyBaselineLoaded ? counties.length : null,
      countiesWithCandidates: countyBaselineLoaded
        ? counties.filter((county) => county.candidateCount > 0).length
        : null,
      countiesWithoutCandidates: countyBaselineLoaded
        ? counties.filter((county) => county.candidateCount === 0).length
        : null,
    };
  });
  const jurisdictionMap = new Map<
    string,
    {
      jurisdictionId: string;
      jurisdictionType: string;
      jurisdictionName: string;
      stateCode: string;
      stateFips: string;
      countyFips: string | null;
      candidateCount: number;
      qualifiedCount: number;
      promotedCount: number;
    }
  >();
  for (const row of result.rows) {
    const current = jurisdictionMap.get(row.jurisdiction_id) ?? {
      jurisdictionId: row.jurisdiction_id,
      jurisdictionType: row.jurisdiction_type,
      jurisdictionName: row.jurisdiction_name,
      stateCode: row.state_code,
      stateFips: row.state_fips,
      countyFips: row.county_fips,
      candidateCount: 0,
      qualifiedCount: 0,
      promotedCount: 0,
    };
    current.candidateCount += 1;
    if (row.disposition === "qualified") current.qualifiedCount += 1;
    if (row.promoted) current.promotedCount += 1;
    jurisdictionMap.set(row.jurisdiction_id, current);
  }
  return {
    stateCoverage,
    countyCoverage,
    jurisdictions: [...jurisdictionMap.values()],
    national: {
      stateEquivalentCount: stateCoverage.length,
      statesWithCandidates: stateCoverage.filter((state) => state.candidateCount > 0).length,
      statesWithQualifiedCandidates: stateCoverage.filter((state) => state.qualifiedCount > 0)
        .length,
      statesWithPromotedSources: stateCoverage.filter((state) => state.promotedCount > 0).length,
      candidateCount: result.rows.length,
      qualifiedCount: result.rows.filter((row) => row.disposition === "qualified").length,
      promotedCount: result.rows.filter((row) => row.promoted).length,
      countyBaselineVintage: CENSUS_COUNTY_CATALOG_METADATA.vintage,
      countyBaselineStateCount: CENSUS_COUNTY_CATALOG_METADATA.coveredStateCodes.length,
      countyEquivalentBaselineCount: countyCoverage.length,
      baselineCountiesWithCandidates: countyCoverage.filter((county) => county.candidateCount > 0)
        .length,
      baselineCountiesWithoutCandidates: countyCoverage.filter(
        (county) => county.candidateCount === 0,
      ).length,
      countyBaselineCompleteForNation:
        CENSUS_COUNTY_CATALOG_METADATA.coveredStateCodes.length === US_STATE_CATALOG.length,
    },
  };
}

type ResearchFieldCoverageRow = {
  assessment_id: string;
  candidate_id: string;
  candidate_key: string;
  jurisdiction_id: string;
  state_code: string;
  county_fips: string | null;
  field_path: string;
  published_label: string | null;
  semantic_role: NationwideSourceCandidateFieldSemanticRole;
  mapping_decision: NationwideSourceCandidateFieldMappingDecision;
  destination_relation: string | null;
  destination_field: string | null;
  extension_key: string | null;
};

export async function getNationwideSourceResearchFieldCoverage(database: PostgresTransactionHost) {
  return database.transaction(async (transaction) => {
    const latest = await transaction.query<{
      assessment_id: string;
      field_inventory_count: number | string;
    }>(
      `
      select distinct on (assessment.candidate_id)
        assessment.id as assessment_id,
        assessment.field_inventory_count
      from property_ingest.source_candidate_assessments assessment
      order by assessment.candidate_id, assessment.assessment_version desc
    `,
      [],
    );
    const fields = await transaction.query<ResearchFieldCoverageRow>(
      `
      with latest_assessments as (
        select distinct on (candidate_id) id, candidate_id
        from property_ingest.source_candidate_assessments
        order by candidate_id, assessment_version desc
      )
      select
        assessment.id as assessment_id,
        candidate.id as candidate_id,
        candidate.candidate_key,
        jurisdiction.id as jurisdiction_id,
        jurisdiction.state_code,
        jurisdiction.county_fips,
        field.field_path,
        field.published_label,
        field.semantic_role,
        field.mapping_decision,
        field.destination_relation,
        field.destination_field,
        field.extension_key
      from latest_assessments latest
      join property_ingest.source_candidate_assessments assessment on assessment.id = latest.id
      join property_ingest.source_candidates candidate on candidate.id = assessment.candidate_id
      join property_core.jurisdictions jurisdiction on jurisdiction.id = candidate.jurisdiction_id
      join property_ingest.source_candidate_assessment_fields field on field.assessment_id = assessment.id
      order by candidate.candidate_key, field.field_index
    `,
      [],
    );
    const inventoriedAssessmentIds = new Set(fields.rows.map((field) => field.assessment_id));
    const concepts = new Map<
      string,
      {
        conceptKey: string;
        semanticRole: NationwideSourceCandidateFieldSemanticRole;
        mappingDecision: NationwideSourceCandidateFieldMappingDecision;
        destinationRelation: string | null;
        destinationField: string | null;
        extensionKey: string | null;
        assessmentIds: Set<string>;
        candidateIds: Set<string>;
        jurisdictionIds: Set<string>;
        stateCodes: Set<string>;
        countyFips: Set<string>;
        sourcePaths: Set<string>;
        publishedLabels: Set<string>;
      }
    >();
    for (const field of fields.rows) {
      const conceptKey =
        field.mapping_decision === "core_field"
          ? `core:${field.destination_relation}.${field.destination_field}`
          : field.mapping_decision === "extension_attribute"
            ? `extension:${field.extension_key}`
            : `${field.mapping_decision}:${field.semantic_role}`;
      const concept = concepts.get(conceptKey) ?? {
        conceptKey,
        semanticRole: field.semantic_role,
        mappingDecision: field.mapping_decision,
        destinationRelation: field.destination_relation,
        destinationField: field.destination_field,
        extensionKey: field.extension_key,
        assessmentIds: new Set<string>(),
        candidateIds: new Set<string>(),
        jurisdictionIds: new Set<string>(),
        stateCodes: new Set<string>(),
        countyFips: new Set<string>(),
        sourcePaths: new Set<string>(),
        publishedLabels: new Set<string>(),
      };
      concept.assessmentIds.add(field.assessment_id);
      concept.candidateIds.add(field.candidate_id);
      concept.jurisdictionIds.add(field.jurisdiction_id);
      concept.stateCodes.add(field.state_code);
      if (field.county_fips) concept.countyFips.add(field.county_fips);
      concept.sourcePaths.add(field.field_path);
      if (field.published_label) concept.publishedLabels.add(field.published_label);
      concepts.set(conceptKey, concept);
    }
    const inventoryAssessmentCount = inventoriedAssessmentIds.size;
    return {
      latestAssessmentCount: latest.rows.length,
      inventoryAssessmentCount,
      assessmentsWithoutInventory: latest.rows.length - inventoryAssessmentCount,
      fieldCount: fields.rows.length,
      unreviewedFieldCount: fields.rows.filter((field) => field.mapping_decision === "unreviewed")
        .length,
      concepts: [...concepts.values()]
        .map((concept) => ({
          conceptKey: concept.conceptKey,
          semanticRole: concept.semanticRole,
          mappingDecision: concept.mappingDecision,
          destinationRelation: concept.destinationRelation,
          destinationField: concept.destinationField,
          extensionKey: concept.extensionKey,
          assessmentCount: concept.assessmentIds.size,
          candidateCount: concept.candidateIds.size,
          jurisdictionCount: concept.jurisdictionIds.size,
          stateCount: concept.stateCodes.size,
          countyCount: concept.countyFips.size,
          commonAcrossInventoriedAssessments:
            inventoryAssessmentCount > 0 && concept.assessmentIds.size === inventoryAssessmentCount,
          sourcePaths: [...concept.sourcePaths].sort(),
          publishedLabels: [...concept.publishedLabels].sort(),
        }))
        .sort((left, right) => left.conceptKey.localeCompare(right.conceptKey)),
    };
  });
}
