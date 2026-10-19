-- ACC-20260919-005 / 006 / 007 / 008
-- Live catalog drifted: anon and authenticated received TRUNCATE/DELETE/INSERT
-- on hop-on alert tables. TRUNCATE is not filtered by RLS. Put the grants and
-- policies back to the committed surface, force RLS, and pin the append-only
-- trigger search_path.

revoke all on table public.live_alert_preferences from public, anon, authenticated;
revoke all on table public.live_alert_deliveries from public, anon, authenticated;

grant select, insert, update on table public.live_alert_preferences to authenticated;
grant select on table public.live_alert_deliveries to authenticated;

drop policy if exists live_alert_preferences_select_own on public.live_alert_preferences;
drop policy if exists live_alert_preferences_insert_own on public.live_alert_preferences;
drop policy if exists live_alert_preferences_update_own on public.live_alert_preferences;
drop policy if exists live_alert_deliveries_select_own on public.live_alert_deliveries;

create policy live_alert_preferences_select_own
  on public.live_alert_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy live_alert_preferences_insert_own
  on public.live_alert_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy live_alert_preferences_update_own
  on public.live_alert_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy live_alert_deliveries_select_own
  on public.live_alert_deliveries
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or public.has_role((select auth.uid()), 'admin')
  );

alter table public.live_alert_preferences force row level security;
alter table public.live_alert_deliveries force row level security;
alter table public.payment_records force row level security;
alter table public.billing_customers force row level security;
alter table public.tips force row level security;
alter table public.event_passes force row level security;
alter table public.membership_subscriptions force row level security;
alter table public.paid_comments force row level security;

create or replace function private.community_moderation_actions_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'community_moderation_actions is append-only';
end;
$$;
