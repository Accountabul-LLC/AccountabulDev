-- Accountabul Live, Gate 4: hop-on alerts.
-- Stores per-user alert preferences and a delivery ledger so re-running
-- "go live" never alerts the same person twice on the same channel.

create table if not exists public.live_alert_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_opt_in boolean not null default true,
  -- SMS is off unless the person explicitly turns it on. Never inferred.
  sms_opt_in boolean not null default false,
  sms_phone text,
  updated_at timestamptz not null default now(),
  constraint live_alert_preferences_phone_e164
    check (sms_phone is null or sms_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Cannot opt into SMS without a deliverable number.
  constraint live_alert_preferences_sms_needs_phone
    check (sms_opt_in = false or sms_phone is not null)
);

create type public.live_alert_channel as enum ('in_app', 'email', 'sms');
-- A scheduled announcement and the go-live alert are separate deliveries.
create type public.live_alert_kind as enum ('scheduled', 'live');
create type public.live_alert_status as enum ('queued', 'sent', 'failed', 'suppressed');

create table if not exists public.live_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel public.live_alert_channel not null,
  kind public.live_alert_kind not null default 'live',
  status public.live_alert_status not null default 'queued',
  error_detail text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  -- The dedupe guarantee.
  unique (event_id, user_id, channel, kind)
);

create index if not exists live_alert_deliveries_user_unread_idx
  on public.live_alert_deliveries (user_id, created_at desc)
  where channel = 'in_app';

alter table public.live_alert_preferences enable row level security;
alter table public.live_alert_deliveries enable row level security;

-- People manage only their own alert preferences.
create policy live_alert_preferences_select_own
  on public.live_alert_preferences for select
  using (auth.uid() = user_id);

create policy live_alert_preferences_insert_own
  on public.live_alert_preferences for insert
  with check (auth.uid() = user_id);

create policy live_alert_preferences_update_own
  on public.live_alert_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliveries are readable by their recipient and by operators. They are only
-- ever written by the service role during go live, so there is no write policy.
create policy live_alert_deliveries_select_own
  on public.live_alert_deliveries for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

grant select, insert, update on public.live_alert_preferences to authenticated;
grant select on public.live_alert_deliveries to authenticated;
