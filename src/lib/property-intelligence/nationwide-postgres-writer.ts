// Slice 4 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1, Slice 3 68d2ae9). Ported (condensed) from
// property-intelligence-app's app/lib/nationwide-postgres-writer.ts: given a
// normalized bundle (Slice 3's adapter output) and a resolution result
// (nationwide-postgres-property-resolver.ts / the source's own
// pre-resolved input), persist the source evidence, the canonical property
// assertions, and the auction/property-record search projections in one
// bounded transaction supplied by an injected `PostgresTransactionHost` (no
// default, no real connection anywhere -- see nationwide-pg-transaction-host.ts).
//
// Update: the "public attribute visibility" extension layer this header
// used to describe as omitted (`persistExtensions` / `publicAttributesForEntity`
// / `refreshAuctionLotSearchableAttributes` against
// property_core.attribute_definitions / entity_attributes /
// property_ingest.attribute_visibility_decisions) is now ported --
// see nationwide-attribute-extensions.ts and nationwide-attribute-visibility.ts,
// and the migration that adds those tables,
// 20260924180000_property_intelligence_attribute_governance.sql. This module
// calls persistExtensions after upserting an auction lot and populates
// property_api.auction_lot_search.searchable_attributes from
// publicAttributesForEntity -- which only ever returns an attribute once an
// explicit visibility-review decision authorizes it (private by default,
// never loosened). property_api.property_record_search keeps
// `searchable_attributes` at `{}` because NormalizedPropertyRecordBundle
// carries no extensions field in either this repo or the source.
// `search_text` (built from the bundle's own published fields, exactly as
// the source's nationwide-property-search.ts builds it) still carries real
// search content. Everything else -- source evidence upsert with
// content-addressed idempotency, canonical property/identifier/address/
// observation assertions, auction event/lot/amount/party/lifecycle
// persistence (idempotent per immutable component fingerprint, so a
// repeated occurrence of a lot adds new bid/amount rows rather than
// silently overwriting a prior winning bid -- "preserves bid semantics"),
// and the resolve-or-bootstrap-authoritative-property path for
// single-authoritative-identifier sources -- is real, complete persistence
// logic targeting the exact tables in
// supabase/migrations/20260924170000_property_intelligence_record_model.sql.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import type {
  NormalizedIntakeBundle,
  NormalizedObservation,
  NormalizedPropertyRecordBundle,
} from "./nationwide-property-intake-types.ts";
import {
  buildAuctionLotSearchDocument,
  buildPropertyRecordSearchDocument,
} from "./nationwide-property-search.ts";
import type { PropertyResolutionResult } from "./nationwide-property-resolution.ts";
import { refreshCanonicalPropertySearch } from "./nationwide-postgres-run-store-search.ts";
import {
  persistExtensions,
  publicAttributesForEntity,
  refreshAuctionLotSearchableAttributes,
  searchableAttributeText,
} from "./nationwide-attribute-extensions.ts";

export { refreshCanonicalPropertySearch, refreshAuctionLotSearchableAttributes };

export type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";

export type PersistNormalizedAuctionBundleInput = {
  bundle: NormalizedIntakeBundle;
  sourceDefinitionId: string;
  jurisdictionId: string;
  ingestionRunId: string;
  resolution: PropertyResolutionResult;
  resolutionAlgorithmVersion: string;
};

export type PersistedNormalizedAuctionBundle = {
  sourceDocumentId: string;
  sourceRecordId: string;
  sourceRecordVersionCreated: boolean;
  sourceRecordOccurrenceId: string;
  auctionEventId: string;
  auctionLotId: string;
  resolutionCaseId: string;
  propertyId: string | null;
};

export type PersistNormalizedPropertyRecordBundleInput = {
  bundle: NormalizedPropertyRecordBundle;
  sourceDefinitionId: string;
  jurisdictionId: string;
  ingestionRunId: string;
  resolution: PropertyResolutionResult;
  resolutionAlgorithmVersion: string;
};

export type PersistedNormalizedPropertyRecordBundle = {
  sourceDocumentId: string;
  sourceRecordId: string;
  sourceRecordVersionCreated: boolean;
  sourceRecordOccurrenceId: string;
  resolutionCaseId: string;
  propertyId: string | null;
};

type PersistablePropertyBundle = Pick<
  NormalizedIntakeBundle,
  "jurisdiction" | "sourceRecord" | "propertyCandidate"
>;

type BasePersistenceInput = {
  bundle: PersistablePropertyBundle;
  sourceDefinitionId: string;
  jurisdictionId: string;
  ingestionRunId: string;
  resolution: PropertyResolutionResult;
  resolutionAlgorithmVersion: string;
};

type ValidatedSourceContract = {
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  authoritativeIdentifierTypes: string[];
  identityEstablishmentMode: "match_only" | "single_authoritative_identifier";
};

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

function requireText(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required`);
}

function json(value: unknown) {
  return JSON.stringify(value);
}

async function one<Row extends Record<string, unknown>>(
  transaction: PostgresTransaction,
  sql: string,
  params: unknown[],
  failure: string,
): Promise<Row> {
  const result = await transaction.query<Row>(sql, params);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) throw new Error(failure);
  return row;
}

function recordType(bundle: NormalizedIntakeBundle) {
  return bundle.auction.saleMechanism === "state_forfeited_inventory"
    ? "state_forfeited_inventory_item"
    : "county_tax_sale_lot";
}

function currentLifecycle(bundle: NormalizedIntakeBundle) {
  return bundle.auction.lifecycle.at(-1)?.eventType ?? "unknown";
}

function resolutionCaseStatus(resolution: PropertyResolutionResult) {
  if (resolution.status === "resolved") return "auto_resolved";
  if (resolution.status === "needs_review" || resolution.status === "conflicted")
    return "needs_review";
  return "open";
}

function observationColumns(observation: NormalizedObservation) {
  if (typeof observation.value === "number") {
    return { valueText: null, valueNumeric: observation.value, valueBoolean: null };
  }
  if (typeof observation.value === "boolean") {
    return { valueText: null, valueNumeric: null, valueBoolean: observation.value };
  }
  return { valueText: observation.value, valueNumeric: null, valueBoolean: null };
}

async function validateReferences(transaction: PostgresTransaction, input: BasePersistenceInput) {
  const source = await one<{
    source_key: string;
    jurisdiction_id: string;
    contract_version: number;
    authoritative_identifier_types: string[];
    identity_establishment_mode: "match_only" | "single_authoritative_identifier";
  }>(
    transaction,
    `select source_key, jurisdiction_id, contract_version, authoritative_identifier_types,
            identity_establishment_mode
     from property_ingest.source_definitions where id = $1`,
    [input.sourceDefinitionId],
    "sourceDefinitionId does not identify a registered source definition",
  );
  if (source.source_key !== input.bundle.sourceRecord.sourceDefinitionKey) {
    throw new Error("bundle sourceDefinitionKey does not match the registered source definition");
  }
  const jurisdiction = await one<{
    state_code: string | null;
    county_fips: string | null;
    name: string;
  }>(
    transaction,
    "select state_code, county_fips, name from property_core.jurisdictions where id = $1",
    [input.jurisdictionId],
    "jurisdictionId does not identify a registered jurisdiction",
  );
  if (
    jurisdiction.state_code !== input.bundle.jurisdiction.stateCode ||
    jurisdiction.county_fips !== input.bundle.jurisdiction.countyFips ||
    jurisdiction.name.trim().toLowerCase() !==
      input.bundle.jurisdiction.countyName.trim().toLowerCase()
  ) {
    throw new Error("bundle jurisdiction does not match the registered county jurisdiction");
  }
  return {
    sourceJurisdictionId: source.jurisdiction_id,
    sourceContract: {
      sourceDefinitionId: input.sourceDefinitionId,
      sourceKey: source.source_key,
      contractVersion: Number(source.contract_version),
      authoritativeIdentifierTypes: source.authoritative_identifier_types,
      identityEstablishmentMode: source.identity_establishment_mode,
    } satisfies ValidatedSourceContract,
  };
}

function canonicalBootstrapCandidate(
  input: BasePersistenceInput,
  sourceContract: ValidatedSourceContract,
) {
  if (sourceContract.identityEstablishmentMode !== "single_authoritative_identifier") return null;
  const allowedTypes = new Set(sourceContract.authoritativeIdentifierTypes);
  const candidates = new Map<string, (typeof input.bundle.propertyCandidate.identifiers)[number]>();
  for (const identifier of input.bundle.propertyCandidate.identifiers) {
    if (!identifier.isAuthoritative || !allowedTypes.has(identifier.identifierType)) continue;
    if (identifier.issuerCountyFips !== input.bundle.jurisdiction.countyFips) {
      throw new Error(
        "authoritative source identifier issuer does not match the normalized property county",
      );
    }
    const key = `${identifier.issuerCountyFips}:${identifier.identifierType}:${identifier.normalizedValue}`;
    candidates.set(key, identifier);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

// Ported behavior: a record-writer source that publishes exactly one
// authoritative county-scoped identifier per row may bootstrap a canonical
// property row (or claim the existing one) even when no identifier-match
// policy exists yet -- this is distinct from, and does not weaken, the
// resolver's own "fails closed without an approved policy" behavior for
// cross-source matching (nationwide-property-resolution.ts).
async function resolveOrBootstrapAuthoritativeProperty(
  transaction: PostgresTransaction,
  input: BasePersistenceInput,
  sourceRecordId: string,
  sourceContract: ValidatedSourceContract,
): Promise<PropertyResolutionResult> {
  if (input.resolution.status !== "unresolved") return input.resolution;
  const identifier = canonicalBootstrapCandidate(input, sourceContract);
  if (!identifier) return input.resolution;

  const identityLockKey = [
    "accountabul-property-identity-v1",
    input.jurisdictionId,
    identifier.identifierType,
    identifier.normalizedValue,
  ].join(":");
  await transaction.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    identityLockKey,
  ]);

  const currentIdentifier = () =>
    transaction.query<{ property_id: string }>(
      `select property_id::text from property_core.property_identifiers
       where issuer_jurisdiction_id = $1 and identifier_type = $2 and normalized_value = $3
         and valid_to is null and is_authoritative
       order by property_id`,
      [input.jurisdictionId, identifier.identifierType, identifier.normalizedValue],
    );

  let propertyId: string;
  const existing = await currentIdentifier();
  if (existing.rows.length > 1) {
    throw new Error(
      "one current authoritative identifier is attached to multiple canonical properties",
    );
  }
  if (existing.rows.length === 1) {
    propertyId = (existing.rows[0] as { property_id: string }).property_id;
  } else {
    const candidateProperty = await one<{ id: string }>(
      transaction,
      `insert into property_core.properties (jurisdiction_id, lifecycle_state, match_status, review_status)
       values ($1, 'active', 'resolved', 'not_reviewed') returning id`,
      [input.jurisdictionId],
      "canonical property bootstrap failed",
    );
    const claimed = await transaction.query<{ property_id: string }>(
      `insert into property_core.property_identifiers (
         property_id, issuer_jurisdiction_id, identifier_type, raw_value,
         normalized_value, source_record_id, verification_status, is_authoritative, is_preferred
       ) values ($1, $2, $3, $4, $5, $6, $7, true, true)
       on conflict do nothing
       returning property_id::text`,
      [
        candidateProperty.id,
        input.jurisdictionId,
        identifier.identifierType,
        identifier.rawValue,
        identifier.normalizedValue,
        sourceRecordId,
        identifier.verificationStatus,
      ],
    );
    if (claimed.rows.length === 1) {
      propertyId = (claimed.rows[0] as { property_id: string }).property_id;
    } else {
      await transaction.query("delete from property_core.properties where id = $1", [
        candidateProperty.id,
      ]);
      const concurrent = await currentIdentifier();
      if (concurrent.rows.length !== 1) {
        throw new Error(
          "authoritative property identity claim could not be reconciled after a concurrent insert",
        );
      }
      propertyId = (concurrent.rows[0] as { property_id: string }).property_id;
    }
  }

  const policyVersion = `source-contract:c${sourceContract.contractVersion}`;
  return {
    status: "resolved",
    propertyId,
    method: "authoritative_source_identity",
    candidatePropertyIds: [propertyId],
    matchedIdentifiers: [
      {
        sourceIdentifierType: identifier.identifierType,
        canonicalIdentifierType: identifier.identifierType,
        issuerCountyFips: identifier.issuerCountyFips,
        normalizedValue: identifier.normalizedValue,
        propertyId,
        policyVersion,
      },
    ],
    evidenceReferences: [
      `source-contract:${sourceContract.sourceKey}:c${sourceContract.contractVersion}:authoritative_identifier_types`,
    ],
    reason:
      "One reviewed property-record source contract publishes one authoritative county-scoped identifier.",
  };
}

async function persistPropertyAssertions(
  transaction: PostgresTransaction,
  input: BasePersistenceInput,
  sourceRecordId: string,
) {
  const propertyId = input.resolution.status === "resolved" ? input.resolution.propertyId : null;
  if (!propertyId) return;

  for (const identifier of input.bundle.propertyCandidate.identifiers) {
    if (identifier.isAuthoritative) {
      const inserted = await transaction.query<{ property_id: string }>(
        `insert into property_core.property_identifiers (
           property_id, issuer_jurisdiction_id, identifier_type, raw_value,
           normalized_value, source_record_id, verification_status, is_authoritative, is_preferred
         ) values ($1, $2, $3, $4, $5, $6, $7, true, false)
         on conflict do nothing
         returning property_id::text`,
        [
          propertyId,
          input.jurisdictionId,
          identifier.identifierType,
          identifier.rawValue,
          identifier.normalizedValue,
          sourceRecordId,
          identifier.verificationStatus,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await transaction.query<{ property_id: string }>(
          `select property_id::text from property_core.property_identifiers
           where issuer_jurisdiction_id = $1 and identifier_type = $2 and normalized_value = $3
             and valid_to is null and is_authoritative`,
          [input.jurisdictionId, identifier.identifierType, identifier.normalizedValue],
        );
        if (existing.rows.length !== 1 || existing.rows[0]?.property_id !== propertyId) {
          throw new Error(
            "authoritative identifier assertion conflicts with canonical property identity",
          );
        }
      }
      continue;
    }
    await transaction.query(
      `insert into property_core.property_identifiers (
         property_id, issuer_jurisdiction_id, identifier_type, raw_value,
         normalized_value, source_record_id, verification_status, is_authoritative, is_preferred
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, false)
       on conflict (property_id, issuer_jurisdiction_id, identifier_type, normalized_value, source_record_id)
       do update set raw_value = excluded.raw_value`,
      [
        propertyId,
        input.jurisdictionId,
        identifier.identifierType,
        identifier.rawValue,
        identifier.normalizedValue,
        sourceRecordId,
        identifier.verificationStatus,
        identifier.isAuthoritative,
      ],
    );
  }

  for (const address of input.bundle.propertyCandidate.addresses) {
    await transaction.query(
      `insert into property_core.property_addresses (
         property_id, address_role, raw_address, city, state_code, postal_code,
         verification_status, source_record_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (property_id, address_role, raw_address, source_record_id)
       do update set city = excluded.city, state_code = excluded.state_code, postal_code = excluded.postal_code`,
      [
        propertyId,
        address.role,
        address.rawAddress,
        address.city,
        address.stateCode,
        address.postalCode,
        address.verificationStatus,
        sourceRecordId,
      ],
    );
  }

  for (const observation of input.bundle.propertyCandidate.observations) {
    const values = observationColumns(observation);
    const fingerprint = await stableSha256({
      sourceRecordFingerprint: input.bundle.sourceRecord.recordFingerprint,
      factType: observation.factType,
      value: observation.value,
      unit: observation.unit,
      effectiveDate: observation.effectiveDate,
      verificationStatus: observation.verificationStatus,
      derivationMethod: observation.derivationMethod,
    });
    await transaction.query(
      `insert into property_core.property_observations (
         property_id, fact_type, value_text, value_numeric, value_boolean,
         unit, effective_date, observed_at, source_record_id,
         observation_fingerprint, verification_status, derivation_method
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (property_id, observation_fingerprint) do nothing`,
      [
        propertyId,
        observation.factType,
        values.valueText,
        values.valueNumeric,
        values.valueBoolean,
        observation.unit,
        observation.effectiveDate,
        input.bundle.sourceRecord.sourceDocumentRetrievedAt,
        sourceRecordId,
        fingerprint,
        observation.verificationStatus,
        observation.derivationMethod,
      ],
    );
  }
}

async function persistPropertyRecordListing(
  transaction: PostgresTransaction,
  input: PersistNormalizedPropertyRecordBundleInput,
  sourceRecordId: string,
  propertyId: string | null,
) {
  const listing = input.bundle.listing;
  const persisted = await transaction.query<{ source_record_id: string }>(
    `insert into property_core.property_record_listings (
       source_record_id, property_id, jurisdiction_id, record_kind,
       lifecycle_state, published_status_text, published_owner_text,
       legal_description, published_amount, published_amount_type,
       published_amount_label, observed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (source_record_id) do update set
       property_id = coalesce(property_core.property_record_listings.property_id, excluded.property_id),
       lifecycle_state = excluded.lifecycle_state,
       published_status_text = excluded.published_status_text,
       updated_at = now()
     where property_core.property_record_listings.jurisdiction_id = excluded.jurisdiction_id
       and property_core.property_record_listings.record_kind = excluded.record_kind
       and (
         property_core.property_record_listings.property_id is null
         or excluded.property_id is null
         or property_core.property_record_listings.property_id = excluded.property_id
       )
     returning source_record_id::text`,
    [
      sourceRecordId,
      propertyId,
      input.jurisdictionId,
      listing.recordKind,
      listing.lifecycleState,
      listing.publishedStatusText,
      listing.publishedOwnerText,
      listing.legalDescription,
      listing.publishedAmount,
      listing.publishedAmountType,
      listing.publishedAmountLabel,
      input.bundle.sourceRecord.sourceDocumentRetrievedAt,
    ],
  );
  if (persisted.rows.length !== 1) {
    throw new Error("property-record listing conflicts with its immutable normalized source facts");
  }
}

async function persistSourceEvidence(
  transaction: PostgresTransaction,
  input: BasePersistenceInput,
  options: { recordType: string; publishedOwnerText: string | null },
) {
  const references = await validateReferences(transaction, input);
  const bundle = input.bundle;
  const document = await one<{ id: string }>(
    transaction,
    `insert into property_ingest.source_documents (
       source_definition_id, jurisdiction_id, source_url, canonical_publication_url,
       title, published_at, retrieved_at, mime_type, byte_size, object_storage_key,
       sha256, retrieval_status
     ) values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, 'succeeded')
     on conflict (source_definition_id, sha256) do update set
       retrieved_at = greatest(property_ingest.source_documents.retrieved_at, excluded.retrieved_at),
       title = coalesce(property_ingest.source_documents.title, excluded.title)
     returning id`,
    [
      input.sourceDefinitionId,
      references.sourceJurisdictionId,
      bundle.sourceRecord.sourceDocumentUrl,
      bundle.sourceRecord.documentTitle,
      bundle.sourceRecord.sourceDocumentPublishedAt,
      bundle.sourceRecord.sourceDocumentRetrievedAt,
      bundle.sourceRecord.sourceDocumentMimeType,
      bundle.sourceRecord.sourceDocumentByteSize,
      bundle.sourceRecord.sourceDocumentObjectStorageKey,
      bundle.sourceRecord.sourceDocumentSha256,
    ],
    "source document upsert failed",
  );

  await one(
    transaction,
    `update property_ingest.ingestion_runs
     set source_document_id = coalesce(source_document_id, $1)
     where id = $2 and source_definition_id = $3
       and (source_document_id is null or source_document_id = $1)
     returning id`,
    [document.id, input.ingestionRunId, input.sourceDefinitionId],
    "ingestion run does not belong to this source document and definition",
  );

  const normalizedAddress =
    bundle.propertyCandidate.addresses.find((address) => address.role === "situs")?.rawAddress ??
    bundle.propertyCandidate.addresses[0]?.rawAddress ??
    null;
  const identifiers =
    bundle.propertyCandidate.identifiers.map((identifier) => identifier.rawValue).join(" | ") ||
    null;
  const insertedSourceRecord = await transaction.query<{ id: string }>(
    `insert into property_ingest.source_records (
       source_definition_id, source_document_id, ingestion_run_id, source_record_key,
       source_version, record_fingerprint, source_url, record_type, page_locator,
       row_locator, feature_locator, raw_json, normalized_address_text,
       published_owner_text, published_identifier_text, parsing_status, field_warnings,
       first_seen_at, last_seen_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb, $18, $18)
     on conflict (source_definition_id, source_record_key, record_fingerprint) do nothing
     returning id`,
    [
      input.sourceDefinitionId,
      document.id,
      input.ingestionRunId,
      bundle.sourceRecord.sourceRecordKey,
      bundle.sourceRecord.sourceVersion,
      bundle.sourceRecord.recordFingerprint,
      bundle.sourceRecord.sourceUrl,
      options.recordType,
      bundle.sourceRecord.pageLocator,
      bundle.sourceRecord.rowLocator,
      bundle.sourceRecord.featureLocator,
      json(bundle.sourceRecord.rawJson),
      normalizedAddress,
      options.publishedOwnerText,
      identifiers,
      bundle.sourceRecord.parsingStatus,
      json(bundle.sourceRecord.warnings),
      bundle.sourceRecord.sourceDocumentRetrievedAt,
    ],
  );
  const sourceRecordVersionCreated =
    insertedSourceRecord.rows.length === 1 && insertedSourceRecord.rows[0] !== undefined;
  const sourceRecord = sourceRecordVersionCreated
    ? (insertedSourceRecord.rows[0] as { id: string })
    : await one<{ id: string }>(
        transaction,
        `update property_ingest.source_records
         set last_seen_at = greatest(last_seen_at, $4::timestamptz)
         where source_definition_id = $1 and source_record_key = $2 and record_fingerprint = $3
         returning id`,
        [
          input.sourceDefinitionId,
          bundle.sourceRecord.sourceRecordKey,
          bundle.sourceRecord.recordFingerprint,
          bundle.sourceRecord.sourceDocumentRetrievedAt,
        ],
        "source record lookup after idempotent insert failed",
      );

  const occurrenceKey = await stableSha256({
    sourceRecordKey: bundle.sourceRecord.sourceRecordKey,
    recordFingerprint: bundle.sourceRecord.recordFingerprint,
    pageLocator: bundle.sourceRecord.pageLocator,
    rowLocator: bundle.sourceRecord.rowLocator,
    featureLocator: bundle.sourceRecord.featureLocator,
  });
  const occurrence = await one<{ id: string }>(
    transaction,
    `insert into property_ingest.source_record_occurrences (
       source_record_id, source_document_id, ingestion_run_id, occurrence_key,
       source_url, page_locator, row_locator, feature_locator, parsing_status,
       field_warnings, created_new_version, resolution_status,
       resolution_algorithm_version, resolved_property_id, observed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
     on conflict (ingestion_run_id, occurrence_key) do update set
       observed_at = excluded.observed_at,
       field_warnings = excluded.field_warnings,
       resolution_status = excluded.resolution_status,
       resolution_algorithm_version = excluded.resolution_algorithm_version,
       resolved_property_id = excluded.resolved_property_id
     returning id`,
    [
      sourceRecord.id,
      document.id,
      input.ingestionRunId,
      occurrenceKey,
      bundle.sourceRecord.sourceUrl,
      bundle.sourceRecord.pageLocator,
      bundle.sourceRecord.rowLocator,
      bundle.sourceRecord.featureLocator,
      bundle.sourceRecord.parsingStatus,
      json(bundle.sourceRecord.warnings),
      sourceRecordVersionCreated,
      input.resolution.status,
      input.resolutionAlgorithmVersion,
      input.resolution.status === "resolved" ? input.resolution.propertyId : null,
      bundle.sourceRecord.sourceDocumentRetrievedAt,
    ],
    "source record occurrence upsert failed",
  );

  await transaction.query(
    `insert into property_ingest.source_record_states (
       source_definition_id, source_record_key, current_source_record_id, first_seen_at, last_seen_at
     ) values ($1, $2, $3, $4, $4)
     on conflict (source_definition_id, source_record_key) do update set
       current_source_record_id = excluded.current_source_record_id,
       last_seen_at = excluded.last_seen_at,
       withdrawn_at = null,
       withdrawal_run_id = null,
       updated_at = now()
     where excluded.last_seen_at >= property_ingest.source_record_states.last_seen_at`,
    [
      input.sourceDefinitionId,
      bundle.sourceRecord.sourceRecordKey,
      sourceRecord.id,
      bundle.sourceRecord.sourceDocumentRetrievedAt,
    ],
  );

  return {
    document,
    sourceRecord,
    sourceRecordVersionCreated,
    occurrence,
    sourceContract: references.sourceContract,
  };
}

export async function persistNormalizedAuctionBundle(
  database: PostgresTransactionHost,
  input: PersistNormalizedAuctionBundleInput,
): Promise<PersistedNormalizedAuctionBundle> {
  assertUuid(input.sourceDefinitionId, "sourceDefinitionId");
  assertUuid(input.jurisdictionId, "jurisdictionId");
  assertUuid(input.ingestionRunId, "ingestionRunId");
  requireText(input.resolutionAlgorithmVersion, "resolutionAlgorithmVersion");
  if (input.resolution.status === "resolved" && !input.resolution.propertyId) {
    throw new Error("resolved input must include propertyId");
  }

  return database.transaction(async (transaction) => {
    const bundle = input.bundle;
    const owner =
      bundle.auction.parties.find((party) => party.role === "assessed_owner")?.publishedName ??
      null;
    const evidence = await persistSourceEvidence(transaction, input, {
      recordType: recordType(bundle),
      publishedOwnerText: owner,
    });
    const { document, sourceRecord, sourceRecordVersionCreated, occurrence } = evidence;
    const agency =
      bundle.auction.parties.find((party) => party.role === "administering_agency")
        ?.publishedName ?? "Publishing agency not specified";

    // Preserves the event window: starts_at/ends_at widen to cover every
    // occurrence's published window rather than being clobbered by a later,
    // narrower publication.
    const event = await one<{ id: string }>(
      transaction,
      `insert into property_core.auction_events (
         jurisdiction_id, source_definition_id, source_document_id, source_event_key,
         administering_agency, event_label, sale_mechanism, asset_class, starts_at, ends_at, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (source_definition_id, jurisdiction_id, source_event_key) do update set
         source_document_id = excluded.source_document_id,
         administering_agency = excluded.administering_agency,
         event_label = excluded.event_label,
         sale_mechanism = excluded.sale_mechanism,
         asset_class = excluded.asset_class,
         starts_at = least(property_core.auction_events.starts_at, excluded.starts_at),
         ends_at = greatest(property_core.auction_events.ends_at, excluded.ends_at),
         status = excluded.status,
         updated_at = now()
       returning id`,
      [
        input.jurisdictionId,
        input.sourceDefinitionId,
        document.id,
        bundle.auction.eventKey,
        agency,
        bundle.auction.eventLabel,
        bundle.auction.saleMechanism,
        bundle.auction.assetClass,
        bundle.auction.startsAt,
        bundle.auction.endsAt,
        bundle.auction.status,
      ],
      "auction event upsert failed",
    );

    const lot = await one<{ id: string }>(
      transaction,
      `insert into property_core.auction_lots (
         auction_event_id, source_record_id, source_lot_key, published_lot_number,
         published_item_number, published_certificate_number, published_receipt_number,
         legal_description, published_address_text, tax_years, lifecycle_state
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, array(select value::int from jsonb_array_elements_text($10::jsonb)), $11)
       on conflict (auction_event_id, source_lot_key) do update set
         source_record_id = excluded.source_record_id,
         published_lot_number = excluded.published_lot_number,
         published_item_number = excluded.published_item_number,
         published_certificate_number = excluded.published_certificate_number,
         published_receipt_number = excluded.published_receipt_number,
         legal_description = excluded.legal_description,
         published_address_text = excluded.published_address_text,
         tax_years = excluded.tax_years,
         lifecycle_state = excluded.lifecycle_state,
         updated_at = now()
       returning id`,
      [
        event.id,
        sourceRecord.id,
        bundle.auction.lotKey,
        bundle.auction.publishedLotNumber,
        bundle.auction.publishedItemNumber,
        bundle.auction.publishedCertificateNumber,
        bundle.auction.publishedReceiptNumber,
        bundle.auction.legalDescription,
        bundle.auction.publishedAddressText,
        json(bundle.auction.taxYears),
        currentLifecycle(bundle),
      ],
      "auction lot upsert failed",
    );

    await persistExtensions(transaction, bundle, sourceRecord.id, lot.id);

    // Preserves bid semantics: each distinct published amount (by immutable
    // component fingerprint) is its own row -- a later occurrence with a
    // higher winning_bid ADDS a row rather than overwriting the prior one,
    // so the full bid history stays on file. The search projection below
    // reads the CURRENT bundle's own amounts, so the surfaced winning_bid
    // always reflects the most recently observed published value.
    for (const amount of bundle.auction.amounts) {
      const fingerprint = await stableSha256({
        sourceRecordFingerprint: bundle.sourceRecord.recordFingerprint,
        ...amount,
      });
      await transaction.query(
        `insert into property_core.auction_amounts (
           auction_lot_id, source_record_id, amount_type, amount, currency, tax_year, value_status, component_fingerprint
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (auction_lot_id, component_fingerprint) do nothing`,
        [
          lot.id,
          sourceRecord.id,
          amount.amountType,
          amount.amount,
          amount.currency,
          amount.taxYear,
          amount.valueStatus,
          fingerprint,
        ],
      );
    }

    for (const party of bundle.auction.parties) {
      const fingerprint = await stableSha256({
        sourceRecordFingerprint: bundle.sourceRecord.recordFingerprint,
        ...party,
      });
      await transaction.query(
        `insert into property_core.auction_parties (auction_lot_id, source_record_id, party_role, published_name, party_fingerprint)
         values ($1, $2, $3, $4, $5)
         on conflict (auction_lot_id, party_fingerprint) do nothing`,
        [lot.id, sourceRecord.id, party.role, party.publishedName, fingerprint],
      );
    }

    for (const lifecycle of bundle.auction.lifecycle) {
      const fingerprint = await stableSha256({
        sourceRecordFingerprint: bundle.sourceRecord.recordFingerprint,
        ...lifecycle,
      });
      await transaction.query(
        `insert into property_core.auction_lifecycle_events (
           auction_lot_id, source_record_id, event_type, effective_at, observed_at, published_status_text, event_fingerprint
         ) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (auction_lot_id, event_fingerprint) do nothing`,
        [
          lot.id,
          sourceRecord.id,
          lifecycle.eventType,
          lifecycle.effectiveAt,
          bundle.sourceRecord.sourceDocumentRetrievedAt,
          lifecycle.publishedStatusText,
          fingerprint,
        ],
      );
    }

    if (bundle.auction.stateForfeitedDetails) {
      const details = bundle.auction.stateForfeitedDetails;
      await transaction.query(
        `insert into property_core.state_forfeited_details (
           auction_lot_id, certified_market_value, back_tax_total, active_application_count,
           pending_review_application_count, patent_status, source_record_id
         ) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (auction_lot_id) do update set
           certified_market_value = excluded.certified_market_value,
           back_tax_total = excluded.back_tax_total,
           active_application_count = excluded.active_application_count,
           pending_review_application_count = excluded.pending_review_application_count,
           patent_status = excluded.patent_status,
           source_record_id = excluded.source_record_id`,
        [
          lot.id,
          details.certifiedMarketValue,
          details.backTaxTotal,
          details.activeApplicationCount,
          details.pendingReviewApplicationCount,
          details.patentStatus,
          sourceRecord.id,
        ],
      );
    }

    const acceptedPropertyId =
      input.resolution.status === "resolved" ? input.resolution.propertyId : null;
    const resolutionCase = await one<{ id: string }>(
      transaction,
      `insert into property_ingest.resolution_cases (
         source_record_id, auction_lot_id, algorithm_version, status, resolution_method, accepted_property_id
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (source_record_id, algorithm_version) do update set
         auction_lot_id = excluded.auction_lot_id,
         status = excluded.status,
         resolution_method = excluded.resolution_method,
         accepted_property_id = excluded.accepted_property_id,
         updated_at = now()
       returning id`,
      [
        sourceRecord.id,
        lot.id,
        input.resolutionAlgorithmVersion,
        resolutionCaseStatus(input.resolution),
        input.resolution.method,
        acceptedPropertyId,
      ],
      "resolution case upsert failed",
    );

    if (input.resolution.method) {
      for (const candidatePropertyId of input.resolution.candidatePropertyIds) {
        await transaction.query(
          `insert into property_ingest.resolution_candidates (resolution_case_id, property_id, match_method, matched_values, confidence, decision)
           values ($1, $2, $3, $4::jsonb, 1, $5)
           on conflict (resolution_case_id, property_id, match_method) do update set
             matched_values = excluded.matched_values, confidence = excluded.confidence, decision = excluded.decision`,
          [
            resolutionCase.id,
            candidatePropertyId,
            input.resolution.method,
            json({
              identifiers: input.resolution.matchedIdentifiers.filter(
                (match) => match.propertyId === candidatePropertyId,
              ),
              evidenceReferences: input.resolution.evidenceReferences,
              reason: input.resolution.reason,
            }),
            acceptedPropertyId === candidatePropertyId ? "accepted" : "pending",
          ],
        );
      }
    }

    await transaction.query(
      `update property_core.auction_lot_properties set active = false, invalidated_at = now()
       where auction_lot_id = $1 and active and verification_status = 'derived'`,
      [lot.id],
    );
    if (acceptedPropertyId) {
      await transaction.query(
        `insert into property_core.auction_lot_properties (
           auction_lot_id, property_id, source_record_id, match_method, confidence, verification_status, resolved_at, active
         ) values ($1, $2, $3, $4, 1, 'derived', now(), true)
         on conflict (auction_lot_id, property_id) do update set
           source_record_id = excluded.source_record_id,
           match_method = excluded.match_method,
           confidence = excluded.confidence,
           verification_status = excluded.verification_status,
           resolved_at = excluded.resolved_at,
           active = true,
           invalidated_at = null`,
        [lot.id, acceptedPropertyId, sourceRecord.id, input.resolution.method],
      );
      await persistPropertyAssertions(transaction, input, sourceRecord.id);
      await refreshCanonicalPropertySearch(transaction, acceptedPropertyId);
    }

    const search = buildAuctionLotSearchDocument(bundle, input.resolution);
    const searchableAttributes = await publicAttributesForEntity(
      transaction,
      "auction_lot",
      lot.id,
      sourceRecord.id,
    );
    const attributeSearchText = searchableAttributeText(searchableAttributes)
      .join(" | ")
      .toLowerCase();
    const searchText = attributeSearchText
      ? `${search.searchText} | ${attributeSearchText}`
      : search.searchText;
    await transaction.query(
      `insert into property_api.auction_lot_search (
         auction_lot_id, source_definition_id, source_record_id, property_id, resolution_status,
         jurisdiction_id, state_code, county_fips, county_name, sale_mechanism, asset_class,
         lifecycle_state, event_label, source_lot_key, published_identifier_text,
         published_address_text, published_owner_text, legal_description, total_due,
         minimum_bid, winning_bid, starts_at, ends_at, source_document_id,
         source_document_title, source_url, searchable_attributes, search_text, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28, now())
       on conflict (auction_lot_id) do update set
         source_definition_id = excluded.source_definition_id,
         source_record_id = excluded.source_record_id,
         property_id = excluded.property_id,
         resolution_status = excluded.resolution_status,
         jurisdiction_id = excluded.jurisdiction_id,
         state_code = excluded.state_code,
         county_fips = excluded.county_fips,
         county_name = excluded.county_name,
         sale_mechanism = excluded.sale_mechanism,
         asset_class = excluded.asset_class,
         lifecycle_state = excluded.lifecycle_state,
         event_label = excluded.event_label,
         source_lot_key = excluded.source_lot_key,
         published_identifier_text = excluded.published_identifier_text,
         published_address_text = excluded.published_address_text,
         published_owner_text = excluded.published_owner_text,
         legal_description = excluded.legal_description,
         total_due = excluded.total_due,
         minimum_bid = excluded.minimum_bid,
         winning_bid = excluded.winning_bid,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         source_document_id = excluded.source_document_id,
         source_document_title = excluded.source_document_title,
         source_url = excluded.source_url,
         searchable_attributes = excluded.searchable_attributes,
         search_text = excluded.search_text,
         updated_at = excluded.updated_at`,
      [
        lot.id,
        input.sourceDefinitionId,
        sourceRecord.id,
        search.propertyId,
        search.resolutionStatus,
        input.jurisdictionId,
        search.stateCode,
        search.countyFips,
        search.countyName,
        search.saleMechanism,
        bundle.auction.assetClass,
        search.lifecycleState,
        search.eventLabel,
        search.sourceLotKey,
        search.publishedIdentifierText,
        search.publishedAddressText,
        search.publishedOwnerText,
        search.legalDescription,
        search.totalDue,
        search.minimumBid,
        search.winningBid,
        search.startsAt,
        search.endsAt,
        document.id,
        bundle.sourceRecord.documentTitle,
        search.sourceUrl,
        json(searchableAttributes),
        searchText,
      ],
    );

    return {
      sourceDocumentId: document.id,
      sourceRecordId: sourceRecord.id,
      sourceRecordVersionCreated,
      sourceRecordOccurrenceId: occurrence.id,
      auctionEventId: event.id,
      auctionLotId: lot.id,
      resolutionCaseId: resolutionCase.id,
      propertyId: acceptedPropertyId,
    };
  });
}

// "Non-auction records stay searchable unresolved, resolve safely, withdraw
// only on complete absence": this function always writes the
// property_record_listings row and the property_record_search projection
// row REGARDLESS of resolution status (an unresolved record stays visible
// with property_id null, never dropped), only ever links a property_id when
// the resolver (or resolveOrBootstrapAuthoritativeProperty above) actually
// resolved one, and never sets withdrawn_at itself -- withdrawal only ever
// happens in nationwide-postgres-run-store.ts's finalizeSnapshotIngestionRun,
// and only for a source_record_key absent from a run whose coverage was
// complete (see that module's header).
export async function persistNormalizedPropertyRecordBundle(
  database: PostgresTransactionHost,
  input: PersistNormalizedPropertyRecordBundleInput,
): Promise<PersistedNormalizedPropertyRecordBundle> {
  assertUuid(input.sourceDefinitionId, "sourceDefinitionId");
  assertUuid(input.jurisdictionId, "jurisdictionId");
  assertUuid(input.ingestionRunId, "ingestionRunId");
  requireText(input.resolutionAlgorithmVersion, "resolutionAlgorithmVersion");
  if (input.resolution.status === "resolved" && !input.resolution.propertyId) {
    throw new Error("resolved input must include propertyId");
  }

  return database.transaction(async (transaction) => {
    const evidence = await persistSourceEvidence(transaction, input, {
      recordType: input.bundle.listing.recordKind,
      publishedOwnerText: input.bundle.listing.publishedOwnerText,
    });
    const effectiveResolution = await resolveOrBootstrapAuthoritativeProperty(
      transaction,
      input,
      evidence.sourceRecord.id,
      evidence.sourceContract,
    );
    const effectiveInput = { ...input, resolution: effectiveResolution };
    const acceptedPropertyId =
      effectiveResolution.status === "resolved" ? effectiveResolution.propertyId : null;

    await one(
      transaction,
      `update property_ingest.source_record_occurrences
       set resolution_status = $2, resolution_algorithm_version = $3, resolved_property_id = $4
       where id = $1 returning id`,
      [
        evidence.occurrence.id,
        effectiveResolution.status,
        input.resolutionAlgorithmVersion,
        acceptedPropertyId,
      ],
      "property-record occurrence resolution update failed",
    );

    const resolutionCase = await one<{ id: string }>(
      transaction,
      `insert into property_ingest.resolution_cases (source_record_id, algorithm_version, status, resolution_method, accepted_property_id)
       values ($1, $2, $3, $4, $5)
       on conflict (source_record_id, algorithm_version) do update set
         status = excluded.status, resolution_method = excluded.resolution_method, accepted_property_id = excluded.accepted_property_id, updated_at = now()
       returning id`,
      [
        evidence.sourceRecord.id,
        input.resolutionAlgorithmVersion,
        resolutionCaseStatus(effectiveResolution),
        effectiveResolution.method,
        acceptedPropertyId,
      ],
      "property-record resolution case upsert failed",
    );

    if (effectiveResolution.method) {
      for (const candidatePropertyId of effectiveResolution.candidatePropertyIds) {
        await transaction.query(
          `insert into property_ingest.resolution_candidates (resolution_case_id, property_id, match_method, matched_values, confidence, decision)
           values ($1, $2, $3, $4::jsonb, 1, $5)
           on conflict (resolution_case_id, property_id, match_method) do update set
             matched_values = excluded.matched_values, confidence = excluded.confidence, decision = excluded.decision`,
          [
            resolutionCase.id,
            candidatePropertyId,
            effectiveResolution.method,
            json({
              identifiers: effectiveResolution.matchedIdentifiers.filter(
                (match) => match.propertyId === candidatePropertyId,
              ),
              evidenceReferences: effectiveResolution.evidenceReferences,
              reason: effectiveResolution.reason,
            }),
            acceptedPropertyId === candidatePropertyId ? "accepted" : "pending",
          ],
        );
      }
    }

    if (acceptedPropertyId) {
      await persistPropertyAssertions(transaction, effectiveInput, evidence.sourceRecord.id);
      await refreshCanonicalPropertySearch(transaction, acceptedPropertyId);
    }
    await persistPropertyRecordListing(
      transaction,
      effectiveInput,
      evidence.sourceRecord.id,
      acceptedPropertyId,
    );

    const search = buildPropertyRecordSearchDocument(input.bundle, effectiveResolution);
    await transaction.query(
      `insert into property_api.property_record_search (
         source_definition_id, source_record_key, source_record_id, property_id, resolution_status,
         jurisdiction_id, state_code, county_fips, county_name, record_kind, lifecycle_state,
         published_identifier_text, published_address_text, published_owner_text, legal_description,
         published_amount, published_amount_type, published_amount_label, property_type, land_use,
         building_square_feet, land_square_feet, market_value, assessed_value, latitude, longitude,
         source_document_id, source_document_title, source_url, withdrawn_at, searchable_attributes,
         search_text, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, null, '{}'::jsonb, $30, now())
       on conflict (source_definition_id, source_record_key) do update set
         source_record_id = excluded.source_record_id,
         property_id = excluded.property_id,
         resolution_status = excluded.resolution_status,
         jurisdiction_id = excluded.jurisdiction_id,
         state_code = excluded.state_code,
         county_fips = excluded.county_fips,
         county_name = excluded.county_name,
         record_kind = excluded.record_kind,
         lifecycle_state = excluded.lifecycle_state,
         published_identifier_text = excluded.published_identifier_text,
         published_address_text = excluded.published_address_text,
         published_owner_text = excluded.published_owner_text,
         legal_description = excluded.legal_description,
         published_amount = excluded.published_amount,
         published_amount_type = excluded.published_amount_type,
         published_amount_label = excluded.published_amount_label,
         property_type = excluded.property_type,
         land_use = excluded.land_use,
         building_square_feet = excluded.building_square_feet,
         land_square_feet = excluded.land_square_feet,
         market_value = excluded.market_value,
         assessed_value = excluded.assessed_value,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         source_document_id = excluded.source_document_id,
         source_document_title = excluded.source_document_title,
         source_url = excluded.source_url,
         withdrawn_at = null,
         search_text = excluded.search_text,
         updated_at = excluded.updated_at`,
      [
        input.sourceDefinitionId,
        search.sourceRecordKey,
        evidence.sourceRecord.id,
        search.propertyId,
        search.resolutionStatus,
        input.jurisdictionId,
        search.stateCode,
        search.countyFips,
        search.countyName,
        search.recordKind,
        search.lifecycleState,
        search.publishedIdentifierText,
        search.publishedAddressText,
        search.publishedOwnerText,
        search.legalDescription,
        search.publishedAmount,
        search.publishedAmountType,
        search.publishedAmountLabel,
        search.propertyType,
        search.landUse,
        search.buildingSquareFeet,
        search.landSquareFeet,
        search.marketValue,
        search.assessedValue,
        search.latitude,
        search.longitude,
        evidence.document.id,
        input.bundle.sourceRecord.documentTitle,
        search.sourceUrl,
        search.searchText,
      ],
    );

    return {
      sourceDocumentId: evidence.document.id,
      sourceRecordId: evidence.sourceRecord.id,
      sourceRecordVersionCreated: evidence.sourceRecordVersionCreated,
      sourceRecordOccurrenceId: evidence.occurrence.id,
      resolutionCaseId: resolutionCase.id,
      propertyId: acceptedPropertyId,
    };
  });
}
