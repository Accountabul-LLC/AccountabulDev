// Ported from property-intelligence-app's app/lib/nationwide-source-manifest.ts --
// the database-writing half that nationwide-source-manifest.ts deliberately
// leaves out. That module stays pure (validation, run-key building) so it can
// be tested without a database; this one takes an injected
// `PostgresTransactionHost` with no default, the same pattern
// nationwide-postgres-writer.ts uses, and performs the writes:
//
//   registerNationwideJurisdiction      -> property_core.jurisdictions
//   registerNationwideSourceManifest    -> property_ingest.source_definitions
//
// Without this, nothing in the repo can produce a source_definitions row, so
// the live ingestion entrypoint has no sourceDefinitionId to dispatch against.
//
// Two invariants carried over from the source, both load-bearing:
//
//   * Canonical geography is resolved, never duplicated. A state/county is
//     looked up by its FIPS identity first and only inserted when absent; more
//     than one row sharing a FIPS code is a hard error rather than a silent
//     pick, and a local jurisdiction already registered under a different
//     parent is rejected instead of being re-parented.
//   * A source contract is immutable at a given contractVersion. The stored
//     mapping_schema is fingerprinted and compared against the incoming
//     payload; any drift throws and demands a new contractVersion rather than
//     rewriting the contract historical runs were recorded under. Only the
//     operational fields (schedule, owner, limitations, active) are updated
//     in place.
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  validateNationwideJurisdictionManifest,
  validateNationwideSourceManifest,
  type NationwideJurisdictionManifest,
  type NationwideSourceManifest,
} from "./nationwide-source-manifest.ts";

export type RegisteredNationwideSource = {
  sourceDefinitionId: string;
  jurisdictionId: string;
  stateJurisdictionId: string;
  manifestFingerprint: string;
  replayed: boolean;
};

function contractPayload(manifest: NationwideSourceManifest) {
  const localIdentity =
    manifest.jurisdiction.jurisdictionType === "state" ||
    manifest.jurisdiction.jurisdictionType === "county_equivalent"
      ? {}
      : {
          name: manifest.jurisdiction.name,
          countyName: manifest.jurisdiction.countyName ?? null,
          placeFips: manifest.jurisdiction.placeFips ?? null,
          gnisId: manifest.jurisdiction.gnisId ?? null,
        };
  return {
    sourceKey: manifest.sourceKey,
    contractVersion: manifest.contractVersion,
    mappingVersion: manifest.mappingVersion,
    jurisdiction: {
      jurisdictionType: manifest.jurisdiction.jurisdictionType,
      stateCode: manifest.jurisdiction.stateCode,
      stateFips: manifest.jurisdiction.stateFips,
      countyFips: manifest.jurisdiction.countyFips,
      ...localIdentity,
    },
    publisherName: manifest.publisherName,
    publishingAgency: manifest.publishingAgency,
    sourceFamily: manifest.sourceFamily,
    assetClass: manifest.assetClass,
    landingPageUrl: manifest.landingPageUrl,
    retrievalMethod: manifest.retrievalMethod,
    recordLane: manifest.recordLane,
    withdrawalMode: manifest.withdrawalMode,
    batchSize: manifest.batchSize,
    serviceMaximum: manifest.serviceMaximum,
    leaseSeconds: manifest.leaseSeconds,
    parserName: manifest.parserName,
    parserVersion: manifest.parserVersion,
    sourceFormat: manifest.sourceFormat,
    authoritativeIdentifierTypes: manifest.authoritativeIdentifierTypes,
    identityEstablishmentMode: manifest.identityEstablishmentMode,
  };
}

async function one<Row extends Record<string, unknown>>(
  transaction: PostgresTransaction,
  sql: string,
  params: unknown[],
  message: string,
): Promise<Row> {
  const result = await transaction.query<Row>(sql, params);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined) throw new Error(message);
  return row;
}

function databaseJson(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function ensureCountyJurisdiction(
  transaction: PostgresTransaction,
  jurisdiction: NationwideJurisdictionManifest,
  stateJurisdictionId: string,
) {
  const countyFips = jurisdiction.countyFips;
  if (!countyFips) throw new Error("county jurisdiction registration requires countyFips");
  const knownCounties = await transaction.query<{ id: string }>(
    `
    select id from property_core.jurisdictions
    where jurisdiction_type = 'county_equivalent' and county_fips = $1 and state_code = $2
    order by created_at, id
  `,
    [countyFips, jurisdiction.stateCode],
  );
  if (knownCounties.rows.length > 1) {
    throw new Error("multiple canonical county jurisdictions share the same FIPS code");
  }
  if (knownCounties.rows.length === 0) {
    const countyIsSourceJurisdiction = jurisdiction.jurisdictionType === "county_equivalent";
    await transaction.query(
      `
      insert into property_core.jurisdictions (
        parent_id, jurisdiction_type, name, legal_name, state_code, state_fips,
        county_fips, timezone
      ) values ($1, 'county_equivalent', $2, $3, $4, $5, $6, $7)
      on conflict do nothing
    `,
      [
        stateJurisdictionId,
        countyIsSourceJurisdiction ? jurisdiction.name : jurisdiction.countyName,
        countyIsSourceJurisdiction ? jurisdiction.legalName : jurisdiction.countyLegalName,
        jurisdiction.stateCode,
        jurisdiction.stateFips,
        countyFips,
        countyIsSourceJurisdiction ? jurisdiction.timezone : null,
      ],
    );
  }
  return one<{ id: string }>(
    transaction,
    `
    select id from property_core.jurisdictions
    where jurisdiction_type = 'county_equivalent' and county_fips = $1 and state_code = $2
    order by created_at, id
    limit 1
  `,
    [countyFips, jurisdiction.stateCode],
    "county jurisdiction registration failed",
  );
}

async function ensureLocalJurisdiction(
  transaction: PostgresTransaction,
  jurisdiction: NationwideJurisdictionManifest,
  parentJurisdictionId: string,
) {
  const identitySql =
    jurisdiction.jurisdictionType === "municipality"
      ? "jurisdiction_type = $1 and state_fips = $2 and place_fips = $3"
      : jurisdiction.gnisId
        ? "jurisdiction_type = $1 and gnis_id = $2"
        : `jurisdiction_type = $1 and state_fips = $2
         and coalesce(county_fips, '') = coalesce($3, '') and lower(name) = lower($4)`;
  const identityParams =
    jurisdiction.jurisdictionType === "municipality"
      ? [jurisdiction.jurisdictionType, jurisdiction.stateFips, jurisdiction.placeFips]
      : jurisdiction.gnisId
        ? [jurisdiction.jurisdictionType, jurisdiction.gnisId]
        : [
            jurisdiction.jurisdictionType,
            jurisdiction.stateFips,
            jurisdiction.countyFips,
            jurisdiction.name,
          ];
  const known = await transaction.query<{ id: string; parent_id: string | null }>(
    `
    select id, parent_id from property_core.jurisdictions
    where ${identitySql}
    order by created_at, id
  `,
    identityParams,
  );
  if (known.rows.length > 1) {
    throw new Error(
      `multiple canonical ${jurisdiction.jurisdictionType} jurisdictions share the same identity`,
    );
  }
  const knownRow = known.rows[0];
  if (knownRow !== undefined && knownRow.parent_id !== parentJurisdictionId) {
    throw new Error(
      `${jurisdiction.jurisdictionType} jurisdiction identity is already registered under another parent`,
    );
  }
  if (known.rows.length === 0) {
    await transaction.query(
      `
      insert into property_core.jurisdictions (
        parent_id, jurisdiction_type, name, legal_name, state_code, state_fips,
        county_fips, place_fips, gnis_id, timezone
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict do nothing
    `,
      [
        parentJurisdictionId,
        jurisdiction.jurisdictionType,
        jurisdiction.name,
        jurisdiction.legalName,
        jurisdiction.stateCode,
        jurisdiction.stateFips,
        jurisdiction.countyFips,
        jurisdiction.placeFips ?? null,
        jurisdiction.gnisId ?? null,
        jurisdiction.timezone,
      ],
    );
  }
  return one<{ id: string }>(
    transaction,
    `
    select id from property_core.jurisdictions
    where ${identitySql}
    order by created_at, id
    limit 1
  `,
    identityParams,
    `${jurisdiction.jurisdictionType} jurisdiction registration failed`,
  );
}

async function ensureNationwideJurisdiction(
  transaction: PostgresTransaction,
  jurisdiction: NationwideJurisdictionManifest,
) {
  const knownStates = await transaction.query<{ id: string }>(
    `
    select id from property_core.jurisdictions
    where jurisdiction_type = 'state' and state_fips = $1 and state_code = $2
    order by created_at, id
  `,
    [jurisdiction.stateFips, jurisdiction.stateCode],
  );
  if (knownStates.rows.length > 1) {
    throw new Error("multiple canonical state jurisdictions share the same FIPS code");
  }
  if (knownStates.rows.length === 0) {
    await transaction.query(
      `
      insert into property_core.jurisdictions (
        jurisdiction_type, name, legal_name, state_code, state_fips, timezone
      ) values ('state', $1, $2, $3, $4, $5)
      on conflict do nothing
    `,
      [
        jurisdiction.stateName,
        jurisdiction.stateLegalName,
        jurisdiction.stateCode,
        jurisdiction.stateFips,
        jurisdiction.jurisdictionType === "state" ? jurisdiction.timezone : null,
      ],
    );
  }
  const state = await one<{ id: string }>(
    transaction,
    `
    select id from property_core.jurisdictions
    where jurisdiction_type = 'state' and state_fips = $1 and state_code = $2
    order by created_at, id
    limit 1
  `,
    [jurisdiction.stateFips, jurisdiction.stateCode],
    "state jurisdiction registration failed",
  );

  let jurisdictionId = state.id;
  if (jurisdiction.jurisdictionType === "county_equivalent") {
    jurisdictionId = (await ensureCountyJurisdiction(transaction, jurisdiction, state.id)).id;
  } else if (jurisdiction.jurisdictionType !== "state") {
    const parentId = jurisdiction.countyFips
      ? (await ensureCountyJurisdiction(transaction, jurisdiction, state.id)).id
      : state.id;
    jurisdictionId = (await ensureLocalJurisdiction(transaction, jurisdiction, parentId)).id;
  }
  return { jurisdictionId, stateJurisdictionId: state.id };
}

export async function registerNationwideJurisdiction(
  database: PostgresTransactionHost,
  inputJurisdiction: NationwideJurisdictionManifest,
) {
  return database.transaction((transaction) =>
    registerNationwideJurisdictionInTransaction(transaction, inputJurisdiction),
  );
}

export async function registerNationwideJurisdictionInTransaction(
  transaction: PostgresTransaction,
  inputJurisdiction: NationwideJurisdictionManifest,
) {
  return ensureNationwideJurisdiction(
    transaction,
    validateNationwideJurisdictionManifest(inputJurisdiction),
  );
}

export async function registerNationwideSourceManifest(
  database: PostgresTransactionHost,
  inputManifest: NationwideSourceManifest,
): Promise<RegisteredNationwideSource> {
  const manifest = validateNationwideSourceManifest(inputManifest);
  const payload = contractPayload(manifest);
  const manifestFingerprint = await stableSha256({ manifest, payload });
  return database.transaction(async (transaction) => {
    const { jurisdictionId, stateJurisdictionId } = await ensureNationwideJurisdiction(
      transaction,
      manifest.jurisdiction,
    );

    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.source_definitions (
        jurisdiction_id, source_key, contract_version, publisher_name,
        publishing_agency, source_family, asset_class, landing_page_url,
        retrieval_method, source_format, parser_name, parser_version,
        mapping_schema, authoritative_identifier_types, identity_establishment_mode,
        expected_update_frequency, schedule_policy, scheduler_owner, known_limitations, active
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13::jsonb, $14::text[], $15, $16, $17::jsonb, $18, $19, $20
      )
      on conflict (jurisdiction_id, source_key, contract_version) do nothing
      returning id
    `,
      [
        jurisdictionId,
        manifest.sourceKey,
        manifest.contractVersion,
        manifest.publisherName,
        manifest.publishingAgency,
        manifest.sourceFamily,
        manifest.assetClass,
        manifest.landingPageUrl,
        manifest.retrievalMethod,
        manifest.sourceFormat,
        manifest.parserName,
        manifest.parserVersion,
        JSON.stringify(payload),
        manifest.authoritativeIdentifierTypes,
        manifest.identityEstablishmentMode,
        manifest.expectedUpdateFrequency,
        JSON.stringify(manifest.schedulePolicy),
        manifest.schedulerOwner,
        manifest.knownLimitations,
        manifest.active,
      ],
    );
    const insertedRow = inserted.rows[0];
    const existing: { id: string; mapping_schema: unknown } =
      insertedRow !== undefined
        ? { id: insertedRow.id, mapping_schema: payload }
        : await one<{ id: string; mapping_schema: unknown }>(
            transaction,
            `
          select id, mapping_schema
          from property_ingest.source_definitions
          where jurisdiction_id = $1 and source_key = $2 and contract_version = $3
        `,
            [jurisdictionId, manifest.sourceKey, manifest.contractVersion],
            "source definition registration failed",
          );
    const storedFingerprint = await stableSha256(databaseJson(existing.mapping_schema));
    const payloadFingerprint = await stableSha256(payload);
    if (storedFingerprint !== payloadFingerprint) {
      throw new Error("source manifest contract drift requires a new contractVersion");
    }
    await transaction.query(
      `
      update property_ingest.source_definitions
      set expected_update_frequency = $2,
          schedule_policy = $3::jsonb,
          scheduler_owner = $4,
          known_limitations = $5,
          active = $6,
          updated_at = now()
      where id = $1
    `,
      [
        existing.id,
        manifest.expectedUpdateFrequency,
        JSON.stringify(manifest.schedulePolicy),
        manifest.schedulerOwner,
        manifest.knownLimitations,
        manifest.active,
      ],
    );
    return {
      sourceDefinitionId: existing.id,
      jurisdictionId,
      stateJurisdictionId,
      manifestFingerprint,
      replayed: inserted.rows.length === 0,
    };
  });
}
