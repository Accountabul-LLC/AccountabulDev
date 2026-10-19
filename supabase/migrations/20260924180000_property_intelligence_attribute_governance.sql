-- Property Intelligence: nationwide attribute-visibility + source-field
-- mapping governance (closes the two gaps documented at the top of Slice 4
-- and Slice 5, 00f6796 and b64776c -- see those migrations'/modules' header
-- comments). Ported from property-intelligence-app's
-- supabase/migrations/20260819224113_nationwide_property_model.sql,
-- 20260820191815_add_attribute_visibility_reviews.sql, and
-- 20260821010206_add_source_mapping_releases.sql.
--
-- Tables added here:
--   property_core.attribute_definitions / entity_attributes -- the private-
--     by-default "extension attribute" model: an extension attribute on a
--     property/auction_event/auction_lot has no search-visible projection
--     until property_ingest.attribute_visibility_decisions has an ACTIVE
--     'public_search' row for its definition. Ported near-verbatim from the
--     base migration; Slice 1/2 in this repo never created these tables
--     (confirmed absent by grep before writing this migration).
--   property_ingest.attribute_visibility_decisions -- append-only review
--     ledger for the above; exactly one active decision per definition.
--   property_ingest.source_field_mapping_decisions -- append-only review
--     ledger classifying each profiled source JSON field path as a
--     core_field / mechanism_detail / extension_attribute / raw_only /
--     ignored destination. Slice 2's migration created the schema for
--     per-batch field-SHAPE profiling (ingestion_batch_profiles /
--     ingestion_batch_field_profiles, still the only tables that ever hold
--     shape metadata -- no field VALUE is stored there or here) but not
--     this per-source-contract mapping-decision ledger, which the review
--     queue and mapping-release modules both require.
--   property_ingest.source_mapping_releases / source_mapping_release_fields
--     -- the immutable "freeze" of one source contract's fully-reviewed
--     field mapping at one mappingVersion. Publishing again for the same
--     (source_definition_id, mapping_version) with different content is
--     rejected (see nationwide-source-mapping-release.ts), never silently
--     overwritten.
--
-- ingestion_runs gains a (id, source_definition_id) unique constraint --
-- absent from Slice 2's migration -- because source_mapping_releases'
-- foreign key composes on both columns (a release must cite a completed
-- run that actually belongs to the source contract it releases).
--
-- Status: schema only, matching every prior Property Intelligence phase in
-- this repo -- not applied to the live Supabase project (PRODUCTION_PROJECT_REF)
-- from this session, migration file only. The modules that populate these
-- tables (nationwide-attribute-visibility.ts, nationwide-attribute-extensions.ts,
-- nationwide-source-field-profile.ts, nationwide-source-field-review.ts,
-- nationwide-source-mapping-release.ts) all require a caller-supplied
-- PostgresTransactionHost with no default -- applying this migration and
-- actually calling those functions against a real connection is a later,
-- explicitly approved operator action.
--
-- RLS: same stricter stance as 20260924150000 and 20260924170000 --
-- SELECT restricted to public.has_role(auth.uid(), 'admin'), all writes
-- service-role only. The source gives attribute_visibility_decisions and
-- source_field_mapping_decisions no public read policy either (they are
-- reviewer/operator ledgers, not a public delivery surface).

begin;

-- property_core.attribute_definitions / entity_attributes -------------------
create table property_core.attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  attribute_key text not null,
  version integer not null check (version > 0),
  entity_scope text not null check (entity_scope in ('property', 'auction_event', 'auction_lot')),
  data_type text not null check (data_type in ('text', 'numeric', 'boolean', 'date', 'json')),
  unit text,
  meaning text not null,
  allowed_values jsonb,
  source_family text not null,
  search_visibility text not null default 'private' check (search_visibility in ('private', 'public_search')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (search_visibility = 'private' or data_type <> 'json'),
  unique (attribute_key, version)
);

create table property_core.entity_attributes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('property', 'auction_event', 'auction_lot')),
  entity_id uuid not null,
  attribute_definition_id uuid not null references property_core.attribute_definitions (id),
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  value_json jsonb,
  source_record_id uuid not null references property_ingest.source_records (id),
  verification_status text not null default 'inferred' check (
    verification_status in ('published', 'derived', 'inferred', 'accountabul_verified')
  ),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(value_text, value_numeric, value_boolean, value_date, value_json) = 1),
  unique (entity_type, entity_id, attribute_definition_id, source_record_id)
);

create index entity_attributes_definition_entity_idx
  on property_core.entity_attributes (
    attribute_definition_id, entity_type, entity_id, observed_at desc
  );

-- property_ingest.attribute_visibility_decisions -----------------------------
create table property_ingest.attribute_visibility_decisions (
  id uuid primary key default gen_random_uuid(),
  attribute_definition_id uuid not null references property_core.attribute_definitions (id),
  decision_version integer not null check (decision_version > 0),
  search_visibility text not null check (search_visibility in ('private', 'public_search')),
  rationale text not null check (nullif(btrim(rationale), '') is not null),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null,
  supersedes_decision_id uuid,
  active boolean not null default true,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (attribute_definition_id, decision_version),
  unique (id, attribute_definition_id),
  foreign key (supersedes_decision_id, attribute_definition_id)
    references property_ingest.attribute_visibility_decisions (id, attribute_definition_id),
  check ((active and superseded_at is null) or (not active and superseded_at is not null))
);

create unique index attribute_visibility_decisions_one_active_idx
  on property_ingest.attribute_visibility_decisions (attribute_definition_id)
  where active;

-- property_ingest.source_field_mapping_decisions -----------------------------
-- A mapping decision is scoped to one immutable source contract. Absence of a
-- row means unreviewed; changing parser meaning requires a new source
-- contract rather than silently rewriting this decision for historical runs.
create table property_ingest.source_field_mapping_decisions (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  field_path text not null check (
    field_path ~ '^/' and char_length(field_path) between 2 and 1000
  ),
  decision_version integer not null check (decision_version > 0),
  decision text not null check (
    decision in ('core_field', 'mechanism_detail', 'extension_attribute', 'raw_only', 'ignored')
  ),
  destination_relation text,
  destination_field text,
  attribute_definition_id uuid references property_core.attribute_definitions (id),
  rationale text not null check (nullif(btrim(rationale), '') is not null),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null,
  supersedes_decision_id uuid references property_ingest.source_field_mapping_decisions (id),
  active boolean not null default true,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (decision in ('core_field', 'mechanism_detail')
      and destination_relation is not null
      and destination_field is not null
      and attribute_definition_id is null)
    or
    (decision = 'extension_attribute'
      and destination_relation is null
      and destination_field is null
      and attribute_definition_id is not null)
    or
    (decision in ('raw_only', 'ignored')
      and destination_relation is null
      and destination_field is null
      and attribute_definition_id is null)
  ),
  check ((active and superseded_at is null) or (not active and superseded_at is not null)),
  unique (source_definition_id, field_path, decision_version),
  unique (id, source_definition_id)
);

create unique index source_field_mapping_decisions_one_active_idx
  on property_ingest.source_field_mapping_decisions (source_definition_id, field_path)
  where active;

-- ingestion_runs needs a composite unique key for source_mapping_releases'
-- foreign key below (Slice 2's migration only gave it a plain primary key).
alter table property_ingest.ingestion_runs
  add constraint ingestion_runs_id_source_definition_id_key unique (id, source_definition_id);

-- property_ingest.source_mapping_releases / source_mapping_release_fields ---
create table property_ingest.source_mapping_releases (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  mapping_version integer not null check (mapping_version > 0),
  source_profile_run_id uuid not null,
  release_fingerprint text not null check (release_fingerprint ~ '^[0-9a-f]{64}$'),
  field_count integer not null check (field_count > 0),
  release_note text not null check (
    nullif(btrim(release_note), '') is not null and char_length(release_note) <= 2000
  ),
  released_by uuid not null,
  released_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_definition_id, mapping_version),
  unique (id, source_definition_id),
  foreign key (source_profile_run_id, source_definition_id)
    references property_ingest.ingestion_runs (id, source_definition_id)
);

create index source_mapping_releases_profile_run_idx
  on property_ingest.source_mapping_releases (source_profile_run_id);

create table property_ingest.source_mapping_release_fields (
  release_id uuid not null,
  source_definition_id uuid not null,
  field_path text not null check (
    field_path ~ '^/' and char_length(field_path) between 2 and 1000
  ),
  mapping_decision_id uuid not null,
  decision_version integer not null check (decision_version > 0),
  source_value_types text[] not null check (
    cardinality(source_value_types) > 0
    and source_value_types <@ array['null', 'object', 'array', 'string', 'number', 'boolean']::text[]
  ),
  decision text not null check (
    decision in ('core_field', 'mechanism_detail', 'extension_attribute', 'raw_only', 'ignored')
  ),
  destination_relation text,
  destination_field text,
  destination_data_type text,
  destination_udt_name text,
  attribute_definition_id uuid references property_core.attribute_definitions (id),
  attribute_key text,
  attribute_entity_scope text check (
    attribute_entity_scope is null
    or attribute_entity_scope in ('property', 'auction_event', 'auction_lot')
  ),
  attribute_data_type text check (
    attribute_data_type is null
    or attribute_data_type in ('text', 'numeric', 'boolean', 'date', 'json')
  ),
  created_at timestamptz not null default now(),
  primary key (release_id, field_path),
  unique (release_id, mapping_decision_id),
  foreign key (release_id, source_definition_id)
    references property_ingest.source_mapping_releases (id, source_definition_id),
  foreign key (mapping_decision_id, source_definition_id)
    references property_ingest.source_field_mapping_decisions (id, source_definition_id),
  check (
    (decision in ('core_field', 'mechanism_detail')
      and destination_relation is not null
      and destination_field is not null
      and destination_data_type is not null
      and destination_udt_name is not null
      and attribute_definition_id is null
      and attribute_key is null
      and attribute_entity_scope is null
      and attribute_data_type is null)
    or
    (decision = 'extension_attribute'
      and destination_relation is null
      and destination_field is null
      and destination_data_type is null
      and destination_udt_name is null
      and attribute_definition_id is not null
      and attribute_key is not null
      and attribute_entity_scope is not null
      and attribute_data_type is not null)
    or
    (decision in ('raw_only', 'ignored')
      and destination_relation is null
      and destination_field is null
      and destination_data_type is null
      and destination_udt_name is null
      and attribute_definition_id is null
      and attribute_key is null
      and attribute_entity_scope is null
      and attribute_data_type is null)
  )
);

create index source_mapping_release_fields_decision_idx
  on property_ingest.source_mapping_release_fields (mapping_decision_id);

-- Snapshot rows must be exact copies of the reviewed decision and the
-- destination type visible at release time. This prevents a privileged
-- writer from publishing a plausible-looking plan that was never reviewed.
create or replace function property_ingest.validate_source_mapping_release_field()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  reviewed property_ingest.source_field_mapping_decisions%rowtype;
  expected_source_types text[];
  destination record;
  definition property_core.attribute_definitions%rowtype;
begin
  select * into reviewed
  from property_ingest.source_field_mapping_decisions
  where id = new.mapping_decision_id
    and source_definition_id = new.source_definition_id;
  if not found then
    raise exception 'mapping release field does not reference its source contract decision';
  end if;
  if not reviewed.active then
    raise exception 'mapping release field requires an active reviewed decision';
  end if;
  if reviewed.field_path is distinct from new.field_path
    or reviewed.decision_version is distinct from new.decision_version
    or reviewed.decision is distinct from new.decision
    or reviewed.destination_relation is distinct from new.destination_relation
    or reviewed.destination_field is distinct from new.destination_field
    or reviewed.attribute_definition_id is distinct from new.attribute_definition_id then
    raise exception 'mapping release field does not match its reviewed decision';
  end if;

  select array_remove(array[
    case when sum(profile.null_count) > 0 then 'null' end,
    case when sum(profile.object_count) > 0 then 'object' end,
    case when sum(profile.array_count) > 0 then 'array' end,
    case when sum(profile.string_count) > 0 then 'string' end,
    case when sum(profile.number_count) > 0 then 'number' end,
    case when sum(profile.boolean_count) > 0 then 'boolean' end
  ]::text[], null)
  into expected_source_types
  from property_ingest.source_mapping_releases release
  join property_ingest.ingestion_batches batch
    on batch.ingestion_run_id = release.source_profile_run_id
  join property_ingest.ingestion_batch_field_profiles profile
    on profile.ingestion_batch_id = batch.id
   and profile.field_path = new.field_path
  where release.id = new.release_id;
  if expected_source_types is null
    or cardinality(expected_source_types) = 0
    or expected_source_types is distinct from new.source_value_types then
    raise exception 'mapping release source types do not match the reviewed profile run';
  end if;

  if new.decision in ('core_field', 'mechanism_detail') then
    select columns.data_type, columns.udt_name into destination
    from information_schema.columns
    where columns.table_schema = split_part(new.destination_relation, '.', 1)
      and columns.table_name = split_part(new.destination_relation, '.', 2)
      and columns.column_name = new.destination_field
      and split_part(new.destination_relation, '.', 3) = '';
    if not found
      or destination.data_type is distinct from new.destination_data_type
      or destination.udt_name is distinct from new.destination_udt_name then
      raise exception 'mapping release destination type does not match the canonical schema';
    end if;
  elsif new.decision = 'extension_attribute' then
    select * into definition
    from property_core.attribute_definitions
    where id = new.attribute_definition_id;
    if not found or not definition.active
      or definition.attribute_key is distinct from new.attribute_key
      or definition.entity_scope is distinct from new.attribute_entity_scope
      or definition.data_type is distinct from new.attribute_data_type then
      raise exception 'mapping release extension does not match an active definition';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function property_ingest.validate_source_mapping_release_field()
  from public, anon, authenticated;

create trigger validate_source_mapping_release_field
before insert on property_ingest.source_mapping_release_fields
for each row execute function property_ingest.validate_source_mapping_release_field();

create or replace function property_ingest.validate_source_mapping_release_complete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (
    select count(*)
    from property_ingest.source_mapping_release_fields field
    where field.release_id = new.id
  ) <> new.field_count then
    raise exception 'mapping release field count does not match its immutable header';
  end if;
  return null;
end;
$function$;

revoke all on function property_ingest.validate_source_mapping_release_complete()
  from public, anon, authenticated;

create constraint trigger validate_source_mapping_release_complete
after insert on property_ingest.source_mapping_releases
deferrable initially deferred
for each row execute function property_ingest.validate_source_mapping_release_complete();

-- Access control: admin-only read, service-role write everywhere in this
-- migration (see header for why this diverges from the source's public
-- property_api read policy on the attribute-visibility tables specifically --
-- there is none, since these are reviewer/operator ledgers, not a delivery
-- surface).
do $rls$
declare
  target regclass;
  target_name text;
begin
  for target in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('property_core', 'property_ingest')
      and c.relkind in ('r', 'p')
      and c.oid::regclass::text in (
        'property_core.attribute_definitions', 'property_core.entity_attributes',
        'property_ingest.attribute_visibility_decisions',
        'property_ingest.source_field_mapping_decisions',
        'property_ingest.source_mapping_releases',
        'property_ingest.source_mapping_release_fields'
      )
  loop
    target_name := target::text;
    execute format('revoke all on %s from public, anon, authenticated', target);
    execute format('grant select on %s to authenticated', target);
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

-- Most of this migration's tables get the ordinary "service_role can do
-- anything" grant this repo uses everywhere else. The two release tables are
-- different: they are an append-only immutable freeze
-- (nationwide-source-mapping-release.ts rejects publishing a mappingVersion
-- again with different content -- see that module's tests), so even
-- service_role gets no UPDATE or DELETE grant on them, matching the source's
-- own stricter stance for these two tables specifically.
grant all on property_core.attribute_definitions, property_core.entity_attributes,
  property_ingest.attribute_visibility_decisions,
  property_ingest.source_field_mapping_decisions
  to service_role;

revoke all on property_ingest.source_mapping_releases,
  property_ingest.source_mapping_release_fields from service_role;
grant select, insert on property_ingest.source_mapping_releases,
  property_ingest.source_mapping_release_fields to service_role;

commit;
