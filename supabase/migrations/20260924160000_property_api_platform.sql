-- Property Intelligence public API + SDK: sandbox key issuance, sliding-
-- window rate limiting, and per-request usage logging. Ported from
-- property-intelligence-app's `propertyApiKeys` / `propertyApiRateLimits` /
-- `propertyApiUsageEvents` (Cloudflare D1) onto Postgres. The source's fourth
-- table, `propertyApiRequests`, already has an accountabul-final equivalent
-- from Phase 5: public.property_api_access_requests
-- (20260924120000_property_api_access_requests.sql) -- not duplicated here.
-- Status: schema only, matching every prior Property Intelligence phase in
-- this repo -- migration file only, not applied to the live Supabase project
-- (PRODUCTION_PROJECT_REF) from this session; src/integrations/supabase/types.ts
-- is hand-updated to match (same convention as commit 863ec99, "Type Phase
-- 3/5 Supabase clients against generated schema").
--
-- Data-source scope: the public API route this migration backs
-- (src/routes/api/public/property-intelligence.v1.parcels.ts) reads only
-- property_intel_parcels / property_intel_profiles (Phase 2's already-shipped
-- St. Louis workspace). It does NOT read property_core/property_ingest (the
-- nationwide ingestion schema from Slices 1-3), which has no populated data
-- path yet -- mirroring the source app's own "three-tier feed fallback
-- chain" philosophy of only ever serving what is actually resolvable today.
--
-- RLS judgment calls:
--   * property_api_keys is user-owned (like property_analysis_threads):
--     owner INSERT/SELECT, plus a narrow owner UPDATE policy that can only
--     ever flip status active -> revoked. A `before update` trigger
--     (enforce_property_api_key_immutable_fields) additionally blocks that
--     UPDATE grant from being used to rewrite key_hash/key_prefix/label/
--     scopes/user_id/created_at -- without it, the owner-revoke UPDATE policy
--     would let an account silently retarget its own key_hash to a value of
--     its choosing, which is a real "self-mint a colliding credential" hole,
--     not just tidiness. The same trigger also allows a bare last_used_at
--     bump (the service-role usage path from the public API route) to pass
--     through untouched.
--   * A quota + access-request-approval gate (enforce_property_api_key_quota,
--     mirroring property_analysis_threads' advisory-lock quota trigger) runs
--     before every insert: a user with no approved
--     property_api_access_requests row, or already at
--     PROPERTY_API_MAX_ACTIVE_KEYS (3) active keys, cannot mint another key --
--     enforced at the database level, not just in the server function.
--   * property_api_rate_limits is pure internal sliding-window counters, not
--     scoped to an authenticated identity beyond an opaque key_id and useless
--     to expose to any client: no `authenticated` policy at all (matching
--     Slice 2's operational-table stance), service-role only.
--   * property_api_usage_events is owner-readable (a user can see their own
--     key's request history) but insert/update/delete is service-role only --
--     it is written by the public API route's admin client, never by an
--     authenticated session (the caller of that route authenticates with a
--     bearer API key, not a Supabase session).

begin;

create table public.property_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 60),
  key_prefix text not null unique check (key_prefix ~ '^acct_test_[a-f0-9]{24}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  scopes text[] not null default array['properties:read']::text[],
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (cardinality(scopes) > 0 and scopes <@ array['properties:read']::text[]),
  check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);
create index property_api_keys_owner_status_idx
  on public.property_api_keys (user_id, status, created_at desc);

revoke all on public.property_api_keys from public, anon, authenticated;
grant select, insert, update on public.property_api_keys to authenticated;
grant all on public.property_api_keys to service_role;
alter table public.property_api_keys enable row level security;
alter table public.property_api_keys force row level security;

create policy property_api_keys_owner_insert
  on public.property_api_keys for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active' and revoked_at is null);

create policy property_api_keys_owner_read
  on public.property_api_keys for select to authenticated
  using (user_id = (select auth.uid()));

-- Owner may only ever flip an active key of their own to revoked; the
-- immutable-fields trigger below closes the rest of the gap.
create policy property_api_keys_owner_revoke
  on public.property_api_keys for update to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()) and status = 'revoked' and revoked_at is not null);

create or replace function public.enforce_property_api_key_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 2));
  if not exists (
    select 1 from public.property_api_access_requests r
    where r.user_id = new.user_id and r.status = 'approved'
  ) then
    raise exception 'property_api_key_requires_approved_access_request' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.property_api_keys
    where user_id = new.user_id and status = 'active'
  ) >= 3 then
    raise exception 'property_api_key_quota_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_property_api_key_quota() from public, anon, authenticated;
create trigger property_api_keys_quota
  before insert on public.property_api_keys
  for each row execute function public.enforce_property_api_key_quota();

-- Runs on every UPDATE regardless of role: lets the public API route's
-- service-role client bump last_used_at freely, and lets the owner-revoke
-- RLS policy above flip status active -> revoked, but nothing else -- no
-- update path, owner or service role, can rewrite key_hash/key_prefix/
-- label/scopes/user_id/created_at.
create or replace function public.enforce_property_api_key_immutable_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.label is distinct from old.label
    or new.key_prefix is distinct from old.key_prefix
    or new.key_hash is distinct from old.key_hash
    or new.scopes is distinct from old.scopes
    or new.created_at is distinct from old.created_at
  then
    raise exception 'property_api_key_update_forbidden_field' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'active' or new.status <> 'revoked' or new.revoked_at is null then
      raise exception 'property_api_key_update_must_be_a_plain_revoke' using errcode = 'P0001';
    end if;
  elsif new.revoked_at is distinct from old.revoked_at then
    raise exception 'property_api_key_update_must_be_a_plain_revoke' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_property_api_key_immutable_fields()
  from public, anon, authenticated;
create trigger property_api_keys_immutable_fields
  before update on public.property_api_keys
  for each row execute function public.enforce_property_api_key_immutable_fields();

-- Sliding-window request counters, one row per (key, 60-second window
-- boundary). Pure internal bookkeeping: service-role only, no authenticated
-- policy at all.
create table public.property_api_rate_limits (
  key_id uuid not null references public.property_api_keys(id) on delete cascade,
  window_started_at bigint not null check (window_started_at > 0),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (key_id, window_started_at)
);
create index property_api_rate_limits_window_idx
  on public.property_api_rate_limits (window_started_at);

revoke all on public.property_api_rate_limits from public, anon, authenticated;
grant all on public.property_api_rate_limits to service_role;
alter table public.property_api_rate_limits enable row level security;
alter table public.property_api_rate_limits force row level security;

-- Atomic reserve-or-reject for one request against the sliding window,
-- mirroring the source's D1 `batch()` (INSERT OR IGNORE + bounded UPDATE ...
-- RETURNING) as a single round trip. Executed only by the service-role
-- connection the public API route uses (service_role already bypasses RLS,
-- so this does not need to be SECURITY DEFINER).
create or replace function public.property_api_reserve_rate_limit(
  p_key_id uuid,
  p_window_started_at bigint,
  p_limit integer
) returns table (allowed boolean, request_count integer)
language plpgsql
set search_path = ''
as $$
declare
  updated_count integer;
  existing_count integer;
begin
  insert into public.property_api_rate_limits (key_id, window_started_at, request_count)
  values (p_key_id, p_window_started_at, 0)
  on conflict (key_id, window_started_at) do nothing;

  update public.property_api_rate_limits
  set request_count = request_count + 1
  where key_id = p_key_id
    and window_started_at = p_window_started_at
    and request_count < p_limit
  returning public.property_api_rate_limits.request_count into updated_count;

  if updated_count is null then
    select r.request_count into existing_count
    from public.property_api_rate_limits r
    where r.key_id = p_key_id and r.window_started_at = p_window_started_at;
    return query select false, coalesce(existing_count, p_limit);
  end if;

  return query select true, updated_count;
end;
$$;
revoke all on function public.property_api_reserve_rate_limit(uuid, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.property_api_reserve_rate_limit(uuid, bigint, integer)
  to service_role;

-- Per-request usage log, one row per API request (success or failure).
create table public.property_api_usage_events (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.property_api_keys(id) on delete cascade,
  request_id text not null unique check (request_id ~ '^req_[0-9a-f-]{36}$'),
  route text not null check (length(route) between 1 and 200),
  status_code integer not null check (status_code between 100 and 599),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  rate_limited boolean not null default false,
  created_at timestamptz not null default now()
);
create index property_api_usage_events_key_created_idx
  on public.property_api_usage_events (key_id, created_at desc);

revoke all on public.property_api_usage_events from public, anon, authenticated;
grant select on public.property_api_usage_events to authenticated;
grant all on public.property_api_usage_events to service_role;
alter table public.property_api_usage_events enable row level security;
alter table public.property_api_usage_events force row level security;

create policy property_api_usage_events_owner_read
  on public.property_api_usage_events for select to authenticated
  using (
    exists (
      select 1 from public.property_api_keys k
      where k.id = key_id and k.user_id = (select auth.uid())
    )
  );

commit;
