-- Property Intelligence dossier: the events and provenance side of the
-- parcel record, ported from property-intelligence-app's D1 schema
-- (properties / source_records / property_events / sync_runs /
-- unmatched_records) behind app/lib/property-repository.ts.
--
-- 20260923160000 already added property_intel_parcels (canonical parcel
-- identity, with last_intelligence_sync_at for the six-hour freshness policy)
-- and property_intel_profiles (the Assessor snapshot). Those cover the
-- source's `properties` table, so this migration adds only what was missing:
-- the raw city records, the timeline built from them, the per-source sync
-- provenance, and the quarantine for records that came back for a different
-- parcel than the one requested.
--
-- Refactor note: the source keys these rows by synthetic strings
-- ("stl:<parcel>", "event:<sourceKey>:<id>") because D1 has no convenient
-- UUID default. Here identity is carried by real unique constraints on the
-- natural keys -- (source_key, source_record_id) -- with uuid primary keys,
-- which gets the same idempotent upsert behavior without the string
-- concatenation. Nothing about which record is "the same record" changes.
--
-- Provenance is deliberately preserved rather than collapsed: match_method,
-- match_confidence and verification_status travel with every record, and a
-- source that returns zero rows is still recorded as a completed sync run, so
-- "no records" is stored as source coverage rather than as proof that nothing
-- ever happened.

alter table public.property_intel_parcels
  add column if not exists handle text,
  add column if not exists intelligence_schema_version integer not null default 2;

-- Raw city records, one row per (source, record) pair the adapter matched to
-- this parcel by exact 11-digit ASR parcel ID.
create table public.property_intel_source_records (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.property_intel_parcels(id) on delete cascade,
  source_key text not null check (length(source_key) between 1 and 120),
  source_record_id text not null check (length(source_record_id) between 1 and 200),
  record_type text not null check (length(record_type) between 1 and 200),
  occurred_at text,
  status text,
  actor_name text,
  contractor_name text,
  description text,
  amount numeric,
  address text,
  asr_parcel_id text not null check (asr_parcel_id ~ '^\d{11}$'),
  handle text,
  source_url text not null,
  raw_json jsonb not null,
  match_method text not null default 'asr-parcel-id',
  match_confidence numeric not null default 1 check (match_confidence between 0 and 1),
  verification_status text not null default 'official-record',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_key, source_record_id)
);
create index property_intel_source_records_parcel_idx
  on public.property_intel_source_records (parcel_id, source_key);

-- One timeline event per source record (1:1 in the source app too).
create table public.property_intel_events (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.property_intel_parcels(id) on delete cascade,
  source_record_id uuid not null unique
    references public.property_intel_source_records(id) on delete cascade,
  event_type text not null,
  occurred_at text,
  recorded_at timestamptz not null default now(),
  title text,
  summary text,
  actor_name text,
  verification_status text not null default 'official-record',
  provenance_type text not null default 'city-public-data'
);
create index property_intel_events_parcel_order_idx
  on public.property_intel_events (parcel_id, occurred_at desc, recorded_at desc);

-- Append-only per-source sync provenance. A zero-record success is still a row.
create table public.property_intel_sync_runs (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.property_intel_parcels(id) on delete cascade,
  source_key text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  status text not null check (status in ('success', 'failed')),
  records_seen integer not null default 0 check (records_seen >= 0),
  records_upserted integer not null default 0 check (records_upserted >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  error text,
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (status <> 'failed' or nullif(btrim(error), '') is not null)
);
create index property_intel_sync_runs_parcel_started_idx
  on public.property_intel_sync_runs (parcel_id, started_at desc);

-- Quarantine: a record the source returned whose parcel ID did not equal the
-- one requested is never adopted onto the parcel, but it is not discarded
-- either -- it is kept here with the reason so the mismatch stays auditable.
create table public.property_intel_unmatched_records (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_record_id text not null,
  supplied_parcel_id text,
  address text,
  reason text not null,
  raw_json jsonb not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_key, source_record_id)
);
create index property_intel_unmatched_open_idx
  on public.property_intel_unmatched_records (supplied_parcel_id)
  where resolved_at is null;

-- Access: same stance as property_intel_parcels/profiles -- these are public
-- city records, readable by any authenticated session (the members-only gate
-- lives on the Property Intelligence route itself), written only by the
-- service-role sync path. No authenticated write policy exists on any of them.
revoke all on public.property_intel_source_records from public, anon, authenticated;
grant select on public.property_intel_source_records to authenticated;
grant all on public.property_intel_source_records to service_role;
alter table public.property_intel_source_records enable row level security;
create policy property_intel_source_records_authenticated_read
  on public.property_intel_source_records for select to authenticated using (true);

revoke all on public.property_intel_events from public, anon, authenticated;
grant select on public.property_intel_events to authenticated;
grant all on public.property_intel_events to service_role;
alter table public.property_intel_events enable row level security;
create policy property_intel_events_authenticated_read
  on public.property_intel_events for select to authenticated using (true);

revoke all on public.property_intel_sync_runs from public, anon, authenticated;
grant select on public.property_intel_sync_runs to authenticated;
grant all on public.property_intel_sync_runs to service_role;
alter table public.property_intel_sync_runs enable row level security;
create policy property_intel_sync_runs_authenticated_read
  on public.property_intel_sync_runs for select to authenticated using (true);

-- The quarantine can carry a raw payload from a mismatched parcel, so it is
-- admin-only rather than blanket authenticated read.
revoke all on public.property_intel_unmatched_records from public, anon, authenticated;
grant select on public.property_intel_unmatched_records to authenticated;
grant all on public.property_intel_unmatched_records to service_role;
alter table public.property_intel_unmatched_records enable row level security;
create policy property_intel_unmatched_records_admin_read
  on public.property_intel_unmatched_records for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
