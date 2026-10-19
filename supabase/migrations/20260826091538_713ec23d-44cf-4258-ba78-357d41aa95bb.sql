-- Forward-only least-privilege correction for the applied conference/payment chain.
-- This migration changes grants only; it does not recreate schema objects or modify data.

revoke select on table public.billing_customers from authenticated;
grant select (id, user_id, provider, created_at, updated_at)
  on table public.billing_customers to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.billing_customers from anon, authenticated;
grant all on table public.billing_customers to service_role;

revoke select on table public.membership_subscriptions from authenticated;
grant select (
  id, user_id, tier_key, status, cancel_at_period_end,
  current_period_start, current_period_end, grace_expires_at,
  canceled_at, created_at, updated_at
) on table public.membership_subscriptions to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.membership_subscriptions from anon, authenticated;
grant all on table public.membership_subscriptions to service_role;

revoke select on table public.payment_records from authenticated;
grant select (
  id, kind, user_id, event_id, amount_minor, refunded_amount_minor,
  currency, status, paid_at, created_at, updated_at
) on table public.payment_records to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.payment_records from anon, authenticated;
grant all on table public.payment_records to service_role;

revoke select on table public.event_passes from authenticated;
grant select (
  id, event_id, user_id, status, activated_at, expires_at,
  created_at, updated_at
) on table public.event_passes to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.event_passes from anon, authenticated;
grant all on table public.event_passes to service_role;

revoke select on table public.speaker_requests from authenticated;
grant select (
  id, event_id, user_id, topic, status, reviewed_at,
  guest_link_expires_at, created_at, updated_at
) on table public.speaker_requests to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.speaker_requests from anon, authenticated;
grant all on table public.speaker_requests to service_role;

revoke all on table public.paid_comments from anon, authenticated;
grant all on table public.paid_comments to service_role;

revoke all on table public.stripe_catalog_items from anon, authenticated;
grant all on table public.stripe_catalog_items to service_role;

revoke all on function public.has_active_membership(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.has_active_membership(uuid, timestamptz) to service_role;

revoke all on function public.has_event_pass(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.has_event_pass(uuid, uuid, timestamptz) to service_role;

revoke all on function public.private_get_provider_connection(text, text) from public, anon, authenticated;
grant execute on function public.private_get_provider_connection(text, text) to service_role;

revoke all on function public.private_upsert_provider_connection(text, text, text, text, text, text, text, timestamptz, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.private_upsert_provider_connection(text, text, text, text, text, text, text, timestamptz, timestamptz, text[]) to service_role;

revoke all on function public.private_create_provider_oauth_state(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.private_create_provider_oauth_state(text, text, text, timestamptz) to service_role;

revoke all on function public.private_consume_provider_oauth_state(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.private_consume_provider_oauth_state(text, text, timestamptz) to service_role;