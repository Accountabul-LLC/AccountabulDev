-- Property Intelligence Phase 2 (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md):
-- address-first analysis workspace, ported from property-intelligence-app's
-- `properties` / `property_profiles` / `analysis_threads` (D1) onto Postgres.
-- Table names are prefixed `property_intel_*` because `public.properties`
-- already names Accountabul's own business-listing table.

-- One row per official St. Louis Assessor parcel (canonical, not user-scoped).
create table public.property_intel_parcels (
  id uuid primary key default gen_random_uuid(),
  asr_parcel_id text not null check (asr_parcel_id ~ '^\d{11}$'),
  current_address text,
  match_status text not null default 'parcel-id-verified'
    check (match_status in ('parcel-id-verified', 'address-matched', 'ambiguous')),
  last_intelligence_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asr_parcel_id)
);

-- 1:1 Assessor dossier snapshot for a parcel, refreshed when stale (>6h).
create table public.property_intel_profiles (
  parcel_id uuid primary key references public.property_intel_parcels(id) on delete cascade,
  lot_square_feet integer,
  ward integer,
  tax_balance numeric,
  prior_tax_amount numeric,
  property_class_code integer,
  is_tax_abated boolean,
  abatement_start_year integer,
  abatement_end_year integer,
  web_mercator_x double precision,
  web_mercator_y double precision,
  city_block numeric,
  parcel_number numeric,
  owner_name text,
  owner_name_2 text,
  legal_description text,
  assessor_class_code text,
  land_use_code text,
  vacant_lot boolean,
  number_of_units integer,
  number_of_apartments integer,
  frontage_feet numeric,
  land_area numeric,
  assessed_land_value numeric,
  assessed_improvement_value numeric,
  assessed_total_value numeric,
  appraised_land_value numeric,
  appraised_improvement_value numeric,
  zoning text,
  residential_building_count integer,
  commercial_building_count integer,
  first_year_built integer,
  last_year_built integer,
  last_residential_sale_price numeric,
  last_residential_sale_date timestamptz,
  vacant_building_year integer,
  neighborhood_code text,
  zip_code text,
  owner_occupied boolean,
  assessor_handle text,
  source_url text not null,
  observed_at timestamptz not null default now()
);

-- The user-facing "workspace": one permanent named thread per (user, parcel).
create table public.property_analysis_threads (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.property_intel_parcels(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 240),
  status text not null default 'new' check (status in ('new', 'in_progress', 'analyzed', 'report_downloaded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, parcel_id)
);
create index property_analysis_threads_user_recent_idx
  on public.property_analysis_threads (user_id, updated_at desc)
  where deleted_at is null;

-- Canonical parcel + Assessor dossier are shared reference data: readable by
-- any signed-in account (same access model as the records search), written
-- only by the service role that runs the ArcGIS resolver.
revoke all on public.property_intel_parcels from public, anon, authenticated;
grant select on public.property_intel_parcels to authenticated;
grant all on public.property_intel_parcels to service_role;
alter table public.property_intel_parcels enable row level security;
create policy property_intel_parcels_authenticated_read on public.property_intel_parcels
  for select to authenticated using (true);

revoke all on public.property_intel_profiles from public, anon, authenticated;
grant select on public.property_intel_profiles to authenticated;
grant all on public.property_intel_profiles to service_role;
alter table public.property_intel_profiles enable row level security;
create policy property_intel_profiles_authenticated_read on public.property_intel_profiles
  for select to authenticated using (true);

-- Analysis threads are the user's own workspace: owner-only read/delete, like
-- property_deal_scenarios. Inserts/updates go through a server function so the
-- title and status transitions stay server-controlled.
revoke all on public.property_analysis_threads from public, anon, authenticated;
grant select, delete on public.property_analysis_threads to authenticated;
grant all on public.property_analysis_threads to service_role;
alter table public.property_analysis_threads enable row level security;
create policy property_analysis_threads_owner_read on public.property_analysis_threads
  for select to authenticated using (user_id = (select auth.uid()));
create policy property_analysis_threads_owner_delete on public.property_analysis_threads
  for delete to authenticated using (user_id = (select auth.uid()));

-- Same quota pattern as property_deal_scenarios (ACC-20260923-003): cap
-- workspaces per account so an authenticated loop cannot grow this table
-- unbounded.
create or replace function public.enforce_property_analysis_thread_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1));
  if (select count(*) from public.property_analysis_threads
      where user_id = new.user_id and deleted_at is null) >= 200 then
    raise exception 'property_analysis_thread_quota_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_property_analysis_thread_quota() from public, anon, authenticated;
create trigger property_analysis_threads_quota
  before insert on public.property_analysis_threads
  for each row execute function public.enforce_property_analysis_thread_quota();
