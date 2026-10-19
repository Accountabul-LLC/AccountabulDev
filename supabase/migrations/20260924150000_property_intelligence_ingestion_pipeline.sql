-- Property Intelligence: nationwide ingestion pipeline (Slice 2 of the
-- nationwide multi-state ingestion port; see docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md
-- and the Slice 1 migration, 20260924140000_property_intelligence_geography_catalog.sql).
-- Ported from property-intelligence-app's
-- supabase/migrations/20260819224113_nationwide_property_model.sql -- the
-- property_ingest tables covering the source-qualification pipeline
-- (source_definitions -> source_candidates -> source_candidate_assessments
-- -> source_candidate_promotions), ingestion execution bookkeeping
-- (ingestion_runs/dispatches/batches/snapshot_members/rejections), and
-- operational health monitoring (ingestion_health_incidents/monitor_state/
-- outbox). property_ingest.source_records, source_record_states,
-- source_record_occurrences, and property_core.properties are NOT ported in
-- this slice -- they belong to the actual record-ingestion phase (source
-- adapters, Slice 3+), out of scope here.
--
-- Status: schema only, matching every prior Property Intelligence phase in
-- this repo -- not applied to the live Supabase project (PRODUCTION_PROJECT_REF)
-- from this session, migration file only. Nothing in this repo writes to
-- these tables yet: the orchestrator/schedule/registry/health library code in
-- src/lib/property-intelligence/nationwide-ingestion-*.ts and
-- nationwide-source-executor-registry.ts is dormant, not wired to any cron,
-- server function, or route. property_ingest.enqueue_due_ingestion_dispatches
-- below is defined (ported verbatim from the source, matching its own
-- "not wired to pg_cron" status) but never scheduled or invoked from this
-- repo -- defining a SQL function is not "live execution".
--
-- RLS judgment call (the real one for this slice): the source app locks
-- property_ingest entirely (no policies at all; every read goes through
-- property_api views this repo does not have). Slice 1 treated the
-- geography catalog as public reference data and gave `authenticated` a
-- blanket read policy. These tables are different in kind: they are raw
-- ingestion-pipeline internals -- scraped source URLs, retrieval leases,
-- worker error summaries, health-incident detail, raw candidate assessment
-- notes -- not reference data any ordinary signed-in user has a reason to
-- see, and some of it (source_documents/source URLs, decision_notes,
-- error_summary, raw batch/health payloads) could carry information about
-- how and from where Accountabul is scraping a jurisdiction that we would
-- not want exposed to every authenticated session. So: unlike Slice 1's
-- blanket authenticated-read, every table in this migration gets
-- SELECT restricted to `public.has_role(auth.uid(), 'admin')` (the same
-- admin-gate already used for property_owner_documents writes), with no
-- authenticated INSERT/UPDATE/DELETE policy anywhere -- all writes come from
-- a service-role connection (the ingestion pipeline itself), matching how
-- Slice 1 treated its immutable ledger tables. This is a real judgment call
-- and one later slice may want to revisit: once source_definitions/
-- ingestion_runs start carrying genuinely user-facing provenance ("this
-- report was built from St. Louis Sheriff's Office data retrieved on
-- 2026-09-01"), a narrower authenticated-read view (a property_api-style
-- projection, not raw table access) would be the right way to expose that
-- without granting blanket read access to internal ingestion mechanics.
-- Nothing in this repo today needs that, so it is not built here.

begin;

-- Content-addressed artifact storage -----------------------------------------
-- Supabase Storage equivalent of the source's Cloudflare R2 archive
-- (nationwide-r2-artifact-store.ts): scraped source documents/PDFs and
-- discovery/batch response JSON, keyed by a caller-supplied object key and
-- verified by SHA-256 (src/lib/property-intelligence/nationwide-supabase-artifact-store.ts).
-- Private bucket, no authenticated policy at all (unlike property-report-vault,
-- there is no per-user owner here to scope a read policy to -- these are raw
-- ingestion internals, service-role read/write only, consistent with this
-- migration's admin-only-read/service-role-write stance on every table above).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nationwide-source-artifacts',
  'nationwide-source-artifacts',
  false,
  52428800,
  array['application/json', 'application/pdf', 'text/csv', 'text/html', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do nothing;

-- source_definitions -----------------------------------------------------
create table property_ingest.source_definitions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  source_key text not null,
  contract_version integer not null check (contract_version > 0),
  publisher_name text not null,
  publishing_agency text,
  source_family text not null,
  asset_class text not null check (asset_class in ('real_property', 'personal_property', 'mixed')),
  landing_page_url text not null,
  retrieval_method text not null,
  source_format text not null check (
    source_format in ('api', 'csv', 'xlsx', 'pdf_text', 'pdf_ocr', 'html', 'manual_verified')
  ),
  parser_name text not null,
  parser_version text not null,
  mapping_schema jsonb not null default '{}'::jsonb,
  authoritative_identifier_types text[] not null default '{}'::text[],
  identity_establishment_mode text not null default 'match_only' check (
    identity_establishment_mode in ('match_only', 'single_authoritative_identifier')
  ),
  expected_update_frequency text,
  schedule_policy jsonb not null default '{"mode":"manual"}'::jsonb,
  scheduler_owner text,
  known_limitations text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    case schedule_policy->>'mode'
      when 'manual' then schedule_policy = '{"mode":"manual"}'::jsonb
      when 'interval' then
        case when
          schedule_policy->>'anchorUtc' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
          and schedule_policy->>'intervalMinutes' ~ '^[0-9]{1,6}$'
          and schedule_policy->>'catchUpLimit' ~ '^[0-9]{1,3}$'
        then
          (schedule_policy->>'anchorUtc')::timestamptz is not null
          and (schedule_policy->>'intervalMinutes')::integer between 15 and 525600
          and (schedule_policy->>'catchUpLimit')::integer between 1 and 100
        else false end
      else false
    end
  ),
  check (
    identity_establishment_mode = 'match_only'
    or (
      mapping_schema->>'recordLane' = 'property_record'
      and cardinality(authoritative_identifier_types) = 1
    )
  ),
  unique (jurisdiction_id, source_key, contract_version),
  unique (id, jurisdiction_id)
);

create index source_definitions_active_schedule_idx
  on property_ingest.source_definitions ((schedule_policy->>'mode'), source_key)
  where active;

-- source_candidates / source_candidate_assessments / *_fields ------------
create table property_ingest.source_candidates (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  candidate_key text not null check (candidate_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  discovered_by text not null check (btrim(discovered_by) <> ''),
  discovered_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, candidate_key),
  unique (id, jurisdiction_id)
);

create index source_candidates_jurisdiction_idx
  on property_ingest.source_candidates (jurisdiction_id, discovered_at, candidate_key);

create table property_ingest.source_candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references property_ingest.source_candidates (id),
  assessment_version integer not null check (assessment_version > 0),
  assessment_fingerprint text not null check (assessment_fingerprint ~ '^[0-9a-f]{64}$'),
  disposition text not null check (
    disposition in ('needs_review', 'qualified', 'rejected', 'retired')
  ),
  publisher_name text not null check (btrim(publisher_name) <> ''),
  publishing_agency text,
  source_family text not null check (btrim(source_family) <> ''),
  asset_class text not null check (asset_class in ('real_property', 'personal_property', 'mixed')),
  landing_page_url text not null check (landing_page_url ~ '^https?://[^[:space:]]+$'),
  official_source boolean not null,
  access_mode text not null check (
    access_mode in (
      'public', 'public_with_terms', 'authorized_export_required',
      'manual_verified', 'unavailable'
    )
  ),
  retrieval_method_hint text,
  source_format_hint text not null check (
    source_format_hint in (
      'unknown', 'api', 'csv', 'xlsx', 'pdf_text', 'pdf_ocr', 'html', 'manual_verified'
    )
  ),
  record_lane_hint text not null check (
    record_lane_hint in ('unknown', 'auction', 'property_record', 'mixed')
  ),
  expected_update_frequency text,
  terms_review_status text not null check (
    terms_review_status in ('not_started', 'approved', 'restricted', 'prohibited')
  ),
  structure_review_status text not null check (
    structure_review_status in ('not_started', 'sampled', 'mapped', 'incompatible')
  ),
  identity_review_status text not null check (
    identity_review_status in (
      'not_started', 'reviewed_match_only', 'reviewed_authoritative', 'insufficient'
    )
  ),
  field_inventory_count integer not null default 0 check (
    field_inventory_count >= 0 and field_inventory_count <= 5000
  ),
  sample_artifact_sha256 text check (
    sample_artifact_sha256 is null or sample_artifact_sha256 ~ '^[0-9a-f]{64}$'
  ),
  sample_object_storage_key text,
  sample_mime_type text,
  sample_byte_size bigint check (sample_byte_size is null or sample_byte_size >= 0),
  decision_notes text,
  assessed_by text not null check (btrim(assessed_by) <> ''),
  assessed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (candidate_id, assessment_version),
  unique (candidate_id, assessment_fingerprint),
  unique (candidate_id, id),
  check (
    (sample_artifact_sha256 is null
      and sample_object_storage_key is null
      and sample_mime_type is null
      and sample_byte_size is null)
    or
    (sample_artifact_sha256 is not null
      and btrim(sample_object_storage_key) <> ''
      and btrim(sample_mime_type) <> ''
      and sample_byte_size is not null)
  ),
  check (
    disposition not in ('rejected', 'retired')
    or btrim(decision_notes) <> ''
  ),
  check (
    disposition <> 'qualified'
    or (
      official_source
      and access_mode <> 'unavailable'
      and btrim(retrieval_method_hint) <> ''
      and source_format_hint <> 'unknown'
      and record_lane_hint in ('auction', 'property_record')
      and btrim(expected_update_frequency) <> ''
      and terms_review_status = 'approved'
      and structure_review_status = 'mapped'
      and identity_review_status in ('reviewed_match_only', 'reviewed_authoritative')
      and field_inventory_count > 0
      and sample_artifact_sha256 is not null
    )
  )
);

create index source_candidate_assessments_latest_idx
  on property_ingest.source_candidate_assessments (candidate_id, assessment_version desc);

create index source_candidate_assessments_qualified_idx
  on property_ingest.source_candidate_assessments (assessed_at, candidate_id)
  where disposition = 'qualified';

create table property_ingest.source_candidate_assessment_fields (
  assessment_id uuid not null references property_ingest.source_candidate_assessments (id),
  field_index integer not null check (field_index >= 0 and field_index < 5000),
  field_path text not null check (
    field_path ~ '^/([^/~]|~[01]|[*])+(/([^/~]|~[01]|[*])+)*$'
  ),
  published_label text,
  source_value_types text[] not null check (
    cardinality(source_value_types) between 1 and 6
    and source_value_types <@ array['null', 'object', 'array', 'string', 'number', 'boolean']::text[]
  ),
  semantic_role text not null check (
    semantic_role in (
      'source_identity', 'property_identifier', 'address', 'geography', 'party',
      'amount', 'event_date', 'status_lifecycle', 'legal_description',
      'property_attribute', 'source_metadata', 'parser_evidence', 'other'
    )
  ),
  mapping_decision text not null check (
    mapping_decision in ('unreviewed', 'core_field', 'extension_attribute', 'raw_only', 'ignored')
  ),
  destination_relation text,
  destination_field text,
  extension_key text,
  field_notes text,
  field_fingerprint text not null check (field_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (assessment_id, field_index),
  unique (assessment_id, field_path),
  check (published_label is null or btrim(published_label) <> ''),
  check (field_notes is null or btrim(field_notes) <> ''),
  check (extension_key is null or extension_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  check (
    (mapping_decision = 'core_field'
      and destination_relation ~ '^(property_core|property_ingest)[.][a-z][a-z0-9_]*$'
      and destination_field ~ '^[a-z][a-z0-9_]*$'
      and extension_key is null)
    or
    (mapping_decision = 'extension_attribute'
      and destination_relation is null
      and destination_field is null
      and extension_key is not null)
    or
    (mapping_decision in ('unreviewed', 'raw_only', 'ignored')
      and destination_relation is null
      and destination_field is null
      and extension_key is null)
  )
);

create index source_candidate_assessment_fields_concept_idx
  on property_ingest.source_candidate_assessment_fields (
    mapping_decision, semantic_role, destination_relation, destination_field, extension_key
  );

-- Ledger integrity: field_inventory_count on the assessment must always
-- equal the row count in its field inventory, and a "mapped"/"qualified"
-- assessment cannot leave any field unreviewed. Ported verbatim (logic
-- unchanged) except that this repo has no property_api schema, so the
-- destination_relation existence check is against property_core/property_ingest
-- columns only (the source checks the same two schemas).
create or replace function property_ingest.enforce_source_candidate_field_inventory()
returns trigger
language plpgsql
set search_path = pg_catalog, property_ingest
as $$
declare
  target_assessment_id uuid;
  assessment property_ingest.source_candidate_assessments%rowtype;
  actual_count integer;
  unreviewed_count integer;
begin
  target_assessment_id := coalesce(
    (to_jsonb(new) ->> 'assessment_id')::uuid,
    (to_jsonb(old) ->> 'assessment_id')::uuid,
    (to_jsonb(new) ->> 'id')::uuid,
    (to_jsonb(old) ->> 'id')::uuid
  );

  select * into strict assessment
  from property_ingest.source_candidate_assessments
  where id = target_assessment_id;

  select count(*)::integer,
         count(*) filter (where mapping_decision = 'unreviewed')::integer
  into actual_count, unreviewed_count
  from property_ingest.source_candidate_assessment_fields
  where assessment_id = target_assessment_id;

  if actual_count <> assessment.field_inventory_count then
    raise exception 'source candidate field inventory count does not match its assessment';
  end if;
  if exists (
    select 1
    from property_ingest.source_candidate_assessment_fields field
    where field.assessment_id = target_assessment_id
      and field.source_value_types <> array(
        select canonical.value_type
        from unnest(array['null', 'object', 'array', 'string', 'number', 'boolean']::text[])
          with ordinality as canonical(value_type, position)
        where canonical.value_type = any(field.source_value_types)
        order by canonical.position
      )
  ) then
    raise exception 'source candidate field value types must be unique and canonically ordered';
  end if;
  if exists (
    select 1
    from property_ingest.source_candidate_assessment_fields field
    left join information_schema.columns destination
      on destination.table_schema || '.' || destination.table_name = field.destination_relation
     and destination.column_name = field.destination_field
    where field.assessment_id = target_assessment_id
      and field.mapping_decision = 'core_field'
      and destination.column_name is null
  ) then
    raise exception 'source candidate core field destination does not exist';
  end if;
  if assessment.structure_review_status = 'mapped' and unreviewed_count <> 0 then
    raise exception 'mapped source candidate field inventory cannot contain unreviewed fields';
  end if;
  if assessment.disposition = 'qualified'
    and (actual_count = 0 or unreviewed_count <> 0) then
    raise exception 'qualified source candidate requires a complete reviewed field inventory';
  end if;
  return null;
end
$$;

revoke all on function property_ingest.enforce_source_candidate_field_inventory()
  from public, anon, authenticated, service_role;

create constraint trigger enforce_source_candidate_assessment_field_inventory
after insert or update of field_inventory_count, disposition, structure_review_status
on property_ingest.source_candidate_assessments
deferrable initially deferred
for each row execute function property_ingest.enforce_source_candidate_field_inventory();

create constraint trigger enforce_source_candidate_assessment_field_rows
after insert or update or delete on property_ingest.source_candidate_assessment_fields
deferrable initially deferred
for each row execute function property_ingest.enforce_source_candidate_field_inventory();

-- source_research_catalog_imports / entries -------------------------------
create table property_ingest.source_research_catalog_imports (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null check (catalog_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  catalog_version integer not null check (catalog_version > 0),
  catalog_fingerprint text not null check (catalog_fingerprint ~ '^[0-9a-f]{64}$'),
  prepared_by text not null check (btrim(prepared_by) <> ''),
  prepared_at timestamptz not null,
  entry_count integer not null check (entry_count between 1 and 10000),
  imported_by text not null check (btrim(imported_by) <> ''),
  imported_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (catalog_key, catalog_version),
  check (imported_at >= prepared_at)
);

create table property_ingest.source_research_catalog_entries (
  catalog_import_id uuid not null
    references property_ingest.source_research_catalog_imports (id),
  entry_index integer not null check (entry_index >= 0),
  candidate_id uuid not null references property_ingest.source_candidates (id),
  assessment_id uuid not null,
  entry_fingerprint text not null check (entry_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (catalog_import_id, entry_index),
  unique (catalog_import_id, candidate_id),
  unique (catalog_import_id, assessment_id),
  foreign key (candidate_id, assessment_id)
    references property_ingest.source_candidate_assessments (candidate_id, id)
);

create index source_research_catalog_entries_candidate_idx
  on property_ingest.source_research_catalog_entries (candidate_id, catalog_import_id);

create index source_research_catalog_entries_assessment_idx
  on property_ingest.source_research_catalog_entries (assessment_id, catalog_import_id);

create or replace function property_ingest.enforce_source_research_catalog_membership()
returns trigger
language plpgsql
set search_path = pg_catalog, property_ingest
as $$
declare
  import_id uuid;
  expected_count integer;
  observed_count integer;
  minimum_index integer;
  maximum_index integer;
begin
  if tg_table_name = 'source_research_catalog_imports' then
    import_id := new.id;
  else
    import_id := new.catalog_import_id;
  end if;
  select entry_count
  into strict expected_count
  from property_ingest.source_research_catalog_imports
  where id = import_id;
  select count(*)::integer, min(entry_index), max(entry_index)
  into observed_count, minimum_index, maximum_index
  from property_ingest.source_research_catalog_entries
  where catalog_import_id = import_id;
  if observed_count <> expected_count
    or minimum_index is distinct from 0
    or maximum_index is distinct from expected_count - 1 then
    raise exception 'source research catalog entries must completely match their declared count and order';
  end if;
  return new;
end
$$;

revoke all on function property_ingest.enforce_source_research_catalog_membership()
  from public, anon, authenticated, service_role;

create constraint trigger enforce_source_research_catalog_import_membership
after insert on property_ingest.source_research_catalog_imports
deferrable initially deferred
for each row execute function property_ingest.enforce_source_research_catalog_membership();

create constraint trigger enforce_source_research_catalog_entry_membership
after insert on property_ingest.source_research_catalog_entries
deferrable initially deferred
for each row execute function property_ingest.enforce_source_research_catalog_membership();

-- source_candidate_promotions ----------------------------------------------
create table property_ingest.source_candidate_promotions (
  candidate_id uuid primary key,
  assessment_id uuid not null unique,
  source_definition_id uuid not null unique,
  jurisdiction_id uuid not null,
  promoted_by text not null check (btrim(promoted_by) <> ''),
  promoted_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, jurisdiction_id)
    references property_ingest.source_candidates (id, jurisdiction_id),
  foreign key (candidate_id, assessment_id)
    references property_ingest.source_candidate_assessments (candidate_id, id),
  foreign key (source_definition_id, jurisdiction_id)
    references property_ingest.source_definitions (id, jurisdiction_id)
);

create or replace function property_ingest.enforce_source_candidate_promotion()
returns trigger
language plpgsql
set search_path = pg_catalog, property_ingest
as $$
declare
  assessment property_ingest.source_candidate_assessments%rowtype;
  definition property_ingest.source_definitions%rowtype;
  latest_version integer;
begin
  select *
  into strict assessment
  from property_ingest.source_candidate_assessments
  where candidate_id = new.candidate_id
    and id = new.assessment_id;

  select max(assessment_version)
  into latest_version
  from property_ingest.source_candidate_assessments
  where candidate_id = new.candidate_id;

  if assessment.disposition <> 'qualified'
    or assessment.assessment_version <> latest_version
    or assessment.field_inventory_count = 0 then
    raise exception 'source promotion requires the latest qualified candidate assessment with a reviewed field inventory';
  end if;

  if exists (
    select 1
    from property_ingest.source_candidate_assessment_fields field
    where field.assessment_id = assessment.id
      and field.mapping_decision = 'unreviewed'
  ) then
    raise exception 'source promotion requires a completely reviewed field inventory';
  end if;

  select *
  into strict definition
  from property_ingest.source_definitions
  where id = new.source_definition_id
    and jurisdiction_id = new.jurisdiction_id;

  if definition.active then
    raise exception 'a promoted source definition must remain inactive until activation gates pass';
  end if;

  if definition.publisher_name is distinct from assessment.publisher_name
    or definition.publishing_agency is distinct from assessment.publishing_agency
    or definition.source_family is distinct from assessment.source_family
    or definition.asset_class is distinct from assessment.asset_class
    or definition.landing_page_url is distinct from assessment.landing_page_url
    or definition.retrieval_method is distinct from assessment.retrieval_method_hint
    or definition.source_format is distinct from assessment.source_format_hint
    or definition.mapping_schema->>'recordLane' is distinct from assessment.record_lane_hint then
    raise exception 'source definition does not match its qualified candidate assessment';
  end if;

  return new;
end
$$;

revoke all on function property_ingest.enforce_source_candidate_promotion()
  from public, anon, authenticated, service_role;

create trigger enforce_source_candidate_promotion
before insert or update on property_ingest.source_candidate_promotions
for each row execute function property_ingest.enforce_source_candidate_promotion();

-- source_documents ---------------------------------------------------------
create table property_ingest.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  jurisdiction_id uuid not null references property_core.jurisdictions (id),
  source_url text not null,
  canonical_publication_url text,
  title text,
  sale_label text,
  coverage_start date,
  coverage_end date,
  published_at timestamptz,
  effective_at timestamptz,
  retrieved_at timestamptz not null,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  object_storage_key text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_document_id uuid references property_ingest.source_documents (id),
  retrieval_status text not null check (retrieval_status in ('succeeded', 'failed', 'partial')),
  retrieval_error text,
  created_at timestamptz not null default now(),
  check (coverage_end is null or coverage_start is null or coverage_end >= coverage_start),
  unique (source_definition_id, sha256)
);

-- ingestion_runs -------------------------------------------------------------
create table property_ingest.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  source_document_id uuid references property_ingest.source_documents (id),
  run_key text not null,
  scheduled_for timestamptz not null,
  attempt integer not null check (attempt > 0),
  mapping_version integer not null check (mapping_version > 0),
  initiated_by text not null,
  service_maximum integer not null check (service_maximum > 0),
  expected_set_fingerprint text not null check (expected_set_fingerprint ~ '^[0-9a-f]{64}$'),
  run_contract_fingerprint text not null check (run_contract_fingerprint ~ '^[0-9a-f]{64}$'),
  withdrawal_mode text not null check (withdrawal_mode in ('append_only', 'complete_snapshot')),
  discovery_status text not null check (discovery_status in ('succeeded', 'failed')),
  discovery_artifact_sha256 text check (discovery_artifact_sha256 is null or discovery_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  discovery_object_storage_key text,
  discovery_mime_type text,
  discovery_byte_size bigint check (discovery_byte_size is null or discovery_byte_size >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  retrieval_status text not null default 'pending' check (
    retrieval_status in ('pending', 'succeeded', 'failed', 'partial', 'skipped')
  ),
  parsing_status text not null default 'pending' check (
    parsing_status in ('pending', 'succeeded', 'failed', 'partial', 'skipped')
  ),
  normalization_status text not null default 'pending' check (
    normalization_status in ('pending', 'succeeded', 'failed', 'partial', 'skipped')
  ),
  resolution_status text not null default 'pending' check (
    resolution_status in ('pending', 'succeeded', 'failed', 'partial', 'skipped')
  ),
  rows_seen bigint not null default 0 check (rows_seen >= 0),
  rows_accepted bigint not null default 0 check (rows_accepted >= 0),
  rows_unchanged bigint not null default 0 check (rows_unchanged >= 0),
  rows_rejected bigint not null default 0 check (rows_rejected >= 0),
  rows_unresolved bigint not null default 0 check (rows_unresolved >= 0),
  rows_linked bigint not null default 0 check (rows_linked >= 0),
  source_reported_count bigint check (source_reported_count is null or source_reported_count >= 0),
  expected_unique_count bigint check (expected_unique_count is null or expected_unique_count >= 0),
  returned_unique_count bigint check (returned_unique_count is null or returned_unique_count >= 0),
  coverage_status text not null default 'pending' check (
    coverage_status in ('pending', 'complete', 'partial', 'failed', 'not_applicable')
  ),
  withdrawals_allowed boolean not null default false,
  run_parameters jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at),
  check (not withdrawals_allowed or (coverage_status = 'complete' and withdrawal_mode = 'complete_snapshot')),
  check (rows_accepted + rows_rejected <= rows_seen),
  check (
    (discovery_artifact_sha256 is null and discovery_object_storage_key is null and discovery_mime_type is null and discovery_byte_size is null)
    or
    (discovery_artifact_sha256 is not null and discovery_object_storage_key is not null and discovery_mime_type is not null and discovery_byte_size is not null)
  ),
  check (discovery_status = 'failed' or discovery_artifact_sha256 is not null),
  check (
    (lease_owner is null and lease_acquired_at is null and lease_expires_at is null)
    or
    (lease_owner is not null and lease_acquired_at is not null and lease_expires_at > lease_acquired_at)
  ),
  unique (source_definition_id, run_key),
  unique (source_definition_id, scheduled_for, attempt)
);

create index ingestion_runs_source_schedule_idx
  on property_ingest.ingestion_runs (source_definition_id, scheduled_for desc, attempt desc);

create index ingestion_runs_active_lease_idx
  on property_ingest.ingestion_runs (lease_expires_at)
  where completed_at is null and lease_owner is not null;

-- ingestion_dispatches --------------------------------------------------------
-- Supabase Cron (or another scheduler) would enqueue due slots here; nothing
-- in this repo schedules it (no pg_cron wiring), matching the hard constraint
-- against live execution for this slice.
create table property_ingest.ingestion_dispatches (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  scheduled_for timestamptz not null,
  attempt integer not null check (attempt > 0),
  status text not null default 'queued' check (
    status in ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')
  ),
  available_at timestamptz not null default now(),
  enqueued_at timestamptz not null default now(),
  claim_count integer not null default 0 check (claim_count >= 0),
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  ingestion_run_id uuid references property_ingest.ingestion_runs (id),
  retry_of_dispatch_id uuid references property_ingest.ingestion_dispatches (id),
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_at >= enqueued_at),
  check (completed_at is null or completed_at >= enqueued_at),
  check (
    (status = 'claimed' and lease_owner is not null and lease_acquired_at is not null and lease_expires_at > lease_acquired_at)
    or
    (status <> 'claimed' and lease_owner is null and lease_acquired_at is null and lease_expires_at is null)
  ),
  check (
    (status in ('succeeded', 'failed', 'cancelled') and completed_at is not null)
    or
    (status in ('queued', 'claimed') and completed_at is null)
  ),
  check (status <> 'succeeded' or ingestion_run_id is not null),
  check (status <> 'failed' or nullif(btrim(error_summary), '') is not null),
  check (retry_of_dispatch_id is null or attempt > 1),
  unique (source_definition_id, scheduled_for, attempt)
);

create index ingestion_dispatches_source_idx
  on property_ingest.ingestion_dispatches (source_definition_id, scheduled_for desc, attempt desc);

create index ingestion_dispatches_retry_of_idx
  on property_ingest.ingestion_dispatches (retry_of_dispatch_id)
  where retry_of_dispatch_id is not null;

create index ingestion_dispatches_ready_idx
  on property_ingest.ingestion_dispatches (available_at, scheduled_for, attempt, id)
  where status = 'queued';

create index ingestion_dispatches_expired_lease_idx
  on property_ingest.ingestion_dispatches (lease_expires_at, scheduled_for, attempt, id)
  where status = 'claimed';

-- Ported verbatim (logic unchanged) as a defined SQL function. It is not
-- scheduled by pg_cron and not invoked from any migration statement, route,
-- or cron in this repo -- defining it does not enqueue anything by itself.
create or replace function property_ingest.enqueue_due_ingestion_dispatches(
  p_now timestamptz default now()
)
returns table (
  dispatch_id uuid,
  source_definition_id uuid,
  source_key text,
  scheduled_for timestamptz,
  attempt integer
)
language sql
security invoker
set search_path = ''
as $function$
  with interval_sources as (
    select
      source.id,
      source.source_key,
      (source.schedule_policy->>'anchorUtc')::timestamptz as anchor_utc,
      (source.schedule_policy->>'intervalMinutes')::integer as interval_minutes,
      (source.schedule_policy->>'catchUpLimit')::integer as catch_up_limit
    from property_ingest.source_definitions source
    where source.active
      and source.schedule_policy->>'mode' = 'interval'
      and p_now >= (source.schedule_policy->>'anchorUtc')::timestamptz
  ),
  schedule_history as (
    select
      source.*,
      greatest(
        (
          select max(dispatch.scheduled_for)
          from property_ingest.ingestion_dispatches dispatch
          where dispatch.source_definition_id = source.id
        ),
        (
          select max(run.scheduled_for)
          from property_ingest.ingestion_runs run
          where run.source_definition_id = source.id
            and run.run_parameters->>'executionMode' = 'scheduled'
        )
      ) as last_scheduled_for
    from interval_sources source
  ),
  schedule_bounds as (
    select
      history.*,
      history.anchor_utc + make_interval(
        mins => (
          floor(
            extract(epoch from (p_now - history.anchor_utc))
            / (history.interval_minutes * 60)
          )::integer * history.interval_minutes
        )
      ) as latest_due,
      case
        when history.last_scheduled_for is null then
          history.anchor_utc + make_interval(
            mins => (
              floor(
                extract(epoch from (p_now - history.anchor_utc))
                / (history.interval_minutes * 60)
              )::integer * history.interval_minutes
            )
          )
        else history.last_scheduled_for + make_interval(mins => history.interval_minutes)
      end as first_due
    from schedule_history history
  ),
  due_slots as (
    select
      bounds.id as source_definition_id,
      bounds.source_key,
      bounds.first_due + make_interval(
        mins => slot.offset_number * bounds.interval_minutes
      ) as scheduled_for
    from schedule_bounds bounds
    cross join lateral generate_series(
      0,
      least(
        bounds.catch_up_limit - 1,
        floor(
          extract(epoch from (bounds.latest_due - bounds.first_due))
          / (bounds.interval_minutes * 60)
        )::integer
      )
    ) as slot(offset_number)
    where bounds.first_due <= bounds.latest_due
  ),
  inserted as (
    insert into property_ingest.ingestion_dispatches (
      source_definition_id, scheduled_for, attempt, status,
      available_at, enqueued_at
    )
    select source_definition_id, scheduled_for, 1, 'queued', p_now, p_now
    from due_slots
    on conflict (source_definition_id, scheduled_for, attempt) do nothing
    returning id, source_definition_id, scheduled_for, attempt
  )
  select
    inserted.id,
    inserted.source_definition_id,
    source.source_key,
    inserted.scheduled_for,
    inserted.attempt
  from inserted
  join property_ingest.source_definitions source
    on source.id = inserted.source_definition_id
  order by inserted.scheduled_for, source.source_key;
$function$;

revoke all on function property_ingest.enqueue_due_ingestion_dispatches(timestamptz)
  from public, anon, authenticated;
grant execute on function property_ingest.enqueue_due_ingestion_dispatches(timestamptz)
  to service_role;

-- ingestion_health_incidents / monitor_state / outbox -----------------------
create table property_ingest.ingestion_health_incidents (
  id uuid primary key default gen_random_uuid(),
  source_definition_id uuid not null references property_ingest.source_definitions (id),
  alert_code text not null check (alert_code in (
    'source_never_succeeded', 'source_overdue', 'dispatch_backlog',
    'dispatch_failed', 'dispatch_lease_expired', 'run_pending_stale',
    'run_lease_expired', 'latest_run_failed', 'latest_run_partial',
    'latest_run_rejections', 'withdrawals_suppressed'
  )),
  severity text not null check (severity in ('warning', 'critical')),
  observed text not null check (char_length(observed) between 1 and 500),
  expected text not null check (char_length(expected) between 1 and 500),
  opened_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  opened_snapshot_as_of timestamptz not null,
  last_snapshot_as_of timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, source_definition_id),
  check (last_observed_at >= opened_at),
  check (last_snapshot_as_of >= opened_snapshot_as_of),
  check (resolved_at is null or resolved_at >= last_observed_at)
);

create unique index ingestion_health_incidents_one_active_idx
  on property_ingest.ingestion_health_incidents (source_definition_id, alert_code)
  where resolved_at is null;

create index ingestion_health_incidents_source_history_idx
  on property_ingest.ingestion_health_incidents (source_definition_id, alert_code, opened_at desc);

create table property_ingest.ingestion_health_monitor_state (
  singleton boolean primary key default true check (singleton),
  last_snapshot_as_of timestamptz not null,
  updated_at timestamptz not null,
  check (updated_at >= last_snapshot_as_of)
);

create table property_ingest.ingestion_health_outbox (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null,
  source_definition_id uuid not null,
  transition text not null check (transition in ('opened', 'escalated', 'resolved')),
  alert_code text not null check (alert_code in (
    'source_never_succeeded', 'source_overdue', 'dispatch_backlog',
    'dispatch_failed', 'dispatch_lease_expired', 'run_pending_stale',
    'run_lease_expired', 'latest_run_failed', 'latest_run_partial',
    'latest_run_rejections', 'withdrawals_suppressed'
  )),
  severity text not null check (severity in ('warning', 'critical')),
  snapshot_as_of timestamptz not null,
  idempotency_key uuid not null default gen_random_uuid(),
  payload jsonb not null,
  status text not null default 'queued' check (
    status in ('queued', 'claimed', 'succeeded', 'failed')
  ),
  available_at timestamptz not null,
  enqueued_at timestamptz not null,
  claim_count integer not null default 0 check (claim_count >= 0),
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  provider_delivery_id text check (
    provider_delivery_id is null or char_length(provider_delivery_id) between 1 and 500
  ),
  error_summary text check (
    error_summary is null or char_length(error_summary) between 1 and 1000
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (incident_id, source_definition_id)
    references property_ingest.ingestion_health_incidents (id, source_definition_id),
  unique (idempotency_key),
  check (available_at >= enqueued_at),
  check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array[
      'incidentId', 'sourceDefinitionId', 'sourceKey', 'contractVersion',
      'stateCode', 'countyFips', 'transition', 'alertCode', 'severity',
      'observed', 'expected', 'snapshotAsOf'
    ]
  ),
  check (
    (status = 'claimed' and lease_owner is not null
      and lease_acquired_at is not null and lease_expires_at > lease_acquired_at)
    or
    (status <> 'claimed' and lease_owner is null
      and lease_acquired_at is null and lease_expires_at is null)
  ),
  check (
    (status in ('succeeded', 'failed') and completed_at is not null)
    or
    (status in ('queued', 'claimed') and completed_at is null)
  ),
  check (completed_at is null or completed_at >= enqueued_at),
  check (status <> 'succeeded' or error_summary is null),
  check (status <> 'failed' or nullif(btrim(error_summary), '') is not null),
  check (provider_delivery_id is null or status = 'succeeded')
);

create index ingestion_health_outbox_ready_idx
  on property_ingest.ingestion_health_outbox (available_at, enqueued_at, id)
  where status = 'queued';

create index ingestion_health_outbox_expired_lease_idx
  on property_ingest.ingestion_health_outbox (lease_expires_at, enqueued_at, id)
  where status = 'claimed';

create index ingestion_health_outbox_incident_idx
  on property_ingest.ingestion_health_outbox (incident_id, enqueued_at);

-- ingestion_batches / batch_members / batch_profiles / batch_field_profiles -
create table property_ingest.ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references property_ingest.ingestion_runs (id),
  batch_number integer not null check (batch_number > 0),
  requested_count integer not null check (requested_count >= 0),
  returned_count integer not null check (returned_count >= 0),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'partial')),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_fingerprint text not null check (result_fingerprint ~ '^[0-9a-f]{64}$'),
  response_artifact_sha256 text check (response_artifact_sha256 is null or response_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  response_object_storage_key text,
  response_mime_type text,
  response_byte_size bigint check (response_byte_size is null or response_byte_size >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  created_at timestamptz not null default now(),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (
    (response_artifact_sha256 is null and response_object_storage_key is null and response_mime_type is null and response_byte_size is null)
    or
    (response_artifact_sha256 is not null and response_object_storage_key is not null and response_mime_type is not null and response_byte_size is not null)
  ),
  check (status = 'failed' or response_artifact_sha256 is not null),
  unique (ingestion_run_id, batch_number)
);

create table property_ingest.ingestion_batch_members (
  id uuid primary key default gen_random_uuid(),
  ingestion_batch_id uuid not null references property_ingest.ingestion_batches (id),
  source_object_key text not null,
  requested boolean not null default false,
  returned_occurrences integer not null default 0 check (returned_occurrences >= 0),
  created_at timestamptz not null default now(),
  check (requested or returned_occurrences > 0),
  unique (ingestion_batch_id, source_object_key)
);

create table property_ingest.ingestion_batch_profiles (
  ingestion_batch_id uuid primary key references property_ingest.ingestion_batches (id),
  profiled_record_count integer not null check (profiled_record_count >= 0),
  excluded_key_count integer not null check (excluded_key_count >= 0),
  truncated_record_count integer not null check (
    truncated_record_count >= 0 and truncated_record_count <= profiled_record_count
  ),
  field_count integer not null check (field_count >= 0),
  profile_fingerprint text not null check (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table property_ingest.ingestion_batch_field_profiles (
  ingestion_batch_id uuid not null references property_ingest.ingestion_batches (id),
  field_path text not null check (
    field_path ~ '^/' and char_length(field_path) between 2 and 1000
  ),
  depth integer not null check (depth between 1 and 16),
  record_count integer not null check (record_count >= 0),
  occurrence_count integer not null check (occurrence_count >= record_count),
  null_count integer not null check (null_count >= 0),
  object_count integer not null check (object_count >= 0),
  array_count integer not null check (array_count >= 0),
  string_count integer not null check (string_count >= 0),
  number_count integer not null check (number_count >= 0),
  boolean_count integer not null check (boolean_count >= 0),
  numeric_string_count integer not null check (numeric_string_count between 0 and string_count),
  date_string_count integer not null check (date_string_count between 0 and string_count),
  date_time_string_count integer not null check (date_time_string_count between 0 and string_count),
  max_text_length integer check (max_text_length is null or max_text_length >= 0),
  max_array_length integer check (max_array_length is null or max_array_length >= 0),
  created_at timestamptz not null default now(),
  check (
    null_count + object_count + array_count + string_count + number_count + boolean_count
      = occurrence_count
  ),
  primary key (ingestion_batch_id, field_path)
);

-- snapshot_members / ingestion_rejections ------------------------------------
create table property_ingest.snapshot_members (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references property_ingest.ingestion_runs (id),
  source_object_key text not null,
  expected boolean not null default true,
  returned_occurrences integer not null default 0 check (returned_occurrences >= 0),
  created_at timestamptz not null default now(),
  unique (ingestion_run_id, source_object_key)
);

create index snapshot_members_coverage_idx
  on property_ingest.snapshot_members (ingestion_run_id, expected, returned_occurrences);

create table property_ingest.ingestion_rejections (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references property_ingest.ingestion_runs (id),
  ingestion_batch_id uuid references property_ingest.ingestion_batches (id),
  source_object_key text,
  record_locator text,
  raw_json jsonb not null,
  error_code text not null,
  error_message text not null check (char_length(error_message) between 1 and 1000),
  rejection_fingerprint text not null check (rejection_fingerprint ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (ingestion_run_id, rejection_fingerprint)
);

-- Access control -------------------------------------------------------------
-- Every table in this migration: no authenticated write policy at all (writes
-- are service-role only, same as Slice 1's ledger tables); SELECT is
-- restricted to admin, not blanket-authenticated (see header for why this
-- differs from Slice 1's geography catalog).
revoke all on property_ingest.source_definitions from public, anon, authenticated;
grant select on property_ingest.source_definitions to authenticated;
grant all on property_ingest.source_definitions to service_role;
alter table property_ingest.source_definitions enable row level security;
alter table property_ingest.source_definitions force row level security;
create policy source_definitions_admin_read
  on property_ingest.source_definitions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_candidates from public, anon, authenticated;
grant select on property_ingest.source_candidates to authenticated;
grant all on property_ingest.source_candidates to service_role;
alter table property_ingest.source_candidates enable row level security;
alter table property_ingest.source_candidates force row level security;
create policy source_candidates_admin_read
  on property_ingest.source_candidates for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_candidate_assessments from public, anon, authenticated;
grant select on property_ingest.source_candidate_assessments to authenticated;
grant all on property_ingest.source_candidate_assessments to service_role;
alter table property_ingest.source_candidate_assessments enable row level security;
alter table property_ingest.source_candidate_assessments force row level security;
create policy source_candidate_assessments_admin_read
  on property_ingest.source_candidate_assessments for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_candidate_assessment_fields from public, anon, authenticated;
grant select on property_ingest.source_candidate_assessment_fields to authenticated;
grant all on property_ingest.source_candidate_assessment_fields to service_role;
alter table property_ingest.source_candidate_assessment_fields enable row level security;
alter table property_ingest.source_candidate_assessment_fields force row level security;
create policy source_candidate_assessment_fields_admin_read
  on property_ingest.source_candidate_assessment_fields for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_research_catalog_imports from public, anon, authenticated;
grant select on property_ingest.source_research_catalog_imports to authenticated;
grant all on property_ingest.source_research_catalog_imports to service_role;
alter table property_ingest.source_research_catalog_imports enable row level security;
alter table property_ingest.source_research_catalog_imports force row level security;
create policy source_research_catalog_imports_admin_read
  on property_ingest.source_research_catalog_imports for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_research_catalog_entries from public, anon, authenticated;
grant select on property_ingest.source_research_catalog_entries to authenticated;
grant all on property_ingest.source_research_catalog_entries to service_role;
alter table property_ingest.source_research_catalog_entries enable row level security;
alter table property_ingest.source_research_catalog_entries force row level security;
create policy source_research_catalog_entries_admin_read
  on property_ingest.source_research_catalog_entries for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_candidate_promotions from public, anon, authenticated;
grant select on property_ingest.source_candidate_promotions to authenticated;
grant all on property_ingest.source_candidate_promotions to service_role;
alter table property_ingest.source_candidate_promotions enable row level security;
alter table property_ingest.source_candidate_promotions force row level security;
create policy source_candidate_promotions_admin_read
  on property_ingest.source_candidate_promotions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.source_documents from public, anon, authenticated;
grant select on property_ingest.source_documents to authenticated;
grant all on property_ingest.source_documents to service_role;
alter table property_ingest.source_documents enable row level security;
alter table property_ingest.source_documents force row level security;
create policy source_documents_admin_read
  on property_ingest.source_documents for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_runs from public, anon, authenticated;
grant select on property_ingest.ingestion_runs to authenticated;
grant all on property_ingest.ingestion_runs to service_role;
alter table property_ingest.ingestion_runs enable row level security;
alter table property_ingest.ingestion_runs force row level security;
create policy ingestion_runs_admin_read
  on property_ingest.ingestion_runs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_dispatches from public, anon, authenticated;
grant select on property_ingest.ingestion_dispatches to authenticated;
grant all on property_ingest.ingestion_dispatches to service_role;
alter table property_ingest.ingestion_dispatches enable row level security;
alter table property_ingest.ingestion_dispatches force row level security;
create policy ingestion_dispatches_admin_read
  on property_ingest.ingestion_dispatches for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_health_incidents from public, anon, authenticated;
grant select on property_ingest.ingestion_health_incidents to authenticated;
grant all on property_ingest.ingestion_health_incidents to service_role;
alter table property_ingest.ingestion_health_incidents enable row level security;
alter table property_ingest.ingestion_health_incidents force row level security;
create policy ingestion_health_incidents_admin_read
  on property_ingest.ingestion_health_incidents for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_health_monitor_state from public, anon, authenticated;
grant select on property_ingest.ingestion_health_monitor_state to authenticated;
grant all on property_ingest.ingestion_health_monitor_state to service_role;
alter table property_ingest.ingestion_health_monitor_state enable row level security;
alter table property_ingest.ingestion_health_monitor_state force row level security;
create policy ingestion_health_monitor_state_admin_read
  on property_ingest.ingestion_health_monitor_state for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_health_outbox from public, anon, authenticated;
grant select on property_ingest.ingestion_health_outbox to authenticated;
grant all on property_ingest.ingestion_health_outbox to service_role;
alter table property_ingest.ingestion_health_outbox enable row level security;
alter table property_ingest.ingestion_health_outbox force row level security;
create policy ingestion_health_outbox_admin_read
  on property_ingest.ingestion_health_outbox for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_batches from public, anon, authenticated;
grant select on property_ingest.ingestion_batches to authenticated;
grant all on property_ingest.ingestion_batches to service_role;
alter table property_ingest.ingestion_batches enable row level security;
alter table property_ingest.ingestion_batches force row level security;
create policy ingestion_batches_admin_read
  on property_ingest.ingestion_batches for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_batch_members from public, anon, authenticated;
grant select on property_ingest.ingestion_batch_members to authenticated;
grant all on property_ingest.ingestion_batch_members to service_role;
alter table property_ingest.ingestion_batch_members enable row level security;
alter table property_ingest.ingestion_batch_members force row level security;
create policy ingestion_batch_members_admin_read
  on property_ingest.ingestion_batch_members for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_batch_profiles from public, anon, authenticated;
grant select on property_ingest.ingestion_batch_profiles to authenticated;
grant all on property_ingest.ingestion_batch_profiles to service_role;
alter table property_ingest.ingestion_batch_profiles enable row level security;
alter table property_ingest.ingestion_batch_profiles force row level security;
create policy ingestion_batch_profiles_admin_read
  on property_ingest.ingestion_batch_profiles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_batch_field_profiles from public, anon, authenticated;
grant select on property_ingest.ingestion_batch_field_profiles to authenticated;
grant all on property_ingest.ingestion_batch_field_profiles to service_role;
alter table property_ingest.ingestion_batch_field_profiles enable row level security;
alter table property_ingest.ingestion_batch_field_profiles force row level security;
create policy ingestion_batch_field_profiles_admin_read
  on property_ingest.ingestion_batch_field_profiles for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.snapshot_members from public, anon, authenticated;
grant select on property_ingest.snapshot_members to authenticated;
grant all on property_ingest.snapshot_members to service_role;
alter table property_ingest.snapshot_members enable row level security;
alter table property_ingest.snapshot_members force row level security;
create policy snapshot_members_admin_read
  on property_ingest.snapshot_members for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on property_ingest.ingestion_rejections from public, anon, authenticated;
grant select on property_ingest.ingestion_rejections to authenticated;
grant all on property_ingest.ingestion_rejections to service_role;
alter table property_ingest.ingestion_rejections enable row level security;
alter table property_ingest.ingestion_rejections force row level security;
create policy ingestion_rejections_admin_read
  on property_ingest.ingestion_rejections for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));


commit;
