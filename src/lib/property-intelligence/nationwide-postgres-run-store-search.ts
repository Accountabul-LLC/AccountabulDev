// Slice 4 of the nationwide multi-state ingestion port. Condensed port of
// property-intelligence-app's app/lib/nationwide-postgres-writer.ts
// `refreshCanonicalPropertySearch`: recomputes one property's row in
// property_api.property_search from its current canonical identifiers,
// situs address, observations, and linked inventory lifecycle state. Split
// out from nationwide-postgres-writer.ts because nationwide-postgres-run-store.ts
// also calls it (on withdrawal) without needing the rest of the writer.
//
// Update: like nationwide-postgres-writer.ts, this now populates
// `searchable_attributes` from the source's "public attribute visibility"
// layer -- see nationwide-attribute-extensions.ts's publicAttributesForEntity
// (private by default; only an active 'public_search' visibility decision
// makes a property-scoped extension attribute appear here).
import type { PostgresTransaction } from "./nationwide-geography-catalog.ts";
import {
  publicAttributesForEntity,
  searchableAttributeText,
} from "./nationwide-attribute-extensions.ts";

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

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function refreshCanonicalPropertySearch(
  transaction: PostgresTransaction,
  propertyId: string,
) {
  const property = await one<{
    jurisdiction_id: string;
    state_code: string | null;
    county_fips: string | null;
    county_name: string;
    latitude: string | number | null;
    longitude: string | number | null;
  }>(
    transaction,
    `select p.jurisdiction_id, j.state_code, j.county_fips, j.name as county_name, p.latitude, p.longitude
     from property_core.properties p
     join property_core.jurisdictions j on j.id = p.jurisdiction_id
     where p.id = $1`,
    [propertyId],
    "resolved property does not exist",
  );

  const identifiers = await transaction.query<{
    identifier_type: string;
    normalized_value: string;
  }>(
    `select identifier_type, normalized_value from property_core.property_identifiers
     where property_id = $1 and valid_to is null and is_authoritative
     order by is_preferred desc, identifier_type, normalized_value`,
    [propertyId],
  );
  const addresses = await transaction.query<{
    raw_address: string;
    city: string | null;
    postal_code: string | null;
  }>(
    `select raw_address, city, postal_code from property_core.property_addresses
     where property_id = $1 and address_role = 'situs' and valid_to is null
     order by created_at desc limit 1`,
    [propertyId],
  );
  const observations = await transaction.query<{
    fact_type: string;
    value_text: string | null;
    value_numeric: string | number | null;
    unit: string | null;
  }>(
    `select distinct on (fact_type, coalesce(unit, '')) fact_type, value_text, value_numeric, unit
     from property_core.property_observations
     where property_id = $1
     order by fact_type, coalesce(unit, ''), effective_date desc nulls last, observed_at desc, created_at desc`,
    [propertyId],
  );
  const inventory = await transaction.query<{ lifecycle_state: string }>(
    `select inventory.lifecycle_state
     from (
       select l.lifecycle_state, l.updated_at
       from property_core.auction_lot_properties lp
       join property_core.auction_lots l on l.id = lp.auction_lot_id
       where lp.property_id = $1 and lp.active
       union all
       select record.lifecycle_state, record.updated_at
       from property_api.property_record_search record
       where record.property_id = $1 and record.withdrawn_at is null
     ) inventory
     order by case when inventory.lifecycle_state in ('removed', 'withdrawn') then 1 else 0 end, inventory.updated_at desc
     limit 1`,
    [propertyId],
  );

  const facts = new Map(
    observations.rows.map((row) => [`${row.fact_type}:${row.unit ?? ""}`, row]),
  );
  const fact = (factType: string, unit: string | null = null) =>
    facts.get(`${factType}:${unit ?? ""}`);
  const publishedLandSquareFeet = numeric(fact("land_area", "square_foot")?.value_numeric);
  const publishedLandAcres = numeric(fact("land_area", "acre")?.value_numeric);
  const landSquareFeet =
    publishedLandSquareFeet ?? (publishedLandAcres === null ? null : publishedLandAcres * 43_560);
  const primaryIdentifier = identifiers.rows[0] ?? null;
  const situs = addresses.rows[0] ?? null;
  const searchableAttributes = await publicAttributesForEntity(transaction, "property", propertyId);
  const searchText = [
    property.state_code,
    property.county_name,
    property.county_fips,
    ...identifiers.rows.flatMap((identifier) => [
      identifier.identifier_type,
      identifier.normalized_value,
    ]),
    situs?.raw_address,
    situs?.city,
    situs?.postal_code,
    fact("property_type")?.value_text,
    fact("land_use")?.value_text,
    inventory.rows[0]?.lifecycle_state,
    ...searchableAttributeText(searchableAttributes),
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .join(" | ")
    .toLowerCase();

  await transaction.query(
    `insert into property_api.property_search (
       property_id, jurisdiction_id, state_code, county_fips, county_name, primary_identifier_type,
       primary_identifier_value, situs_address, city, postal_code, latitude, longitude, property_type,
       land_use, building_square_feet, land_square_feet, current_market_value, current_assessed_value,
       current_inventory_status, searchable_attributes, search_text, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21, now())
     on conflict (property_id) do update set
       jurisdiction_id = excluded.jurisdiction_id,
       state_code = excluded.state_code,
       county_fips = excluded.county_fips,
       county_name = excluded.county_name,
       primary_identifier_type = excluded.primary_identifier_type,
       primary_identifier_value = excluded.primary_identifier_value,
       situs_address = excluded.situs_address,
       city = excluded.city,
       postal_code = excluded.postal_code,
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       property_type = excluded.property_type,
       land_use = excluded.land_use,
       building_square_feet = excluded.building_square_feet,
       land_square_feet = excluded.land_square_feet,
       current_market_value = excluded.current_market_value,
       current_assessed_value = excluded.current_assessed_value,
       current_inventory_status = excluded.current_inventory_status,
       searchable_attributes = excluded.searchable_attributes,
       search_text = excluded.search_text,
       updated_at = excluded.updated_at`,
    [
      propertyId,
      property.jurisdiction_id,
      property.state_code,
      property.county_fips,
      property.county_name,
      primaryIdentifier?.identifier_type ?? null,
      primaryIdentifier?.normalized_value ?? null,
      situs?.raw_address ?? null,
      situs?.city ?? null,
      situs?.postal_code ?? null,
      numeric(property.latitude),
      numeric(property.longitude),
      fact("property_type")?.value_text ?? null,
      fact("land_use")?.value_text ?? null,
      numeric(fact("building_square_feet", "square_foot")?.value_numeric),
      landSquareFeet,
      numeric(fact("market_value", "USD")?.value_numeric ?? fact("market_value")?.value_numeric),
      numeric(
        fact("assessed_value", "USD")?.value_numeric ?? fact("assessed_value")?.value_numeric,
      ),
      inventory.rows[0]?.lifecycle_state ?? null,
      JSON.stringify(searchableAttributes),
      searchText,
    ],
  );
}
