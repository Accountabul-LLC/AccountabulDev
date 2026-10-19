-- Evening assessment hardening. Tighten only.

alter table public.tips
  add column if not exists guest_display_name text,
  add column if not exists message_sha256 text,
  add column if not exists quote_expires_at timestamptz,
  add column if not exists deposit_address text;

create unique index if not exists tips_deposit_address_idx
  on public.tips (deposit_address)
  where deposit_address is not null;

create unique index if not exists payment_records_crypto_tx_idx
  on public.payment_records (provider, crypto_transaction_id)
  where crypto_transaction_id is not null;

revoke insert, update, delete on public.business_policies from anon;

create schema if not exists private;

create or replace function private.role_held(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role and revoked_at is null
  );
$$;

revoke all on function private.role_held(uuid, public.app_role) from public, anon, authenticated;

create or replace function private.subject_is_self_or_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() is not distinct from 'service_role'
    or (
      auth.role() is not distinct from 'authenticated'
      and (
        _user_id is not distinct from auth.uid()
        or private.role_held(auth.uid(), 'admin')
      )
    );
$$;

revoke all on function private.subject_is_self_or_admin(uuid) from public, anon, authenticated;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and private.role_held(_user_id, _role);
$$;

create or replace function public.is_business_member(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and exists (
    select 1 from public.business_members
    where business_id = _business_id
      and user_id = _user_id
      and invitation_status = 'active'
  );
$$;

create or replace function public.is_business_owner(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and exists (
    select 1 from public.business_members
    where business_id = _business_id
      and user_id = _user_id
      and invitation_status = 'active'
      and membership_role = 'owner'
  );
$$;

create or replace function public.can_manage_business(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and exists (
    select 1 from public.business_members
    where business_id = _business_id
      and user_id = _user_id
      and invitation_status = 'active'
      and membership_role in ('owner', 'manager')
  );
$$;

create or replace function public.is_chat_banned(_event_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and exists (
    select 1 from public.chat_moderation_actions a
    where a.target_user_id = _user_id
      and a.action = 'ban'
      and (a.event_id is null or a.event_id = _event_id)
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

create or replace function public.get_my_business_profile(p_business_id uuid)
returns setof public.businesses
language sql
stable
security definer
set search_path = public
as $$
  select b.*
  from public.businesses b
  where b.id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    );
$$;

drop policy if exists tips_read on public.tips;
create policy tips_read on public.tips
for select to authenticated
using (
  from_user_id = auth.uid()
  or (to_business_id is not null and public.can_manage_business(to_business_id, auth.uid()))
  or public.has_role(auth.uid(), 'admin')
);

create table if not exists private.rate_limits (
  rate_key text primary key,
  hit_count integer not null,
  reset_at timestamptz not null
);

alter table private.rate_limits enable row level security;
revoke all on table private.rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_ms integer)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = private, public
as $$
declare
  rec private.rate_limits%rowtype;
  now_ts timestamptz := clock_timestamp();
begin
  insert into private.rate_limits(rate_key, hit_count, reset_at)
  values (p_key, 1, now_ts + make_interval(secs => p_window_ms::numeric / 1000))
  on conflict (rate_key) do update
    set hit_count = case
      when private.rate_limits.reset_at <= now_ts then 1
      else private.rate_limits.hit_count + 1
    end,
    reset_at = case
      when private.rate_limits.reset_at <= now_ts then now_ts + make_interval(secs => p_window_ms::numeric / 1000)
      else private.rate_limits.reset_at
    end
  returning * into rec;

  if rec.hit_count <= p_limit then
    return query select true, 0;
  else
    return query select false, greatest(1, ceil(extract(epoch from (rec.reset_at - now_ts))))::integer;
  end if;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
