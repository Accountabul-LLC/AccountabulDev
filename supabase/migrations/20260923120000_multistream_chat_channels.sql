-- Multistream chat: OBS pushes directly to Twitch, Kick and YouTube (obs-multi-rtmp),
-- and each platform's chat is ingested into public.chat_messages for the matching event.

alter type public.chat_source add value if not exists 'kick';

-- One row per (event, platform). Webhooks resolve the event by platform channel id;
-- the YouTube poller keeps its cursor here so a restart never replays or skips.
create table public.event_chat_channels (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  platform text not null check (platform in ('twitch', 'kick', 'youtube')),
  channel_id text not null check (length(channel_id) between 1 and 128),
  enabled boolean not null default true,
  youtube_live_chat_id text,
  youtube_page_token text,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, platform)
);
create index event_chat_channels_lookup_idx
  on public.event_chat_channels (platform, channel_id) where enabled;

-- Channel ids and poll cursors are operational state: service role only.
revoke all on public.event_chat_channels from public, anon, authenticated;
grant all on public.event_chat_channels to service_role;
alter table public.event_chat_channels enable row level security;

-- Platforms redeliver webhooks; the ingest path treats 23505 as a duplicate.
create unique index if not exists chat_messages_event_external_uidx
  on public.chat_messages (event_id, external_id) where external_id is not null;
