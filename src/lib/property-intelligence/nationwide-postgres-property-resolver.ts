// Slice 4 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-postgres-property-resolver.ts:
// loads a source's enabled identifier-match policies and the canonical
// identifier/crosswalk evidence a bundle's published identifiers point at,
// then hands both to nationwide-property-resolution.ts's pure
// `resolveNormalizedProperty`. When `property_ingest.identifier_match_policies`
// has no enabled, currently-effective row for this source, `policies` comes
// back empty and `resolveNormalizedProperty` always returns "unresolved"
// with reason "No enabled identifier match policy authorizes automatic
// resolution for this source." -- fails closed until an approved policy
// exists, preserved exactly, not loosened.
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import type { NormalizedIdentifierCandidate } from "./nationwide-property-intake-types.ts";
import {
  resolveNormalizedProperty,
  type CanonicalPropertyIdentifier,
  type IdentifierMatchPolicy,
  type OfficialPropertyCrosswalk,
  type PropertyResolutionBundle,
  type PropertyResolutionResult,
} from "./nationwide-property-resolution.ts";
import { UUID_V1_TO_V5 as UUID_PATTERN } from "../validation/patterns.ts";

type SourceContractSnapshot = { policies: IdentifierMatchPolicy[] };

type EligibleIdentifier = {
  issuerCountyFips: string;
  identifierType: string;
  normalizedValue: string;
};

export type NationwidePostgresPropertyResolver = (
  bundle: PropertyResolutionBundle,
) => Promise<PropertyResolutionResult>;

export type CreateNationwidePostgresPropertyResolverInput = {
  database: PostgresTransactionHost;
  sourceDefinitionId: string;
  sourceDefinitionKey: string;
  contractVersion: number;
  resolutionAsOf: string;
};

function required(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function uuid(value: string, field: string) {
  const normalized = required(value, field);
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${field} must be a UUID`);
  return normalized;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function canonicalIso(value: string, field: string) {
  const normalized = required(value, field);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return normalized;
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function eligibleIdentifiers(
  bundle: PropertyResolutionBundle,
  policies: IdentifierMatchPolicy[],
): EligibleIdentifier[] {
  const result = new Map<string, EligibleIdentifier>();
  for (const identifier of bundle.propertyCandidate.identifiers) {
    for (const policy of policies) {
      if (
        !policy.enabled ||
        policy.sourceIdentifierType !== identifier.identifierType ||
        (policy.issuerCountyFips !== null &&
          policy.issuerCountyFips !== identifier.issuerCountyFips)
      ) {
        continue;
      }
      const candidate = {
        issuerCountyFips: identifier.issuerCountyFips,
        identifierType: policy.canonicalIdentifierType,
        normalizedValue: identifier.normalizedValue,
      };
      result.set(
        `${candidate.issuerCountyFips}:${candidate.identifierType}:${candidate.normalizedValue}`,
        candidate,
      );
    }
  }
  return [...result.values()].sort(
    (left, right) =>
      left.issuerCountyFips.localeCompare(right.issuerCountyFips) ||
      left.identifierType.localeCompare(right.identifierType) ||
      left.normalizedValue.localeCompare(right.normalizedValue),
  );
}

async function loadSourceContractSnapshot(
  transaction: PostgresTransaction,
  input: {
    sourceDefinitionId: string;
    sourceDefinitionKey: string;
    contractVersion: number;
    resolutionAsOf: string;
  },
): Promise<SourceContractSnapshot> {
  const source = await transaction.query<{ source_key: string; contract_version: number }>(
    `select source_key, contract_version from property_ingest.source_definitions where id = $1`,
    [input.sourceDefinitionId],
  );
  const sourceRow = source.rows[0];
  if (source.rows.length !== 1 || sourceRow === undefined) {
    throw new Error("sourceDefinitionId does not identify one registered source definition");
  }
  if (
    sourceRow.source_key !== input.sourceDefinitionKey ||
    Number(sourceRow.contract_version) !== input.contractVersion
  ) {
    throw new Error(
      "property resolver source contract does not match the registered source definition",
    );
  }

  const policies = await transaction.query<{
    source_identifier_type: string;
    canonical_identifier_type: string;
    issuer_jurisdiction_id: string | null;
    issuer_county_fips: string | null;
    policy_version: string;
    evidence_reference: string;
  }>(
    `select
       policy.source_identifier_type, policy.canonical_identifier_type,
       policy.issuer_jurisdiction_id::text, jurisdiction.county_fips as issuer_county_fips,
       policy.policy_version, policy.evidence_reference
     from property_ingest.identifier_match_policies policy
     left join property_core.jurisdictions jurisdiction on jurisdiction.id = policy.issuer_jurisdiction_id
     where policy.source_definition_id = $1
       and policy.enabled
       and (policy.effective_from is null or policy.effective_from <= $2::timestamptz)
       and (policy.effective_to is null or $2::timestamptz < policy.effective_to)
     order by policy.source_identifier_type, policy.canonical_identifier_type, jurisdiction.county_fips nulls first, policy.policy_version`,
    [input.sourceDefinitionId, input.resolutionAsOf],
  );

  const supportedIdentifierTypes = new Set<NormalizedIdentifierCandidate["identifierType"]>([
    "parcel_number",
    "apn",
    "pin",
    "ppin",
    "tax_sale_parcel_reference",
  ]);
  return {
    policies: policies.rows.map((policy) => {
      if (
        !supportedIdentifierTypes.has(
          policy.source_identifier_type as NormalizedIdentifierCandidate["identifierType"],
        )
      ) {
        throw new Error(
          `enabled identifier policy uses unsupported source identifier type ${policy.source_identifier_type}`,
        );
      }
      if (policy.issuer_jurisdiction_id !== null && policy.issuer_county_fips === null) {
        throw new Error(
          "enabled identifier policy issuer must identify a county-equivalent jurisdiction",
        );
      }
      return {
        sourceDefinitionKey: input.sourceDefinitionKey,
        sourceIdentifierType:
          policy.source_identifier_type as NormalizedIdentifierCandidate["identifierType"],
        canonicalIdentifierType: required(
          policy.canonical_identifier_type,
          "canonical identifier type",
        ),
        issuerCountyFips: policy.issuer_county_fips,
        policyVersion: required(policy.policy_version, "identifier policy version"),
        evidenceReference: required(
          policy.evidence_reference,
          "identifier policy evidence reference",
        ),
        enabled: true,
      };
    }),
  };
}

async function loadResolutionEvidence(
  transaction: PostgresTransaction,
  input: {
    bundle: PropertyResolutionBundle;
    sourceDefinitionId: string;
    sourceDefinitionKey: string;
    policies: IdentifierMatchPolicy[];
  },
) {
  const crosswalkResult = await transaction.query<{
    property_id: string;
    evidence_reference: string;
  }>(
    `select crosswalk.property_id::text, crosswalk.evidence_reference
     from property_ingest.official_property_crosswalks crosswalk
     join property_ingest.source_records source_record
       on source_record.id = crosswalk.source_record_id and source_record.source_definition_id = crosswalk.source_definition_id
     join property_core.properties property on property.id = crosswalk.property_id
     where crosswalk.source_definition_id = $1
       and source_record.source_record_key = $2
       and source_record.record_fingerprint = $3
       and crosswalk.active
     order by crosswalk.property_id, crosswalk.evidence_reference`,
    [
      input.sourceDefinitionId,
      input.bundle.sourceRecord.sourceRecordKey,
      input.bundle.sourceRecord.recordFingerprint,
    ],
  );
  const crosswalks: OfficialPropertyCrosswalk[] = crosswalkResult.rows.map((crosswalk) => ({
    sourceDefinitionKey: input.sourceDefinitionKey,
    sourceRecordKey: input.bundle.sourceRecord.sourceRecordKey,
    propertyId: crosswalk.property_id,
    evidenceReference: required(crosswalk.evidence_reference, "crosswalk evidence reference"),
    active: true,
  }));

  const candidates = eligibleIdentifiers(input.bundle, input.policies);
  let canonicalIdentifiers: CanonicalPropertyIdentifier[] = [];
  if (candidates.length > 0) {
    const identifierResult = await transaction.query<{
      property_id: string;
      issuer_county_fips: string;
      identifier_type: string;
      normalized_value: string;
      is_authoritative: boolean;
      is_preferred: boolean;
      valid_to: string | null;
    }>(
      `select
         identifier.property_id::text, jurisdiction.county_fips as issuer_county_fips,
         identifier.identifier_type, identifier.normalized_value,
         identifier.is_authoritative, identifier.is_preferred, identifier.valid_to::text
       from property_core.property_identifiers identifier
       join property_core.jurisdictions jurisdiction on jurisdiction.id = identifier.issuer_jurisdiction_id
       join jsonb_to_recordset($1::jsonb) as candidate(
         issuer_county_fips text, identifier_type text, normalized_value text
       ) on candidate.issuer_county_fips = jurisdiction.county_fips
         and candidate.identifier_type = identifier.identifier_type
         and candidate.normalized_value = identifier.normalized_value
       where identifier.is_authoritative and identifier.valid_to is null
       order by identifier.property_id, identifier.identifier_type, identifier.normalized_value`,
      [
        JSON.stringify(
          candidates.map((candidate) => ({
            issuer_county_fips: candidate.issuerCountyFips,
            identifier_type: candidate.identifierType,
            normalized_value: candidate.normalizedValue,
          })),
        ),
      ],
    );
    canonicalIdentifiers = identifierResult.rows.map((identifier) => ({
      propertyId: identifier.property_id,
      issuerCountyFips: identifier.issuer_county_fips,
      identifierType: identifier.identifier_type,
      normalizedValue: identifier.normalized_value,
      isAuthoritative: identifier.is_authoritative,
      isPreferred: identifier.is_preferred,
      validTo: identifier.valid_to,
    }));
  }

  return {
    canonicalIdentifiers,
    crosswalks,
    knownPropertyIds: unique([
      ...canonicalIdentifiers.map((identifier) => identifier.propertyId),
      ...crosswalks.map((crosswalk) => crosswalk.propertyId),
    ]),
  };
}

export function createNationwidePostgresPropertyResolver(
  input: CreateNationwidePostgresPropertyResolverInput,
): NationwidePostgresPropertyResolver {
  const sourceDefinitionId = uuid(input.sourceDefinitionId, "sourceDefinitionId");
  const sourceDefinitionKey = required(input.sourceDefinitionKey, "sourceDefinitionKey");
  const contractVersion = positiveInteger(input.contractVersion, "contractVersion");
  const resolutionAsOf = canonicalIso(input.resolutionAsOf, "resolutionAsOf");
  let sourceContractSnapshot: Promise<SourceContractSnapshot> | null = null;

  function snapshot() {
    sourceContractSnapshot ??= input.database.transaction((transaction) =>
      loadSourceContractSnapshot(transaction, {
        sourceDefinitionId,
        sourceDefinitionKey,
        contractVersion,
        resolutionAsOf,
      }),
    );
    return sourceContractSnapshot;
  }

  return async (bundle) => {
    if (bundle.sourceRecord.sourceDefinitionKey !== sourceDefinitionKey) {
      throw new Error("normalized bundle source key does not match the property resolver contract");
    }
    const contract = await snapshot();
    return input.database.transaction(async (transaction) => {
      const evidence = await loadResolutionEvidence(transaction, {
        bundle,
        sourceDefinitionId,
        sourceDefinitionKey,
        policies: contract.policies,
      });
      return resolveNormalizedProperty({
        bundle,
        policies: contract.policies,
        canonicalIdentifiers: evidence.canonicalIdentifiers,
        knownPropertyIds: evidence.knownPropertyIds,
        crosswalks: evidence.crosswalks,
      });
    });
  };
}
