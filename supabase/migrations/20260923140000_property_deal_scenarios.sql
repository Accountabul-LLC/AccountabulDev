-- Property Intelligence: saved Deal Analyst scenarios, ported from property-intelligence-app
-- (D1 deal_scenarios). Results are always recomputed server-side; the client never writes them.

create table public.property_deal_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 160),
  property_address text check (property_address is null or length(property_address) <= 240),
  parcel_id text check (parcel_id is null or length(parcel_id) <= 64),
  record_id text check (record_id is null or length(record_id) <= 128),
  calculation_version integer not null,
  inputs jsonb not null check (pg_column_size(inputs) <= 65536),
  results jsonb not null check (pg_column_size(results) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index property_deal_scenarios_user_idx
  on public.property_deal_scenarios (user_id, updated_at desc);

-- Default privileges no longer grant anything (20260919130000); name the grants explicitly.
revoke all on public.property_deal_scenarios from public, anon, authenticated;
grant select, delete on public.property_deal_scenarios to authenticated;
grant all on public.property_deal_scenarios to service_role;
alter table public.property_deal_scenarios enable row level security;

create policy property_deal_scenarios_owner_read on public.property_deal_scenarios
  for select to authenticated using (user_id = (select auth.uid()));
create policy property_deal_scenarios_owner_delete on public.property_deal_scenarios
  for delete to authenticated using (user_id = (select auth.uid()));
