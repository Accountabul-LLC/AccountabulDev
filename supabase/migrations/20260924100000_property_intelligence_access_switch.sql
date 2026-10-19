-- ACC-20260923-004: Property Intelligence defaults to active-membership-only
-- access, with an owner-flippable switch to open it to any signed-in account,
-- plus an allowlist for granting specific non-member accounts access at any
-- time. Mirrors the existing events.access_mode / membership_subscriptions
-- pattern (src/lib/conference/entitlements.ts) rather than inventing a new one.

create table public.property_intelligence_settings (
  id boolean primary key default true check (id),
  access_mode text not null default 'members' check (access_mode in ('members', 'open')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.property_intelligence_settings (id) values (true);

-- Readable by any signed-in account (the page needs to know the current mode
-- to explain why it's gated); writes go through the service role only, via
-- the ops route, so a client can never flip its own access on.
revoke all on public.property_intelligence_settings from public, anon, authenticated;
grant select on public.property_intelligence_settings to authenticated;
grant all on public.property_intelligence_settings to service_role;
alter table public.property_intelligence_settings enable row level security;
create policy property_intelligence_settings_authenticated_read
  on public.property_intelligence_settings for select to authenticated using (true);

-- Individual grants always allow access, independent of access_mode or
-- membership status — the "grant access to people at any time" allowlist.
create table public.property_intelligence_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 240)
);

-- A user may see whether *they* have a grant (so the UI can explain it);
-- only the service role (ops route) may write one.
revoke all on public.property_intelligence_access_grants from public, anon, authenticated;
grant select on public.property_intelligence_access_grants to authenticated;
grant all on public.property_intelligence_access_grants to service_role;
alter table public.property_intelligence_access_grants enable row level security;
create policy property_intelligence_access_grants_own_read
  on public.property_intelligence_access_grants for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(auth.uid(), 'admin'));
