-- Per-event configurable pricing for live-event access.
--
-- Extends the existing Stripe integration rather than replacing it: this adds
-- no new Stripe concepts. Checkout for these amounts uses the same inline
-- price_data mechanism already used for tips (see createVariableAmountCheckout
-- in src/lib/billing/checkout.server.ts), so Ops never has to mint a Stripe
-- Product or Price to change a number here — Stripe only ever sees "charge $X
-- for this Checkout Session," and this table is what says which event and
-- which access type that money bought.
--
-- The existing stripe_product_id / stripe_price_id / pass_price_minor /
-- pass_currency columns on events, and the event_pass Stripe-catalog branch in
-- /api/internal/ops/catalog, are left in place for backward compatibility.
-- They are no longer read by the checkout path this migration supports.

alter table public.events
  add column if not exists watch_price_minor integer,
  add column if not exists watch_and_chat_price_minor integer,
  add column if not exists guest_comment_price_minor integer,
  add column if not exists allow_watch_purchase boolean not null default false,
  add column if not exists allow_watch_and_chat_purchase boolean not null default false,
  add column if not exists allow_guest_comment boolean not null default false,
  add column if not exists pricing_currency text not null default 'USD';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_watch_price_nonneg'
  ) then
    alter table public.events
      add constraint events_watch_price_nonneg check (watch_price_minor is null or watch_price_minor >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'events_watch_chat_price_nonneg'
  ) then
    alter table public.events
      add constraint events_watch_chat_price_nonneg check (
        watch_and_chat_price_minor is null or watch_and_chat_price_minor >= 0
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'events_guest_comment_price_nonneg'
  ) then
    alter table public.events
      add constraint events_guest_comment_price_nonneg check (
        guest_comment_price_minor is null or guest_comment_price_minor >= 0
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'events_pricing_currency_format'
  ) then
    alter table public.events
      add constraint events_pricing_currency_format check (pricing_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.events.watch_price_minor is
  'Configurable per-event watch-only price. Null = not offered (allow_watch_purchase governs whether it is sold at all). 0 = free: still creates an access record, no Stripe.';
comment on column public.events.watch_and_chat_price_minor is
  'Configurable per-event watch + unlimited chat price. Null = not offered. 0 = free.';
comment on column public.events.guest_comment_price_minor is
  'Configurable per-event one-time guest comment price. Null = guest comments not sold for this event. 0 = free (still authorizes and records the comment, no Stripe).';

grant select (
  watch_price_minor,
  watch_and_chat_price_minor,
  guest_comment_price_minor,
  allow_watch_purchase,
  allow_watch_and_chat_purchase,
  allow_guest_comment,
  pricing_currency
) on public.events to anon, authenticated;

-- What an event_passes row actually grants. Existing rows predate this
-- distinction and all currently behave as watch_and_chat, so that is the
-- default for both the column and the backfill.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_access_type') then
    create type public.event_access_type as enum ('watch', 'watch_and_chat');
  end if;
end $$;

alter table public.event_passes
  add column if not exists access_type public.event_access_type not null default 'watch_and_chat';

grant select (access_type) on public.event_passes to authenticated;

-- A free grant (price configured as 0) never touches Stripe, so it has no
-- payment_records row to point at. granted_free marks that this is
-- intentional, not a missed webhook.
alter table public.event_passes
  alter column payment_record_id drop not null,
  add column if not exists granted_free boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_passes_payment_or_free'
  ) then
    alter table public.event_passes
      add constraint event_passes_payment_or_free check (
        (granted_free and payment_record_id is null)
        or (not granted_free and payment_record_id is not null)
      );
  end if;
end $$;

create index if not exists event_passes_event_user_active_idx
  on public.event_passes (event_id, user_id)
  where status = 'active';

-- The webhook needs to read which access type a checkout was for.
-- payment_records.metadata already exists and is service-role only; nothing
-- to grant here.
comment on column public.payment_records.metadata is
  'Provider-agnostic payment context. For kind = event_pass, carries access_type (watch | watch_and_chat). For kind = paid_comment tied to a live event, carries the live_chat_paid_comment marker used to distinguish it from the legacy anonymous paid-comment flow.';
