-- Property Intelligence: nationwide record/resolution model (Slice 4 of the
-- nationwide multi-state ingestion port; see docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md
-- and the Slice 1/2 migrations, 20260924140000_property_intelligence_geography_catalog.sql
-- and 20260924150000_property_intelligence_ingestion_pipeline.sql). Ported
-- from property-intelligence-app's
-- supabase/migrations/20260819224113_nationwide_property_model.sql -- the
-- tables Slice 2's migration explicitly deferred: property_ingest.source_records,
-- source_record_states, source_record_occurrences, resolution_cases,
-- identifier_match_policies, official_property_crosswalks,
-- resolution_candidates; property_core.properties, property_identifiers,
-- property_addresses, property_observations, property_record_listings,
-- auction_events, auction_lots, auction_lot_properties, auction_amounts,
-- auction_parties, auction_lifecycle_events, state_forfeited_details; and
-- the property_api read projections (property_search, auction_lot_search,
-- property_record_search).
--
-- Scope note: this slice ports the subset of the source's record model that
-- src/lib/property-intelligence/nationwide-postgres-writer.ts and
-- nationwide-postgres-property-resolver.ts actually target (persisting
-- normalized auction/property-record bundles and resolving them to a
-- canonical property). It does NOT port property_core.attribute_definitions,
-- entity_attributes, property_identifier_relationships,
-- property_ingest.attribute_visibility_decisions, or
-- source_field_mapping_decisions -- the source's separate "public attribute
-- visibility" review subsystem (source's nationwide-attribute-visibility.ts,
-- not ported in any slice through this one). The ported writer therefore
-- does not populate a `searchable_attributes` projection from that
-- subsystem; property_api.*.searchable_attributes stays '{}'::jsonb here.
-- tax_lien_certificate_details and tax_deed_details (mechanism-specific
-- detail tables for sale mechanisms this slice's five source adapters never
-- publish) are left out for the same reason -- state_forfeited_details IS
-- ported because the Mississippi SOS source uses it.
--
-- Status: schema only, matching every prior Property Intelligence phase in
-- this repo -- not applied to the live Supabase project (PRODUCTION_PROJECT_REF)
-- from this session, migration file only. Nothing in this repo writes to
-- these tables yet: nationwide-postgres-writer.ts, -property-resolver.ts,
-- -county-resolver.ts, -run-store.ts, and -dispatch-store.ts are dormant
-- library code, and nationwide-source-adapter-bindings.ts's execute()
-- functions still require a caller-supplied PostgresTransactionHost with no
-- default (see that file's header) -- applying this migration and actually
-- calling those functions against a real connection is a later, explicitly
-- approved operator action.
--
-- RLS judgment call: the source gives property_api.* blanket
-- anon/authenticated SELECT (it is the source's public read layer). This
-- repo has no public delivery route wired to these tables yet (no
-- property_api-consuming server function or page), so -- consistent with
-- Slice 2's stricter stance for property_ingest -- every table in this
-- migration, including property_api.*, gets SELECT restricted to
-- `public.has_role(auth.uid(), 'admin')` and no authenticated write policy;
-- all writes are service-role only. Loosening property_api's read policy to
-- match the source's public-search intent is future work for whichever
-- slice actually builds the public search route, not this one.

begin;

create schema if not exists property_api;

-- property_ingest.source_records / source_record_states / source_record_occurrences
create table property_ingest.source_records (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_document_id uuid not null references property_ingest.source_documents (id),
  ingestion_run_id uuid not null references property_ingest.ingestion_runs (id),
  source_record_key text not null,
  source_version text not null default '1',
  record_fingerprint text not null check (record_fingerprint ~ '^[0-9a-f]{64}$'),
  source_url text not null,
  record_type text not null,
  page_locator text,
  row_locator text,
  feature_locator text,
  raw_json jsonb not null,
  normalized_address_text text,
  published_owner_text text,
  published_identifier_text text,
  parsing_status text not null check (parsing_status in ('accepted', 'partial', 'rejected')),
  field_warnings jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at),
  unique (source_definition_id, source_record_key, record_fingerprint),
  unique (source_definition_id, record_fingerprint)
);

create index source_records_document_idx
  on property_ingest.source_records (source_document_id, page_locator, row_locator);

create table property_ingest.source_record_states (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_record_key text not null,
  current_source_record_id uuid not null references property_ingest.source_records (id),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  withdrawn_at timestamptz,
  withdrawal_run_id uuid references property_ingest.ingestion_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_seen_at >= first_seen_at),
  check (withdrawn_at is null or withdrawn_at >= first_seen_at),
  check ((withdrawn_at is null) = (withdrawal_run_id is null)),
  unique (source_definition_id, source_record_key)
);

-- property_core.properties -----------------------------------------------
create table property_core.properties (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  lifecycle_state text not null default 'unknown' check (
    lifecycle_state in ('active', 'retired', 'split', 'combined', 'unknown')
  ),
  match_status text not null default 'unresolved' check (
    match_status in ('unresolved', 'candidate', 'resolved', 'conflicted')
  ),
  review_status text not null default 'not_reviewed' check (
    review_status in ('not_reviewed', 'needs_review', 'approved', 'rejected')
  ),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  geometry_source_record_id uuid references property_ingest.source_records (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table property_ingest.source_record_occurrences (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null references property_ingest.source_records (id),
  source_document_id uuid not null references property_ingest.source_documents (id),
  ingestion_run_id uuid not null references property_ingest.ingestion_runs (id),
  occurrence_key text not null,
  source_url text not null,
  page_locator text,
  row_locator text,
  feature_locator text,
  parsing_status text not null check (parsing_status in ('accepted', 'partial', 'rejected')),
  field_warnings jsonb not null default '[]'::jsonb,
  created_new_version boolean not null,
  resolution_status text not null check (
    resolution_status in ('resolved', 'unresolved', 'needs_review', 'conflicted')
  ),
  resolution_algorithm_version text not null,
  resolved_property_id uuid references property_core.properties (id),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((resolution_status = 'resolved') = (resolved_property_id is not null)),
  unique (ingestion_run_id, occurrence_key)
);

create index source_record_occurrences_record_idx
  on property_ingest.source_record_occurrences (source_record_id, observed_at desc);

create table property_core.property_identifiers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references property_core.properties (id),
  issuer_jurisdiction_id uuid not null references property_core.jurisdictions (id),
  identifier_type text not null,
  raw_value text not null,
  normalized_value text not null,
  valid_from date,
  valid_to date,
  source_record_id uuid not null references property_ingest.source_records (id),
  verification_status text not null check (
    verification_status in ('published', 'derived', 'inferred', 'accountabul_verified')
  ),
  is_authoritative boolean not null default false,
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index property_identifiers_current_authoritative_uidx
  on property_core.property_identifiers (issuer_jurisdiction_id, identifier_type, normalized_value)
  where valid_to is null and is_authoritative;

create index property_identifiers_lookup_idx
  on property_core.property_identifiers (identifier_type, normalized_value);

create unique index property_identifiers_source_assertion_uidx
  on property_core.property_identifiers (
    property_id, issuer_jurisdiction_id, identifier_type, normalized_value, source_record_id
  );

create table property_core.property_addresses (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references property_core.properties (id),
  address_role text not null check (
    address_role in ('situs', 'owner_mailing', 'occupant_mailing', 'auction_contact', 'unknown_published')
  ),
  raw_address text not null,
  city text,
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  postal_code text,
  normalized_address text,
  valid_from date,
  valid_to date,
  verification_status text not null check (
    verification_status in ('published', 'derived', 'inferred', 'accountabul_verified')
  ),
  source_record_id uuid not null references property_ingest.source_records (id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index property_addresses_source_assertion_uidx
  on property_core.property_addresses (property_id, address_role, raw_address, source_record_id);

create table property_core.property_observations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references property_core.properties (id),
  fact_type text not null,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  unit text,
  effective_date date,
  observed_at timestamptz not null,
  source_record_id uuid not null references property_ingest.source_records (id),
  observation_fingerprint text not null check (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  verification_status text not null check (
    verification_status in ('published', 'derived', 'inferred', 'accountabul_verified')
  ),
  derivation_method text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(value_text, value_numeric, value_boolean, value_date) = 1),
  check (verification_status in ('published', 'accountabul_verified') or derivation_method is not null),
  unique (property_id, observation_fingerprint)
);

create index property_observations_current_idx
  on property_core.property_observations (property_id, fact_type, effective_date desc, observed_at desc);

create table property_core.property_record_listings (
  source_record_id uuid primary key references property_ingest.source_records (id),
  property_id uuid references property_core.properties (id),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  record_kind text not null check (nullif(btrim(record_kind), '') is not null),
  lifecycle_state text not null check (nullif(btrim(lifecycle_state), '') is not null),
  published_status_text text,
  published_owner_text text,
  legal_description text,
  published_amount numeric(16, 2),
  published_amount_type text check (published_amount_type is null or published_amount_type in ('asking_price')),
  published_amount_label text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (published_amount is null and published_amount_type is null and published_amount_label is null)
    or (
      published_amount >= 0
      and published_amount_type is not null
      and nullif(btrim(published_amount_label), '') is not null
    )
  )
);

create index property_record_listings_property_idx
  on property_core.property_record_listings (property_id, observed_at desc)
  where property_id is not null;

-- property_core.auction_* --------------------------------------------------
create table property_core.auction_events (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_document_id uuid not null references property_ingest.source_documents (id),
  source_event_key text not null,
  administering_agency text not null,
  event_label text not null,
  sale_mechanism text not null check (
    sale_mechanism in (
      'tax_lien_certificate', 'tax_deed', 'redeemable_tax_deed', 'sheriff_or_judicial_sale',
      'state_forfeited_inventory', 'over_the_counter_or_negotiated', 'sealed_bid'
    )
  ),
  asset_class text not null check (asset_class in ('real_property', 'personal_property', 'mixed')),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  unique (source_definition_id, jurisdiction_id, source_event_key)
);

create table property_core.auction_lots (
  id uuid primary key default gen_random_uuid(),
  auction_event_id uuid not null references property_core.auction_events (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  source_lot_key text not null,
  published_lot_number text,
  published_item_number text,
  published_certificate_number text,
  published_receipt_number text,
  legal_description text,
  published_address_text text,
  tax_years int[] not null default '{}'::int[],
  lifecycle_state text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auction_event_id, source_lot_key)
);

create table property_core.auction_lot_properties (
  id uuid primary key default gen_random_uuid(),
  auction_lot_id uuid not null references property_core.auction_lots (id),
  property_id uuid not null references property_core.properties (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  match_method text not null,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  verification_status text not null check (
    verification_status in ('published', 'derived', 'inferred', 'accountabul_verified')
  ),
  resolved_at timestamptz,
  active boolean not null default true,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check (not active or invalidated_at is null),
  unique (auction_lot_id, property_id)
);

create table property_core.auction_amounts (
  id uuid primary key default gen_random_uuid(),
  auction_lot_id uuid not null references property_core.auction_lots (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  amount_type text not null check (
    amount_type in (
      'taxes', 'interest', 'penalty', 'publication_fee', 'recording_fee', 'other_fee',
      'total_due', 'minimum_bid', 'winning_bid', 'bid_excess',
      'certificate_face_amount', 'application_fee', 'offer_amount'
    )
  ),
  amount numeric(16, 2) not null,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tax_year integer,
  value_status text not null check (value_status in ('published', 'calculated')),
  component_fingerprint text not null check (component_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (amount >= 0),
  unique (auction_lot_id, component_fingerprint)
);

create table property_core.auction_parties (
  id uuid primary key default gen_random_uuid(),
  auction_lot_id uuid not null references property_core.auction_lots (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  party_role text not null check (
    party_role in (
      'assessed_owner', 'former_owner', 'purchaser', 'certificate_holder', 'applicant',
      'mortgage_holder', 'lien_holder', 'administering_agency', 'contact'
    )
  ),
  published_name text not null,
  party_fingerprint text not null check (party_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (auction_lot_id, party_fingerprint)
);

create table property_core.auction_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  auction_lot_id uuid not null references property_core.auction_lots (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  event_type text not null check (
    event_type in (
      'advertised', 'scheduled', 'opened', 'removed', 'canceled', 'sold',
      'struck_to_state', 'redeemed', 'redemption_expired', 'forfeited_to_state',
      'available_for_application', 'application_received', 'patented_or_deeded'
    )
  ),
  effective_at timestamptz,
  observed_at timestamptz not null,
  published_status_text text,
  event_fingerprint text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (auction_lot_id, event_fingerprint)
);

create table property_core.state_forfeited_details (
  auction_lot_id uuid primary key references property_core.auction_lots (id),
  certified_market_value numeric(16, 2),
  back_tax_total numeric(16, 2),
  active_application_count integer check (active_application_count is null or active_application_count >= 0),
  pending_review_application_count integer check (
    pending_review_application_count is null or pending_review_application_count >= 0
  ),
  patent_status text,
  source_record_id uuid not null references property_ingest.source_records (id),
  check (certified_market_value is null or certified_market_value >= 0),
  check (back_tax_total is null or back_tax_total >= 0)
);

-- Resolution -----------------------------------------------------------------
create table property_ingest.resolution_cases (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references property_ingest.source_records (id),
  auction_lot_id uuid references property_core.auction_lots (id),
  algorithm_version text not null,
  status text not null check (status in ('open', 'auto_resolved', 'needs_review', 'approved', 'rejected')),
  resolution_method text,
  accepted_property_id uuid references property_core.properties (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_record_id is not null or auction_lot_id is not null),
  check (accepted_property_id is null or status in ('auto_resolved', 'approved')),
  unique (source_record_id, algorithm_version)
);

-- Fails closed until an approved policy exists: `enabled` requires
-- `approved_at`, and nationwide-property-resolution.ts's
-- resolveNormalizedProperty always returns "unresolved" for a source with no
-- enabled row here (see that module's header).
create table property_ingest.identifier_match_policies (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_identifier_type text not null,
  canonical_identifier_type text not null,
  issuer_jurisdiction_id uuid references property_core.jurisdictions (id),
  policy_version text not null,
  evidence_reference text not null,
  enabled boolean not null default false,
  effective_from timestamptz,
  effective_to timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (not enabled or approved_at is not null),
  unique nulls not distinct (
    source_definition_id, source_identifier_type, canonical_identifier_type,
    issuer_jurisdiction_id, policy_version
  )
);

create table property_ingest.official_property_crosswalks (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_record_id uuid not null references property_ingest.source_records (id),
  property_id uuid not null references property_core.properties (id),
  evidence_reference text not null,
  active boolean not null default true,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_record_id, property_id, evidence_reference)
);

create unique index official_property_crosswalks_one_active_property_uidx
  on property_ingest.official_property_crosswalks (source_record_id)
  where active;

create table property_ingest.resolution_candidates (
  id uuid primary key default gen_random_uuid(),
  resolution_case_id uuid not null references property_ingest.resolution_cases (id),
  property_id uuid not null references property_core.properties (id),
  match_method text not null check (
    match_method in (
      'exact_scoped_identifier', 'official_crosswalk', 'authoritative_source_identity',
      'authoritative_geometry', 'exact_address_candidate'
    )
  ),
  matched_values jsonb not null,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (resolution_case_id, property_id, match_method)
);

-- property_api read projections -----------------------------------------
create table property_api.property_search (
  property_id uuid primary key,
  jurisdiction_id uuid not null,
  state_code text,
  county_fips text,
  county_name text,
  primary_identifier_type text,
  primary_identifier_value text,
  situs_address text,
  city text,
  postal_code text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  property_type text,
  land_use text,
  building_square_feet numeric,
  land_square_feet numeric,
  current_market_value numeric(16, 2),
  current_assessed_value numeric(16, 2),
  current_inventory_status text,
  searchable_attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(searchable_attributes) = 'object'),
  search_text text not null default '',
  updated_at timestamptz not null,
  check (building_square_feet is null or building_square_feet >= 0),
  check (land_square_feet is null or land_square_feet >= 0),
  check (current_market_value is null or current_market_value >= 0),
  check (current_assessed_value is null or current_assessed_value >= 0)
);

create table property_api.auction_lot_search (
  auction_lot_id uuid primary key,
  source_definition_id uuid not null,
  source_record_id uuid not null,
  property_id uuid,
  resolution_status text not null check (resolution_status in ('resolved', 'unresolved', 'needs_review', 'conflicted')),
  jurisdiction_id uuid not null,
  state_code text,
  county_fips text,
  county_name text,
  sale_mechanism text not null,
  asset_class text not null,
  lifecycle_state text not null,
  event_label text not null,
  source_lot_key text not null,
  published_identifier_text text,
  published_address_text text,
  published_owner_text text,
  legal_description text,
  total_due numeric(16, 2),
  minimum_bid numeric(16, 2),
  winning_bid numeric(16, 2),
  starts_at timestamptz,
  ends_at timestamptz,
  source_document_id uuid not null,
  source_document_title text,
  source_url text not null,
  searchable_attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(searchable_attributes) = 'object'),
  search_text text not null default '',
  updated_at timestamptz not null,
  check (total_due is null or total_due >= 0),
  check (minimum_bid is null or minimum_bid >= 0),
  check (winning_bid is null or winning_bid >= 0)
);

create table property_api.property_record_search (
  source_definition_id uuid not null,
  source_record_key text not null,
  source_record_id uuid not null,
  property_id uuid,
  resolution_status text not null check (resolution_status in ('resolved', 'unresolved', 'needs_review', 'conflicted')),
  jurisdiction_id uuid not null,
  state_code text,
  county_fips text,
  county_name text,
  record_kind text not null,
  lifecycle_state text not null,
  published_identifier_text text,
  published_address_text text,
  published_owner_text text,
  legal_description text,
  published_amount numeric(16, 2),
  published_amount_type text check (published_amount_type in ('asking_price')),
  published_amount_label text,
  property_type text,
  land_use text,
  building_square_feet numeric,
  land_square_feet numeric,
  market_value numeric(16, 2),
  assessed_value numeric(16, 2),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  source_document_id uuid not null,
  source_document_title text,
  source_url text not null,
  withdrawn_at timestamptz,
  searchable_attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(searchable_attributes) = 'object'),
  search_text text not null default '',
  updated_at timestamptz not null,
  primary key (source_definition_id, source_record_key),
  check (
    (published_amount is null and published_amount_type is null)
    or (published_amount >= 0 and published_amount_type is not null)
  ),
  check (building_square_feet is null or building_square_feet >= 0),
  check (land_square_feet is null or land_square_feet >= 0),
  check (market_value is null or market_value >= 0),
  check (assessed_value is null or assessed_value >= 0)
);

-- Access control: admin-only read, service-role write everywhere in this
-- migration (see header for why this diverges from the source's public
-- property_api read policy).
do $rls$
declare
  target regclass;
  target_name text;
begin
  for target in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('property_core', 'property_ingest', 'property_api')
      and c.relkind in ('r', 'p')
      and c.oid::regclass::text in (
        'property_ingest.source_records', 'property_ingest.source_record_states',
        'property_ingest.source_record_occurrences', 'property_core.properties',
        'property_core.property_identifiers', 'property_core.property_addresses',
        'property_core.property_observations', 'property_core.property_record_listings',
        'property_core.auction_events', 'property_core.auction_lots',
        'property_core.auction_lot_properties', 'property_core.auction_amounts',
        'property_core.auction_parties', 'property_core.auction_lifecycle_events',
        'property_core.state_forfeited_details', 'property_ingest.resolution_cases',
        'property_ingest.identifier_match_policies', 'property_ingest.official_property_crosswalks',
        'property_ingest.resolution_candidates', 'property_api.property_search',
        'property_api.auction_lot_search', 'property_api.property_record_search'
      )
  loop
    target_name := target::text;
    execute format('revoke all on %s from public, anon, authenticated', target);
    execute format('grant select on %s to authenticated', target);
    execute format('grant all on %s to service_role', target);
    execute format('alter table %s enable row level security', target);
    execute format('alter table %s force row level security', target);
    execute format(
      'create policy %I on %s for select to authenticated using (public.has_role(auth.uid(), ''admin''))',
      replace(target_name, '.', '_') || '_admin_read',
      target
    );
  end loop;
end
$rls$;

commit;
