// Closes the same gap as nationwide-attribute-visibility.ts (see that
// module's header). Ported from the persistExtensions /
// publicAttributesForEntity / refreshAuctionLotSearchableAttributes
// functions inside property-intelligence-app's app/lib/nationwide-postgres-writer.ts,
// split into their own module so nationwide-postgres-writer.ts and
// nationwide-postgres-run-store-search.ts can both plug into it without
// duplicating the registry or the query.
//
// Invariant preserved exactly, never loosened: publicAttributesForEntity
// only ever selects an entity_attributes row through a join that requires
// property_ingest.attribute_visibility_decisions to have an ACTIVE
// 'public_search' row for its attribute_definitions row (and
// attribute_definitions.search_visibility must independently agree --
// nationwide-attribute-visibility.ts keeps both in lockstep). An extension
// attribute with no visibility decision, or a 'private' one, never appears
// in any property_api.*.searchable_attributes projection or search_text.
import type { PostgresTransaction } from "./nationwide-geography-catalog.ts";
import type { NormalizedIntakeBundle } from "./nationwide-property-intake-types.ts";

type ExtensionDefinition = {
  dataType: "text" | "numeric" | "boolean" | "date";
  label: string;
  meaning: string;
  unit: string | null;
  entityScope: "auction_lot";
  sourceFamily: "mississippi_tax_auction";
};

// Ported verbatim from the source's EXTENSION_DEFINITIONS registry -- every
// extension key this repo's Mississippi source adapters
// (nationwide-ms-sos-normalize.ts, nationwide-ms-rankin-pdf.ts,
// nationwide-ms-county-tax-sale-normalize.ts) already emit on
// NormalizedIntakeBundle["extensions"].
export const EXTENSION_DEFINITIONS: Record<string, ExtensionDefinition> = {
  ms_homestead_chargeback: {
    dataType: "boolean",
    label: "Homestead chargeback",
    meaning: "Mississippi homestead chargeback flag published for the sale row.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  ms_section: {
    dataType: "text",
    label: "Section",
    meaning: "Public-land-survey section published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  ms_township: {
    dataType: "text",
    label: "Township",
    meaning: "Public-land-survey township published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  ms_range: {
    dataType: "text",
    label: "Range",
    meaning: "Public-land-survey range published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  subdivision: {
    dataType: "text",
    label: "Subdivision",
    meaning: "Subdivision name published by the source.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  lot: {
    dataType: "text",
    label: "Lot",
    meaning: "Lot designation published by the source.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  block: {
    dataType: "text",
    label: "Block",
    meaning: "Block designation published by the source.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  municipality_name: {
    dataType: "text",
    label: "Municipality",
    meaning: "Municipality name published by the source.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  school_district_name: {
    dataType: "text",
    label: "School district",
    meaning: "School-district name published by the source.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  ms_blighted: {
    dataType: "boolean",
    label: "Blighted property",
    meaning: "Mississippi source blighted-property flag.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  ms_tidelands: {
    dataType: "boolean",
    label: "Tidelands",
    meaning: "Mississippi source tidelands flag.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  published_sale_date: {
    dataType: "date",
    label: "Published sale date",
    meaning: "Calendar sale date published without an invented event time.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  public_land_survey_section: {
    dataType: "text",
    label: "PLSS section",
    meaning: "Public-land-survey section published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  public_land_survey_township: {
    dataType: "text",
    label: "PLSS township",
    meaning: "Public-land-survey township published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  public_land_survey_range: {
    dataType: "text",
    label: "PLSS range",
    meaning: "Public-land-survey range published for the parcel.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  tax_district_code: {
    dataType: "text",
    label: "Tax district",
    meaning:
      "County tax-district code exactly as published, without assuming a national code system.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  published_deed_book: {
    dataType: "text",
    label: "Published deed book",
    meaning: "Deed-book component published in the county tax-sale report.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
  published_deed_page: {
    dataType: "text",
    label: "Published deed page",
    meaning: "Deed-page component published in the county tax-sale report.",
    unit: null,
    entityScope: "auction_lot",
    sourceFamily: "mississippi_tax_auction",
  },
};

export type SearchableAttributeProjection = Record<
  string,
  {
    label: string;
    meaning: string;
    unit: string | null;
    value: string | number | boolean;
  }
>;

export function searchableAttributeText(attributes: SearchableAttributeProjection) {
  return Object.entries(attributes)
    .flatMap(([key, attribute]) => [
      key,
      attribute.label,
      attribute.meaning,
      attribute.value,
      attribute.unit,
    ])
    .filter((value) => value !== null && String(value).trim());
}

function attributeLabel(key: string) {
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

// Only ever returns attributes whose CURRENT attribute_definitions row is
// active + search_visibility = 'public_search' AND whose attribute_visibility_decisions
// row is active + search_visibility = 'public_search' (the two must agree --
// nationwide-attribute-visibility.ts is the only writer of either). Everything
// else -- unreviewed, revoked, or 'json'-typed extensions -- is excluded, so
// an extension is invisible to search until a reviewer explicitly authorizes it.
export async function publicAttributesForEntity(
  transaction: PostgresTransaction,
  entityType: "property" | "auction_event" | "auction_lot",
  entityId: string,
  sourceRecordId: string | null = null,
): Promise<SearchableAttributeProjection> {
  const rows = await transaction.query<{
    attribute_key: string;
    meaning: string;
    unit: string | null;
    data_type: "text" | "numeric" | "boolean" | "date";
    value_text: string | null;
    value_numeric: string | number | null;
    value_boolean: boolean | null;
    value_date: string | null;
  }>(
    `
    select distinct on (definition.attribute_key)
      definition.attribute_key,
      definition.meaning,
      definition.unit,
      definition.data_type,
      attribute.value_text,
      attribute.value_numeric,
      attribute.value_boolean,
      attribute.value_date::text as value_date
    from property_core.entity_attributes attribute
    join property_core.attribute_definitions definition
      on definition.id = attribute.attribute_definition_id
    join property_ingest.attribute_visibility_decisions visibility
      on visibility.attribute_definition_id = definition.id
     and visibility.active
     and visibility.search_visibility = 'public_search'
    where attribute.entity_type = $1
      and attribute.entity_id = $2
      and ($3::uuid is null or attribute.source_record_id = $3)
      and definition.active
      and definition.search_visibility = 'public_search'
      and definition.data_type <> 'json'
      and attribute.verification_status in ('published', 'accountabul_verified')
    order by definition.attribute_key, definition.version desc, attribute.observed_at desc
  `,
    [entityType, entityId, sourceRecordId],
  );
  return Object.fromEntries(
    rows.rows.map((row) => {
      const value =
        row.data_type === "numeric"
          ? numeric(row.value_numeric)
          : row.data_type === "boolean"
            ? row.value_boolean
            : row.data_type === "date"
              ? row.value_date
              : row.value_text;
      if (value === null)
        throw new Error(`public-search attribute ${row.attribute_key} has no typed value`);
      return [
        row.attribute_key,
        {
          label:
            EXTENSION_DEFINITIONS[row.attribute_key]?.label ?? attributeLabel(row.attribute_key),
          meaning: row.meaning,
          unit: row.unit,
          value,
        },
      ];
    }),
  ) satisfies SearchableAttributeProjection;
}

// Registers (idempotently) an attribute_definitions row per extension key
// this repo's registry knows about, then upserts the entity_attributes
// value. This never touches search_visibility or
// attribute_visibility_decisions -- every new definition starts 'private'
// (its column default) and stays invisible to search until
// reviewNationwideAttributeVisibility (nationwide-attribute-visibility.ts)
// records an explicit 'public_search' decision for it.
export async function persistExtensions(
  transaction: PostgresTransaction,
  bundle: NormalizedIntakeBundle,
  sourceRecordId: string,
  auctionLotId: string,
) {
  for (const extension of bundle.extensions) {
    const definition = EXTENSION_DEFINITIONS[extension.key];
    if (!definition)
      throw new Error(`extension ${extension.key} is not registered in the writer contract`);
    const calendarDate =
      typeof extension.value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(extension.value) &&
      new Date(`${extension.value}T00:00:00.000Z`).toISOString().slice(0, 10) === extension.value;
    const actualType =
      definition.dataType === "date" && calendarDate
        ? "date"
        : typeof extension.value === "number"
          ? "numeric"
          : typeof extension.value === "string"
            ? "text"
            : typeof extension.value;
    if (actualType !== definition.dataType) {
      throw new Error(`extension ${extension.key} must contain a ${definition.dataType} value`);
    }
    const definitionRow = await one<{
      id: string;
      data_type: string;
      entity_scope: string;
      source_family: string;
      unit: string | null;
      meaning: string;
      active: boolean;
    }>(
      transaction,
      `
      insert into property_core.attribute_definitions (
        attribute_key, version, entity_scope, data_type, unit, meaning, source_family
      ) values ($1, 1, $2, $3, $4, $5, $6)
      on conflict (attribute_key, version) do update set attribute_key = excluded.attribute_key
      returning id, data_type, entity_scope, source_family, unit, meaning, active
    `,
      [
        extension.key,
        definition.entityScope,
        definition.dataType,
        definition.unit,
        definition.meaning,
        definition.sourceFamily,
      ],
      "attribute definition upsert failed",
    );
    if (
      definitionRow.data_type !== definition.dataType ||
      definitionRow.entity_scope !== definition.entityScope ||
      definitionRow.source_family !== definition.sourceFamily ||
      definitionRow.unit !== definition.unit ||
      definitionRow.meaning !== definition.meaning ||
      !definitionRow.active
    ) {
      throw new Error(
        `extension ${extension.key} conflicts with its registered database definition`,
      );
    }

    await transaction.query(
      `
      insert into property_core.entity_attributes (
        entity_type, entity_id, attribute_definition_id,
        value_text, value_numeric, value_boolean, value_date,
        source_record_id, verification_status, observed_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (entity_type, entity_id, attribute_definition_id, source_record_id)
      do update set
        value_text = excluded.value_text,
        value_numeric = excluded.value_numeric,
        value_boolean = excluded.value_boolean,
        value_date = excluded.value_date,
        verification_status = excluded.verification_status,
        observed_at = excluded.observed_at
    `,
      [
        definition.entityScope,
        auctionLotId,
        definitionRow.id,
        definition.dataType === "text" ? extension.value : null,
        definition.dataType === "numeric" ? extension.value : null,
        definition.dataType === "boolean" ? extension.value : null,
        definition.dataType === "date" ? extension.value : null,
        sourceRecordId,
        extension.verificationStatus,
        bundle.sourceRecord.sourceDocumentRetrievedAt,
      ],
    );
  }
}

// Recomputes one auction lot's searchable_attributes/search_text from its
// CURRENT public extension attributes. Called after a visibility decision
// changes a definition's visibility (reingestion isn't required for
// already-persisted values -- this reconciles the projection instead) as
// well as at write time. Returns false when the lot has no current search
// projection row yet.
export async function refreshAuctionLotSearchableAttributes(
  transaction: PostgresTransaction,
  auctionLotId: string,
) {
  assertUuid(auctionLotId, "auctionLotId");
  const projection = await transaction.query<{
    source_record_id: string;
    state_code: string | null;
    county_name: string | null;
    county_fips: string | null;
    event_label: string | null;
    sale_mechanism: string | null;
    lifecycle_state: string | null;
    published_identifier_text: string | null;
    source_lot_key: string | null;
    published_address_text: string | null;
    published_owner_text: string | null;
    legal_description: string | null;
  }>(
    `
    select
      source_record_id::text, state_code, county_name, county_fips,
      event_label, sale_mechanism, lifecycle_state,
      published_identifier_text, source_lot_key, published_address_text,
      published_owner_text, legal_description
    from property_api.auction_lot_search
    where auction_lot_id = $1
    for update
  `,
    [auctionLotId],
  );
  if (projection.rows.length === 0) return false;
  if (projection.rows.length !== 1)
    throw new Error("auction lot has more than one current search projection");
  const row = projection.rows[0];
  if (row === undefined) throw new Error("auction lot search projection row is missing");
  const attributes = await publicAttributesForEntity(
    transaction,
    "auction_lot",
    auctionLotId,
    row.source_record_id,
  );
  const searchText = [
    row.state_code,
    row.county_name,
    row.county_fips,
    row.event_label,
    row.sale_mechanism,
    row.lifecycle_state,
    row.published_identifier_text,
    row.source_lot_key,
    row.published_address_text,
    row.published_owner_text,
    row.legal_description,
    ...searchableAttributeText(attributes),
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .join(" | ")
    .toLowerCase();
  const updated = await transaction.query<{ auction_lot_id: string }>(
    `
    update property_api.auction_lot_search
    set searchable_attributes = $2::jsonb,
        search_text = $3,
        updated_at = now()
    where auction_lot_id = $1
    returning auction_lot_id::text
  `,
    [auctionLotId, json(attributes), searchText],
  );
  if (updated.rows.length !== 1)
    throw new Error("auction search projection changed during attribute refresh");
  return true;
}
