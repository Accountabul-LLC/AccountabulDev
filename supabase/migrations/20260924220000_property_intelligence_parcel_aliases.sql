-- Parcel aliases, ported from property-intelligence-app's D1 property_aliases
-- table (written by app/lib/property-repository.ts).
--
-- A parcel is canonically identified by its 11-digit ASR parcel ID. An alias
-- is any OTHER string a source published for the same parcel -- most often an
-- address, sometimes an agency handle. Keeping them is what lets a later
-- lookup by a published address resolve to the canonical parcel instead of
-- creating a second identity for the same property, and it records which
-- source asserted the alias, so a bad alias can be traced back rather than
-- silently polluting resolution.
--
-- Aliases are additive and never rewritten in place: the unique constraint
-- makes a repeat assertion a no-op rather than an update, so the first source
-- to assert an alias stays recorded as its origin.

create table public.property_intel_parcel_aliases (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.property_intel_parcels(id) on delete cascade,
  alias_type text not null check (alias_type in ('address', 'handle', 'asr-parcel-id')),
  alias_value text not null check (length(alias_value) between 1 and 500),
  source_key text not null check (length(source_key) between 1 and 120),
  confidence numeric not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (parcel_id, alias_type, alias_value)
);
create index property_intel_parcel_aliases_lookup_idx
  on public.property_intel_parcel_aliases (alias_type, lower(alias_value));

revoke all on public.property_intel_parcel_aliases from public, anon, authenticated;
grant select on public.property_intel_parcel_aliases to authenticated;
grant all on public.property_intel_parcel_aliases to service_role;
alter table public.property_intel_parcel_aliases enable row level security;
create policy property_intel_parcel_aliases_authenticated_read
  on public.property_intel_parcel_aliases for select to authenticated using (true);
