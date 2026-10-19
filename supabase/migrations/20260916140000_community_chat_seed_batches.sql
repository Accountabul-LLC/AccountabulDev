-- Development chat seeding support.
--
-- Adds the columns the seeder marks its rows with and a ledger of seed runs.
-- Everything here is idempotent: the reconstructed community_chat migration
-- already declares seed_batch_id and author_avatar_url, but the live catalog
-- that generated src/integrations/supabase/types.ts does not have them, so this
-- migration is written to be safe whether or not they are already present.
--
-- Nothing in this file creates seed data. It only makes seeded rows
-- identifiable so cleanup can remove them without touching real messages.

alter table public.community_messages
  add column if not exists seed_batch_id uuid;

alter table public.community_messages
  add column if not exists author_avatar_url text;

create index if not exists community_messages_seed_batch_id_idx
  on public.community_messages (seed_batch_id)
  where seed_batch_id is not null;

comment on column public.community_messages.seed_batch_id is
  'Non-null only for development seed data. Cleanup deletes strictly by this column, never by message text.';

-- Members need the avatar column to render emblems next to each message.
grant select (author_avatar_url) on public.community_messages to authenticated;

create table if not exists public.community_chat_seed_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  room_count integer not null default 0,
  message_count integer not null default 0,
  persona_count integer not null default 0,
  messages_per_room integer not null default 0,
  notes text,
  constraint community_chat_seed_batches_counts_nonneg check (
    room_count >= 0 and message_count >= 0 and persona_count >= 0 and messages_per_room >= 0
  )
);

comment on table public.community_chat_seed_batches is
  'One row per development seed run. Service role only; never exposed to members.';

alter table public.community_chat_seed_batches enable row level security;
alter table public.community_chat_seed_batches force row level security;

-- No policies are defined, so RLS denies every non-service-role reader.
revoke all on public.community_chat_seed_batches from public, anon, authenticated;
grant all on public.community_chat_seed_batches to service_role;
