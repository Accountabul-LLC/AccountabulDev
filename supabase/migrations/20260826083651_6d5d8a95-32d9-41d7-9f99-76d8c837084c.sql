-- Conference room, billing, moderation, and provider contracts.
--
-- This migration intentionally contains no production Stripe or Restream values.
-- Provider credentials remain deployment secrets; this schema only stores stable
-- provider identifiers and secret-reference names used by server-side workers.

create type public.event_access_mode as enum ('public', 'subscriber', 'subscriber_or_pass');
create type public.membership_subscription_status as enum (
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused'
);
create type public.payment_kind as enum ('membership', 'event_pass', 'paid_comment', 'tip');
create type public.payment_status as enum (
  'created',
  'requires_action',
  'processing',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'canceled'
);
create type public.event_pass_status as enum ('pending', 'active', 'refunded', 'revoked', 'expired');
create type public.moderation_status as enum ('pending', 'approved', 'quarantined', 'rejected');
create type public.chat_source as enum (
  'accountabul',
  'paid_guest',
  'restream',
  'youtube',
  'facebook',
  'linkedin',
  'twitch',
  'x'
);
create type public.chat_badge as enum (
  'accountabul_member',
  'event_guest',
  'moderator',
  'paid_guest',
  'external'
);
create type public.paid_comment_status as enum (
  'screening',
  'awaiting_moderator',
  'approved',
  'checkout_created',
  'paid',
  'published',
  'rejected',
  'payment_failed',
  'refunded',
  'expired'
);
create type public.speaker_request_status as enum (
  'pending',
  'approved',
  'rejected',
  'link_issued',
  'expired',
  'revoked'
);
create type public.provider_health_status as enum ('healthy', 'degraded', 'offline', 'unknown');

alter table public.events
  add column access_mode public.event_access_mode not null default 'public',
  add column pass_price_minor bigint check (pass_price_minor is null or pass_price_minor > 0),
  add column pass_currency text not null default 'USD',
  add column stripe_product_id text,
  add column stripe_price_id text,
  add column restream_event_id text,
  add column speaker_requests_enabled boolean not null default false,
  add column replay_available_at timestamptz;

create unique index events_restream_event_idx
  on public.events (restream_event_id)
  where restream_event_id is not null;

-- Never expose provider or playback identifiers through the public events table.
-- Playback URLs are returned by a server endpoint after entitlement evaluation.
revoke select on public.events from anon, authenticated;
grant select (
  id,
  slug,
  title,
  description,
  host_business_id,
  scheduled_start_at,
  actual_start_at,
  ended_at,
  status,
  chat_enabled,
  tips_enabled,
  cover_path,
  created_at,
  updated_at,
  access_mode,
  pass_price_minor,
  pass_currency,
  speaker_requests_enabled,
  replay_available_at
) on public.events to anon, authenticated;

create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_account_id text not null,
  stripe_customer_id text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, stripe_account_id),
  unique (stripe_account_id, stripe_customer_id)
);
revoke select on public.billing_customers from authenticated;
grant select (id, user_id, provider, created_at, updated_at)
  on public.billing_customers to authenticated;
grant all on public.billing_customers to service_role;
alter table public.billing_customers enable row level security;
create policy billing_customers_own_read on public.billing_customers
  for select to authenticated using (user_id = auth.uid());
create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row execute function public.set_updated_at();

create table public.membership_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_customer_id uuid not null references public.billing_customers(id) on delete cascade,
  stripe_account_id text not null,
  stripe_subscription_id text not null,
  stripe_product_id text not null,
  stripe_price_id text not null,
  tier_key text not null,
  status public.membership_subscription_status not null,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_expires_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_account_id, stripe_subscription_id)
);
revoke select on public.membership_subscriptions from authenticated;
grant select (
  id,
  user_id,
  tier_key,
  status,
  cancel_at_period_end,
  current_period_start,
  current_period_end,
  grace_expires_at,
  canceled_at,
  created_at,
  updated_at
) on public.membership_subscriptions to authenticated;
grant all on public.membership_subscriptions to service_role;
alter table public.membership_subscriptions enable row level security;
create policy membership_subscriptions_own_read on public.membership_subscriptions
  for select to authenticated using (user_id = auth.uid());
create index membership_subscriptions_entitlement_idx
  on public.membership_subscriptions (user_id, status, grace_expires_at, current_period_end);
create trigger membership_subscriptions_set_updated_at
  before update on public.membership_subscriptions
  for each row execute function public.set_updated_at();

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  kind public.payment_kind not null,
  provider text not null,
  provider_account_id text,
  user_id uuid references auth.users(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  tip_id uuid references public.tips(id) on delete set null,
  stripe_customer_id text,
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  crypto_transaction_id text,
  amount_minor bigint not null check (amount_minor > 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0),
  currency text not null,
  status public.payment_status not null default 'created',
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (refunded_amount_minor <= amount_minor)
);
revoke select on public.payment_records from authenticated;
grant select (
  id,
  kind,
  user_id,
  event_id,
  amount_minor,
  refunded_amount_minor,
  currency,
  status,
  paid_at,
  created_at,
  updated_at
) on public.payment_records to authenticated;
grant all on public.payment_records to service_role;
alter table public.payment_records enable row level security;
create policy payment_records_own_read on public.payment_records
  for select to authenticated using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
  );
create unique index payment_records_checkout_session_idx
  on public.payment_records (provider, provider_account_id, checkout_session_id)
  where checkout_session_id is not null;
create unique index payment_records_payment_intent_idx
  on public.payment_records (provider, provider_account_id, payment_intent_id)
  where payment_intent_id is not null;
create index payment_records_user_created_idx on public.payment_records (user_id, created_at desc);
create index payment_records_event_created_idx on public.payment_records (event_id, created_at desc);
create trigger payment_records_set_updated_at
  before update on public.payment_records
  for each row execute function public.set_updated_at();

create table public.stripe_catalog_items (
  id uuid primary key default gen_random_uuid(),
  kind public.payment_kind not null check (kind in ('membership', 'paid_comment')),
  catalog_key text not null,
  billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  stripe_account_id text not null,
  stripe_product_id text not null,
  stripe_price_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'membership' and billing_interval is not null)
    or (kind = 'paid_comment' and billing_interval is null)
  )
);
grant all on public.stripe_catalog_items to service_role;
alter table public.stripe_catalog_items enable row level security;
create unique index stripe_catalog_items_key_interval_idx
  on public.stripe_catalog_items (stripe_account_id, kind, catalog_key, coalesce(billing_interval, 'once'));
create unique index stripe_catalog_items_price_idx
  on public.stripe_catalog_items (stripe_account_id, stripe_price_id);
create trigger stripe_catalog_items_set_updated_at
  before update on public.stripe_catalog_items
  for each row execute function public.set_updated_at();

create table public.event_passes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  purchaser_email text,
  payment_record_id uuid not null references public.payment_records(id) on delete restrict,
  status public.event_pass_status not null default 'pending',
  access_token_hash text unique,
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or purchaser_email is not null)
);
revoke select on public.event_passes from authenticated;
grant select (
  id,
  event_id,
  user_id,
  status,
  activated_at,
  expires_at,
  created_at,
  updated_at
) on public.event_passes to authenticated;
grant all on public.event_passes to service_role;
alter table public.event_passes enable row level security;
create policy event_passes_own_read on public.event_passes
  for select to authenticated using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
  );
create unique index event_passes_user_active_idx
  on public.event_passes (event_id, user_id)
  where user_id is not null and status = 'active';
create index event_passes_event_status_idx on public.event_passes (event_id, status, expires_at);
create trigger event_passes_set_updated_at
  before update on public.event_passes
  for each row execute function public.set_updated_at();

create table public.community_standards_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body_markdown text not null,
  is_active boolean not null default false,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.community_standards_versions to anon, authenticated;
grant all on public.community_standards_versions to service_role;
alter table public.community_standards_versions enable row level security;
create policy community_standards_public_read on public.community_standards_versions
  for select to anon, authenticated using (is_active = true);

create table public.paid_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  guest_display_name text not null,
  guest_email text not null,
  body text not null check (char_length(body) between 1 and 500),
  body_sha256 text not null,
  standards_version_id uuid not null references public.community_standards_versions(id) on delete restrict,
  status public.paid_comment_status not null default 'screening',
  automated_moderation jsonb not null default '{}'::jsonb,
  moderator_user_id uuid references auth.users(id) on delete set null,
  moderator_note text,
  moderated_at timestamptz,
  approved_body_sha256 text,
  payment_record_id uuid references public.payment_records(id) on delete set null,
  chat_message_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_body_sha256 is null or approved_body_sha256 = body_sha256)
);
grant all on public.paid_comments to service_role;
alter table public.paid_comments enable row level security;
create index paid_comments_moderation_queue_idx on public.paid_comments (event_id, status, created_at);
create index paid_comments_payment_idx on public.paid_comments (payment_record_id)
  where payment_record_id is not null;
create trigger paid_comments_set_updated_at
  before update on public.paid_comments
  for each row execute function public.set_updated_at();

create table public.speaker_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 500),
  status public.speaker_request_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  guest_link_token_hash text,
  guest_link_ciphertext text,
  guest_link_iv text,
  guest_link_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
revoke select on public.speaker_requests from authenticated;
grant select (
  id,
  event_id,
  user_id,
  topic,
  status,
  reviewed_at,
  guest_link_expires_at,
  created_at,
  updated_at
) on public.speaker_requests to authenticated;
grant all on public.speaker_requests to service_role;
alter table public.speaker_requests enable row level security;
create policy speaker_requests_own_read on public.speaker_requests
  for select to authenticated using (
    user_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
  );
create index speaker_requests_queue_idx on public.speaker_requests (event_id, status, created_at);
create trigger speaker_requests_set_updated_at
  before update on public.speaker_requests
  for each row execute function public.set_updated_at();

create table public.provider_health (
  provider text primary key,
  status public.provider_health_status not null default 'unknown',
  last_connected_at timestamptz,
  last_event_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant all on public.provider_health to service_role;
alter table public.provider_health enable row level security;
create policy provider_health_ops_read on public.provider_health
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'moderator')
  );

-- Normalize first-party, paid-guest, and Restream messages into one contract.
alter table public.chat_messages
  alter column user_id drop not null,
  alter column user_id drop default,
  add column source public.chat_source not null default 'accountabul',
  add column external_id text,
  add column author_display_name text,
  add column author_avatar_url text,
  add column author_badge public.chat_badge,
  add column moderation_status public.moderation_status not null default 'pending',
  add column content_sha256 text,
  add column source_created_at timestamptz,
  add column published_at timestamptz;

-- Existing first-party chat was already public under the previous policy. Preserve
-- visible messages and keep previously hidden messages out of the new timeline.
update public.chat_messages
set
  source = 'accountabul',
  moderation_status = (case when is_hidden then 'rejected' else 'approved' end)::public.moderation_status,
  source_created_at = created_at,
  published_at = case when is_hidden then null else created_at end;

alter table public.paid_comments
  add constraint paid_comments_chat_message_fk
  foreign key (chat_message_id) references public.chat_messages(id) on delete set null;

create unique index chat_messages_source_dedupe_idx
  on public.chat_messages (event_id, source, external_id)
  where external_id is not null;
create index chat_messages_public_timeline_idx
  on public.chat_messages (event_id, published_at, created_at)
  where moderation_status = 'approved' and is_hidden = false;
create index chat_messages_moderation_queue_idx
  on public.chat_messages (event_id, moderation_status, created_at);

revoke insert, update, delete on public.chat_messages from anon, authenticated;
revoke select on public.chat_messages from authenticated;
grant select (
  id,
  event_id,
  user_id,
  body,
  kind,
  is_hidden,
  created_at,
  source,
  external_id,
  author_display_name,
  author_avatar_url,
  author_badge,
  source_created_at,
  published_at
) on public.chat_messages to anon, authenticated;
drop policy if exists chat_messages_read on public.chat_messages;
drop policy if exists chat_messages_update_mod on public.chat_messages;
create policy chat_messages_public_read on public.chat_messages
  for select to anon, authenticated using (
    is_hidden = false and moderation_status = 'approved' and published_at is not null
  );

alter table public.payment_events
  add column payment_record_id uuid references public.payment_records(id) on delete set null,
  add column provider_account_id text,
  add column livemode boolean,
  add column processing_error text,
  add column attempt_count integer not null default 1 check (attempt_count > 0);
create index payment_events_unprocessed_idx
  on public.payment_events (provider, created_at)
  where processed_at is null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('sandbox', 'live')),
  external_account_id text,
  secret_reference text not null,
  webhook_secret_reference text,
  access_token_ciphertext text,
  access_token_iv text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment)
);
grant all on private.provider_connections to service_role;
alter table private.provider_connections enable row level security;

create table private.provider_oauth_states (
  state_sha256 text primary key,
  provider text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
grant all on private.provider_oauth_states to service_role;
alter table private.provider_oauth_states enable row level security;
create index provider_oauth_states_expiry_idx on private.provider_oauth_states (expires_at);

create or replace function public.private_get_provider_connection(
  p_provider text,
  p_environment text
)
returns table (
  access_token_ciphertext text,
  access_token_iv text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  access_token_expires_at timestamptz
)
language sql
security definer
set search_path = private, public
as $$
  select
    connection.access_token_ciphertext,
    connection.access_token_iv,
    connection.refresh_token_ciphertext,
    connection.refresh_token_iv,
    connection.access_token_expires_at
  from private.provider_connections connection
  where connection.provider = p_provider
    and connection.environment = p_environment
    and connection.enabled = true
  limit 1;
$$;
revoke all on function public.private_get_provider_connection(text, text)
  from public, anon, authenticated;
grant execute on function public.private_get_provider_connection(text, text) to service_role;

create or replace function public.private_upsert_provider_connection(
  p_provider text,
  p_environment text,
  p_secret_reference text,
  p_access_token_ciphertext text,
  p_access_token_iv text,
  p_refresh_token_ciphertext text,
  p_refresh_token_iv text,
  p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns void
language sql
security definer
set search_path = private, public
as $$
  insert into private.provider_connections (
    provider, environment, secret_reference, enabled,
    access_token_ciphertext, access_token_iv,
    refresh_token_ciphertext, refresh_token_iv,
    access_token_expires_at, refresh_token_expires_at, granted_scopes
  ) values (
    p_provider, p_environment, p_secret_reference, true,
    p_access_token_ciphertext, p_access_token_iv,
    p_refresh_token_ciphertext, p_refresh_token_iv,
    p_access_token_expires_at, p_refresh_token_expires_at, p_granted_scopes
  )
  on conflict (provider, environment) do update set
    secret_reference = excluded.secret_reference,
    enabled = true,
    access_token_ciphertext = excluded.access_token_ciphertext,
    access_token_iv = excluded.access_token_iv,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    refresh_token_iv = excluded.refresh_token_iv,
    access_token_expires_at = excluded.access_token_expires_at,
    refresh_token_expires_at = excluded.refresh_token_expires_at,
    granted_scopes = excluded.granted_scopes,
    updated_at = now();
$$;
revoke all on function public.private_upsert_provider_connection(
  text, text, text, text, text, text, text, timestamptz, timestamptz, text[]
) from public, anon, authenticated;
grant execute on function public.private_upsert_provider_connection(
  text, text, text, text, text, text, text, timestamptz, timestamptz, text[]
) to service_role;

create or replace function public.private_create_provider_oauth_state(
  p_state_sha256 text,
  p_provider text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = private, public
as $$
  insert into private.provider_oauth_states (state_sha256, provider, redirect_uri, expires_at)
  values (p_state_sha256, p_provider, p_redirect_uri, p_expires_at);
$$;
revoke all on function public.private_create_provider_oauth_state(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_create_provider_oauth_state(text, text, text, timestamptz)
  to service_role;

create or replace function public.private_consume_provider_oauth_state(
  p_state_sha256 text,
  p_provider text,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = private, public
as $$
declare
  result text;
begin
  delete from private.provider_oauth_states state
  where state.state_sha256 = p_state_sha256
    and state.provider = p_provider
    and state.expires_at > p_now
  returning state.redirect_uri into result;
  return result;
end;
$$;
revoke all on function public.private_consume_provider_oauth_state(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.private_consume_provider_oauth_state(text, text, timestamptz)
  to service_role;

create or replace function public.has_active_membership(p_user_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.membership_subscriptions subscription
    where subscription.user_id = p_user_id
      and (
        subscription.status in ('active', 'trialing')
        or (
          subscription.status = 'past_due'
          and subscription.grace_expires_at is not null
          and subscription.grace_expires_at > p_at
        )
      )
      and (
        subscription.current_period_end is null
        or subscription.current_period_end > p_at
        or subscription.status = 'past_due'
      )
  );
$$;
revoke all on function public.has_active_membership(uuid, timestamptz) from public;
grant execute on function public.has_active_membership(uuid, timestamptz) to service_role;

create or replace function public.has_event_pass(p_event_id uuid, p_user_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_passes pass
    where pass.event_id = p_event_id
      and pass.user_id = p_user_id
      and pass.status = 'active'
      and (pass.expires_at is null or pass.expires_at > p_at)
  );
$$;
revoke all on function public.has_event_pass(uuid, uuid, timestamptz) from public;
grant execute on function public.has_event_pass(uuid, uuid, timestamptz) to service_role;

-- Supabase Realtime reads publication changes; no objects in the managed realtime
-- schema are modified. The guard makes local resets and branch previews repeatable.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;

insert into public.community_standards_versions (
  version,
  title,
  body_markdown,
  is_active,
  published_at
) values (
  '2026-08-26',
  'Accountabul Community Standards',
  E'Participate in good faith. Do not post threats, harassment, hateful conduct, sexual exploitation, self-harm encouragement, spam, fraud, doxxing, or illegal content. Comments may be delayed or withheld for safety review. Paid comments purchase review and placement eligibility, not guaranteed publication.',
  true,
  now()
);