// Closes a gap the Slice 4 and Slice 5 commits (00f6796, b64776c) explicitly
// flagged as remaining: the source's "public attribute visibility" review
// subsystem. Ported near-verbatim from property-intelligence-app's
// app/lib/nationwide-attribute-visibility.ts against the tables added by
// supabase/migrations/20260924180000_property_intelligence_attribute_governance.sql
// (property_core.attribute_definitions / entity_attributes,
// property_ingest.attribute_visibility_decisions).
//
// Invariant preserved exactly, never loosened: an extension attribute is
// PRIVATE BY DEFAULT. It has no effect on any property_api.*.searchable_attributes
// projection until this module's reviewNationwideAttributeVisibility records
// an ACTIVE 'public_search' decision for its attribute_definitions row --
// nationwide-attribute-extensions.ts's publicAttributesForEntity only ever
// selects rows that join an active, 'public_search' visibility decision (see
// that module). No default database connection exists anywhere in this repo
// (PostgresTransactionHost has no default implementation) -- this remains
// structurally incapable of touching the live Supabase project.
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import { UUID_V1_TO_V5 as UUID } from "../validation/patterns.ts";

export const NATIONWIDE_ATTRIBUTE_VISIBILITIES = ["private", "public_search"] as const;
export type NationwideAttributeVisibility = (typeof NATIONWIDE_ATTRIBUTE_VISIBILITIES)[number];

export type ReviewNationwideAttributeVisibilityInput = {
  attributeDefinitionId: string;
  searchVisibility: NationwideAttributeVisibility;
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type ReviewedNationwideAttributeVisibility = {
  decisionId: string;
  attributeDefinitionId: string;
  decisionVersion: number;
  supersedesDecisionId: string | null;
  affectedEntityCount: number;
  reconciledProjectionCount: number;
  requiresReingestion: boolean;
  replayed: boolean;
};

type StoredDecision = {
  id: string;
  decision_version: number;
  search_visibility: NationwideAttributeVisibility;
  rationale: string;
  reviewed_by: string;
  reviewed_at: string | Date;
  active: boolean;
};

function uuid(value: string, field: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${field} must be a UUID`);
  return value;
}

function text(value: string, field: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  if (normalized.length > maximum) throw new Error(`${field} cannot exceed ${maximum} characters`);
  return normalized;
}

function canonicalIso(value: string, field: string) {
  if (typeof value !== "string") throw new Error(`${field} must be a canonical UTC ISO date-time`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function normalizedInput(input: ReviewNationwideAttributeVisibilityInput) {
  if (!NATIONWIDE_ATTRIBUTE_VISIBILITIES.includes(input.searchVisibility)) {
    throw new Error("searchVisibility is not supported");
  }
  return {
    attributeDefinitionId: uuid(input.attributeDefinitionId, "attributeDefinitionId"),
    searchVisibility: input.searchVisibility,
    rationale: text(input.rationale, "rationale", 2_000),
    reviewedBy: uuid(input.reviewedBy, "reviewedBy"),
    reviewedAt: canonicalIso(input.reviewedAt, "reviewedAt"),
  };
}

function sameDecision(stored: StoredDecision, input: ReturnType<typeof normalizedInput>) {
  return (
    stored.search_visibility === input.searchVisibility &&
    stored.rationale === input.rationale &&
    stored.reviewed_by === input.reviewedBy &&
    new Date(stored.reviewed_at).valueOf() === new Date(input.reviewedAt).valueOf()
  );
}

const projectedAttributeSearchText = (jsonExpression: string) => `
  coalesce((
    select string_agg(
      concat_ws(' | ', item.key, item.value->>'label', item.value->>'meaning',
        item.value->>'value', item.value->>'unit'),
      ' | ' order by item.key
    )
    from jsonb_each(${jsonExpression}) item
  ), '')
`;

async function pendingProjectionCount(
  transaction: PostgresTransaction,
  attributeDefinitionId: string,
) {
  const result = await transaction.query<{ count: number }>(
    `
    with definition as (
      select id, attribute_key, data_type, meaning, unit
      from property_core.attribute_definitions
      where id = $1
    ),
    property_expected as (
      select distinct on (attribute.entity_id)
        attribute.entity_id, definition.attribute_key, definition.meaning, definition.unit,
        case definition.data_type
          when 'text' then to_jsonb(attribute.value_text)
          when 'numeric' then to_jsonb(attribute.value_numeric)
          when 'boolean' then to_jsonb(attribute.value_boolean)
          when 'date' then to_jsonb(attribute.value_date::text)
          else null::jsonb
        end as expected_value
      from property_core.entity_attributes attribute
      join definition on definition.id = attribute.attribute_definition_id
      where attribute.entity_type = 'property'
        and attribute.verification_status in ('published', 'accountabul_verified')
      order by attribute.entity_id, attribute.observed_at desc, attribute.created_at desc
    ),
    auction_lot_expected as (
      select distinct on (attribute.entity_id, attribute.source_record_id)
        attribute.entity_id, attribute.source_record_id,
        definition.attribute_key, definition.meaning, definition.unit,
        case definition.data_type
          when 'text' then to_jsonb(attribute.value_text)
          when 'numeric' then to_jsonb(attribute.value_numeric)
          when 'boolean' then to_jsonb(attribute.value_boolean)
          when 'date' then to_jsonb(attribute.value_date::text)
          else null::jsonb
        end as expected_value
      from property_core.entity_attributes attribute
      join definition on definition.id = attribute.attribute_definition_id
      where attribute.entity_type = 'auction_lot'
        and attribute.source_record_id is not null
        and attribute.verification_status in ('published', 'accountabul_verified')
      order by attribute.entity_id, attribute.source_record_id,
               attribute.observed_at desc, attribute.created_at desc
    ),
    auction_event_expected as (
      select distinct on (attribute.entity_id, attribute.source_record_id)
        attribute.entity_id, attribute.source_record_id,
        definition.attribute_key, definition.meaning, definition.unit,
        case definition.data_type
          when 'text' then to_jsonb(attribute.value_text)
          when 'numeric' then to_jsonb(attribute.value_numeric)
          when 'boolean' then to_jsonb(attribute.value_boolean)
          when 'date' then to_jsonb(attribute.value_date::text)
          else null::jsonb
        end as expected_value
      from property_core.entity_attributes attribute
      join definition on definition.id = attribute.attribute_definition_id
      where attribute.entity_type = 'auction_event'
        and attribute.source_record_id is not null
        and attribute.verification_status in ('published', 'accountabul_verified')
      order by attribute.entity_id, attribute.source_record_id,
               attribute.observed_at desc, attribute.created_at desc
    ),
    pending as (
      select expected.entity_id
      from property_expected expected
      left join property_api.property_search projection
        on projection.property_id = expected.entity_id
      where coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key), 'missing') <> 'object'
         or coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key->'label'), 'missing') <> 'string'
         or projection.searchable_attributes->expected.attribute_key->>'meaning' is distinct from expected.meaning
         or projection.searchable_attributes->expected.attribute_key->>'unit' is distinct from expected.unit
         or projection.searchable_attributes->expected.attribute_key->'value' is distinct from expected.expected_value
      union all
      select expected.entity_id
      from auction_lot_expected expected
      join property_core.auction_lots lot
        on lot.id = expected.entity_id and lot.source_record_id = expected.source_record_id
      left join property_api.auction_lot_search projection
        on projection.auction_lot_id = lot.id and projection.source_record_id = expected.source_record_id
      where coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key), 'missing') <> 'object'
         or coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key->'label'), 'missing') <> 'string'
         or projection.searchable_attributes->expected.attribute_key->>'meaning' is distinct from expected.meaning
         or projection.searchable_attributes->expected.attribute_key->>'unit' is distinct from expected.unit
         or projection.searchable_attributes->expected.attribute_key->'value' is distinct from expected.expected_value
      union all
      select lot.id
      from auction_event_expected expected
      join property_core.auction_lots lot
        on lot.auction_event_id = expected.entity_id and lot.source_record_id = expected.source_record_id
      left join property_api.auction_lot_search projection
        on projection.auction_lot_id = lot.id and projection.source_record_id = expected.source_record_id
      where coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key), 'missing') <> 'object'
         or coalesce(jsonb_typeof(projection.searchable_attributes->expected.attribute_key->'label'), 'missing') <> 'string'
         or projection.searchable_attributes->expected.attribute_key->>'meaning' is distinct from expected.meaning
         or projection.searchable_attributes->expected.attribute_key->>'unit' is distinct from expected.unit
         or projection.searchable_attributes->expected.attribute_key->'value' is distinct from expected.expected_value
    )
    select count(*)::int as count from pending
  `,
    [attributeDefinitionId],
  );
  return result.rows[0]?.count ?? 0;
}

async function revokeExistingProjection(
  transaction: PostgresTransaction,
  attributeDefinitionId: string,
  attributeKey: string,
) {
  const propertyAttributes = `property_api.property_search.searchable_attributes - $2`;
  const propertyResult = await transaction.query<{ property_id: string }>(
    `
    update property_api.property_search
    set searchable_attributes = ${propertyAttributes},
        search_text = lower(concat_ws(' | ',
          nullif(state_code, ''), nullif(county_name, ''), nullif(county_fips, ''),
          nullif(primary_identifier_type, ''), nullif(primary_identifier_value, ''),
          nullif(situs_address, ''), nullif(city, ''), nullif(postal_code, ''),
          nullif(property_type, ''), nullif(land_use, ''), nullif(current_inventory_status, ''),
          ${projectedAttributeSearchText(propertyAttributes)}
        )),
        updated_at = now()
    where exists (
      select 1
      from property_core.entity_attributes attribute
      where attribute.attribute_definition_id = $1
        and attribute.entity_type = 'property'
        and attribute.entity_id = property_api.property_search.property_id
    )
    returning property_id::text
  `,
    [attributeDefinitionId, attributeKey],
  );

  const auctionAttributes = `property_api.auction_lot_search.searchable_attributes - $2`;
  const auctionResult = await transaction.query<{ auction_lot_id: string }>(
    `
    update property_api.auction_lot_search
    set searchable_attributes = ${auctionAttributes},
        search_text = lower(concat_ws(' | ',
          nullif(state_code, ''), nullif(county_name, ''), nullif(county_fips, ''),
          nullif(event_label, ''), nullif(sale_mechanism, ''), nullif(lifecycle_state, ''),
          nullif(published_identifier_text, ''), nullif(source_lot_key, ''),
          nullif(published_address_text, ''), nullif(published_owner_text, ''),
          nullif(legal_description, ''),
          ${projectedAttributeSearchText(auctionAttributes)}
        )),
        updated_at = now()
    where exists (
      select 1
      from property_core.entity_attributes attribute
      where attribute.attribute_definition_id = $1
        and (
          (attribute.entity_type = 'auction_lot'
            and attribute.entity_id = property_api.auction_lot_search.auction_lot_id)
          or
          (attribute.entity_type = 'auction_event' and exists (
            select 1
            from property_core.auction_lots lot
            where lot.id = property_api.auction_lot_search.auction_lot_id
              and lot.auction_event_id = attribute.entity_id
          ))
        )
    )
    returning auction_lot_id::text
  `,
    [attributeDefinitionId, attributeKey],
  );
  return propertyResult.rows.length + auctionResult.rows.length;
}

export async function reviewNationwideAttributeVisibility(
  database: PostgresTransactionHost,
  untrustedInput: ReviewNationwideAttributeVisibilityInput,
): Promise<ReviewedNationwideAttributeVisibility> {
  const input = normalizedInput(untrustedInput);
  return database.transaction(async (transaction) => {
    const definition = await transaction.query<{
      id: string;
      attribute_key: string;
      data_type: string;
      search_visibility: NationwideAttributeVisibility;
      active: boolean;
    }>(
      `
      select id::text, attribute_key, data_type, search_visibility, active
      from property_core.attribute_definitions
      where id = $1
      for update
    `,
      [input.attributeDefinitionId],
    );
    if (definition.rows.length !== 1) {
      throw new Error("attributeDefinitionId does not identify a registered extension definition");
    }
    const attribute = definition.rows[0];
    if (attribute === undefined) throw new Error("attribute definition row is missing");
    if (
      input.searchVisibility === "public_search" &&
      (!attribute.active || attribute.data_type === "json")
    ) {
      throw new Error("public_search requires an active scalar extension definition");
    }

    const history = await transaction.query<StoredDecision>(
      `
      select id::text, decision_version, search_visibility, rationale,
             reviewed_by::text, reviewed_at, active
      from property_ingest.attribute_visibility_decisions
      where attribute_definition_id = $1
      order by decision_version desc
      for update
    `,
      [input.attributeDefinitionId],
    );
    const latest = history.rows[0] ?? null;
    const active = history.rows.find((decision) => decision.active) ?? null;
    if (history.rows.filter((decision) => decision.active).length > 1) {
      throw new Error("attribute definition has more than one active visibility decision");
    }
    if (active && latest && active.id !== latest.id) {
      throw new Error("active attribute visibility decision is not the latest review version");
    }
    if (active && sameDecision(active, input)) {
      if (attribute.search_visibility !== input.searchVisibility) {
        throw new Error("attribute visibility drifted from its active review decision");
      }
      const affected = await transaction.query<{ count: number }>(
        `
        select count(distinct (entity_type, entity_id))::int as count
        from property_core.entity_attributes
        where attribute_definition_id = $1
      `,
        [input.attributeDefinitionId],
      );
      const affectedEntityCount = affected.rows[0]?.count ?? 0;
      const pendingProjections =
        input.searchVisibility === "public_search"
          ? await pendingProjectionCount(transaction, input.attributeDefinitionId)
          : 0;
      return {
        decisionId: active.id,
        attributeDefinitionId: input.attributeDefinitionId,
        decisionVersion: active.decision_version,
        supersedesDecisionId: history.rows[1]?.id ?? null,
        affectedEntityCount,
        reconciledProjectionCount: 0,
        requiresReingestion: pendingProjections > 0,
        replayed: true,
      };
    }
    if (latest && new Date(input.reviewedAt).valueOf() <= new Date(latest.reviewed_at).valueOf()) {
      throw new Error("reviewedAt must be later than the latest visibility decision");
    }

    if (active) {
      const superseded = await transaction.query<{ id: string }>(
        `
        update property_ingest.attribute_visibility_decisions
        set active = false, superseded_at = $2
        where id = $1 and active
        returning id::text
      `,
        [active.id, input.reviewedAt],
      );
      if (superseded.rows.length !== 1)
        throw new Error("active visibility decision changed during review");
    }

    const decisionVersion = (latest?.decision_version ?? 0) + 1;
    const supersedesDecisionId = latest?.id ?? null;
    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.attribute_visibility_decisions (
        attribute_definition_id, decision_version, search_visibility,
        rationale, reviewed_by, reviewed_at, supersedes_decision_id
      ) values ($1, $2, $3, $4, $5, $6, $7)
      returning id::text
    `,
      [
        input.attributeDefinitionId,
        decisionVersion,
        input.searchVisibility,
        input.rationale,
        input.reviewedBy,
        input.reviewedAt,
        supersedesDecisionId,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (inserted.rows.length !== 1 || insertedRow === undefined) {
      throw new Error("attribute visibility review was not persisted");
    }

    const updated = await transaction.query<{ id: string }>(
      `
      update property_core.attribute_definitions
      set search_visibility = $2
      where id = $1
      returning id::text
    `,
      [input.attributeDefinitionId, input.searchVisibility],
    );
    if (updated.rows.length !== 1) throw new Error("attribute visibility was not applied");

    const affected = await transaction.query<{ count: number }>(
      `
      select count(distinct (entity_type, entity_id))::int as count
      from property_core.entity_attributes
      where attribute_definition_id = $1
    `,
      [input.attributeDefinitionId],
    );
    const affectedEntityCount = affected.rows[0]?.count ?? 0;
    const pendingProjections =
      input.searchVisibility === "public_search"
        ? await pendingProjectionCount(transaction, input.attributeDefinitionId)
        : 0;
    const revokedProjectionCount =
      input.searchVisibility === "private"
        ? await revokeExistingProjection(
            transaction,
            input.attributeDefinitionId,
            attribute.attribute_key,
          )
        : 0;
    return {
      decisionId: insertedRow.id,
      attributeDefinitionId: input.attributeDefinitionId,
      decisionVersion,
      supersedesDecisionId,
      affectedEntityCount,
      reconciledProjectionCount: revokedProjectionCount,
      requiresReingestion: pendingProjections > 0,
      replayed: false,
    };
  });
}
