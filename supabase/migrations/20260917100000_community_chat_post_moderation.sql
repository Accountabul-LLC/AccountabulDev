-- Community chat: publish first, moderate after.
--
-- Chat messages are published the moment they are sent. Automated safeguards run
-- afterwards and can flag or hide a message; members can report messages; staff
-- review only what was flagged or reported. There is no approval queue.
--
-- This migration adds:
--   * hide / screening / report-count state on community_messages
--   * community_message_flags        — member reports and automated flags, one queue
--   * community_chat_restrictions    — mutes, room removals, and chat bans
--   * community_moderation_actions   — append-only moderation history
--   * community_chat_policy_versions — the platform-wide chat policy
--   * community_chat_policy_acceptances
-- and makes hidden messages and restricted members invisible through RLS.
--
-- Paid on-air comments keep their own pre-moderated flow and the existing
-- community_standards_versions row; nothing here changes them.

------------------------------------------------------------------------------
-- Enums
------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_flag_source') then
    create type public.community_flag_source as enum ('member_report', 'automated');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_flag_category') then
    create type public.community_flag_category as enum (
      'spam',
      'harassment',
      'hate',
      'sexual',
      'violence',
      'self_harm',
      'illegal',
      'malicious_link',
      'flooding',
      'other'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_flag_status') then
    create type public.community_flag_status as enum ('open', 'actioned', 'dismissed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_restriction_kind') then
    -- mute: may read, may not post, until expires_at
    -- room_removal: loses access to one room
    -- ban: loses access to all community chat
    create type public.community_restriction_kind as enum ('mute', 'room_removal', 'ban');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_moderation_action_kind') then
    create type public.community_moderation_action_kind as enum (
      'message_hidden',
      'message_unhidden',
      'message_deleted',
      'message_restored',
      'flags_dismissed',
      'user_muted',
      'user_removed_from_room',
      'user_banned',
      'restriction_lifted'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'community_moderation_actor') then
    create type public.community_moderation_actor as enum ('operator', 'system');
  end if;
end $$;

------------------------------------------------------------------------------
-- Message moderation state
------------------------------------------------------------------------------

alter table public.community_messages
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_reason text,
  add column if not exists screened_at timestamptz,
  add column if not exists screening jsonb not null default '{}'::jsonb,
  add column if not exists report_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'community_messages_hidden_reason_len') then
    alter table public.community_messages
      add constraint community_messages_hidden_reason_len
      check (hidden_reason is null or char_length(hidden_reason) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'community_messages_report_count_nonneg') then
    alter table public.community_messages
      add constraint community_messages_report_count_nonneg check (report_count >= 0);
  end if;
end $$;

comment on column public.community_messages.hidden_at is
  'Set when staff or an automated safeguard hides the message. Hidden messages are invisible to members and restorable.';
comment on column public.community_messages.screened_at is
  'Set once automated safeguards have run. Null means screening is still owed; the sweep picks it up.';

-- History already on the platform is not re-screened.
update public.community_messages
set screened_at = coalesce(published_at, created_at)
where screened_at is null
  and published_at is not null;

create index if not exists community_messages_unscreened_idx
  on public.community_messages (created_at)
  where screened_at is null and seed_batch_id is null;
create index if not exists community_messages_hidden_idx
  on public.community_messages (hidden_at desc)
  where hidden_at is not null;
create index if not exists community_messages_user_room_created_idx
  on public.community_messages (user_id, room_id, created_at desc);

------------------------------------------------------------------------------
-- Flags: member reports and automated flags share one review queue
------------------------------------------------------------------------------

create table if not exists public.community_message_flags (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.community_messages(id) on delete cascade,
  room_id uuid not null references public.community_rooms(id) on delete cascade,
  source public.community_flag_source not null,
  category public.community_flag_category not null,
  -- Cascade: a set-null would violate the reporter shape check below.
  reporter_user_id uuid references auth.users(id) on delete cascade,
  detail text,
  signals jsonb not null default '{}'::jsonb,
  status public.community_flag_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  constraint community_message_flags_detail_len
    check (detail is null or char_length(detail) <= 500),
  constraint community_message_flags_resolution_len
    check (resolution_note is null or char_length(resolution_note) <= 500),
  constraint community_message_flags_reporter_shape check (
    (source = 'member_report' and reporter_user_id is not null)
    or (source = 'automated' and reporter_user_id is null)
  ),
  constraint community_message_flags_resolution_shape check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

-- One report per member per message; a second report is a no-op, not a vote.
create unique index if not exists community_message_flags_one_report_per_member
  on public.community_message_flags (message_id, reporter_user_id)
  where source = 'member_report';
create index if not exists community_message_flags_open_idx
  on public.community_message_flags (created_at)
  where status = 'open';
create index if not exists community_message_flags_message_idx
  on public.community_message_flags (message_id);

-- Messages held under the old pre-moderation model become hidden messages in the
-- new model: published (so a restore is a single unhide) but hidden, each with an
-- open automated flag so they land in the review queue instead of vanishing.
with held as (
  update public.community_messages
  set published_at = created_at,
      hidden_at = created_at,
      hidden_reason = 'Held under the previous pre-moderation model; awaiting review.',
      moderation_status = 'approved',
      screened_at = coalesce(screened_at, created_at)
  where published_at is null
    and deleted_at is null
  returning id, room_id
)
insert into public.community_message_flags (message_id, room_id, source, category, signals)
select id, room_id, 'automated', 'other', jsonb_build_object('rule', 'legacy_pre_moderation_hold')
from held;

------------------------------------------------------------------------------
-- Restrictions: mutes, room removals, bans
------------------------------------------------------------------------------

create table if not exists public.community_chat_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.community_restriction_kind not null,
  -- Null room means every community room (a platform-wide mute or ban).
  room_id uuid references public.community_rooms(id) on delete cascade,
  reason text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  source_message_id uuid references public.community_messages(id) on delete set null,
  lifted_at timestamptz,
  lift_reason text,
  constraint community_chat_restrictions_reason_len
    check (char_length(reason) between 1 and 500),
  constraint community_chat_restrictions_lift_reason_len
    check (lift_reason is null or char_length(lift_reason) <= 500),
  constraint community_chat_restrictions_room_removal_needs_room
    check (kind <> 'room_removal' or room_id is not null),
  constraint community_chat_restrictions_expiry_after_start
    check (expires_at is null or expires_at > created_at)
);

create index if not exists community_chat_restrictions_active_idx
  on public.community_chat_restrictions (user_id, room_id)
  where lifted_at is null;

------------------------------------------------------------------------------
-- Moderation history (append-only)
------------------------------------------------------------------------------

create table if not exists public.community_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  action public.community_moderation_action_kind not null,
  actor public.community_moderation_actor not null,
  -- Who in the console acted. Asserted by the operations console behind its
  -- bearer credential; not an Accountabul member id.
  actor_reference text,
  message_id uuid references public.community_messages(id) on delete set null,
  room_id uuid references public.community_rooms(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  restriction_id uuid references public.community_chat_restrictions(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint community_moderation_actions_reason_len
    check (reason is null or char_length(reason) <= 500)
);

create index if not exists community_moderation_actions_created_idx
  on public.community_moderation_actions (created_at desc);
create index if not exists community_moderation_actions_message_idx
  on public.community_moderation_actions (message_id);
create index if not exists community_moderation_actions_target_idx
  on public.community_moderation_actions (target_user_id);

-- History is never rewritten.
create or replace function private.community_moderation_actions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'community_moderation_actions is append-only';
end;
$$;

drop trigger if exists community_moderation_actions_no_update on public.community_moderation_actions;
create trigger community_moderation_actions_no_update
  before update or delete on public.community_moderation_actions
  for each row execute function private.community_moderation_actions_append_only();

------------------------------------------------------------------------------
-- Chat policy
------------------------------------------------------------------------------

create table if not exists public.community_chat_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  summary text[] not null,
  body_markdown text not null,
  is_active boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists community_chat_policy_versions_one_active
  on public.community_chat_policy_versions (is_active)
  where is_active;

create table if not exists public.community_chat_policy_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_version_id uuid not null references public.community_chat_policy_versions(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  primary key (user_id, policy_version_id)
);

insert into public.community_chat_policy_versions (version, title, summary, body_markdown, is_active, published_at)
select
  '2026-09-17',
  'Accountabul Chat Policy',
  array[
    'You are responsible for what you post.',
    'No spam, scams, or repeated flooding.',
    'No harassment, threats, or hateful conduct.',
    'No illegal, sexually exploitative, or harmful content.',
    'Report messages that break these rules.',
    'Accountabul may remove content and restrict accounts that break these rules.'
  ],
  E'Accountabul chat is a live community. Messages appear as soon as you send them, so everyone shares responsibility for keeping it useful and safe.\n\n'
  || E'**You are responsible for what you post.** Share what you know honestly. Do not impersonate people or businesses.\n\n'
  || E'**No spam.** No unsolicited promotion, scams, "guaranteed returns," link farming, or sending the same message repeatedly.\n\n'
  || E'**No abuse or harassment.** No threats, personal attacks, targeted harassment, hateful conduct, or sharing someone''s private information.\n\n'
  || E'**No illegal or harmful content.** No content that is illegal, sexually exploitative, encourages self-harm, or facilitates fraud or violence.\n\n'
  || E'**Report problems.** Use Report on any message that breaks these rules. Reports go to Accountabul staff for review.\n\n'
  || E'**Enforcement.** Automated safeguards and staff may hide or remove messages and may mute, remove, or ban accounts that violate this policy. Accountabul may restore content removed by mistake.',
  true,
  now()
where not exists (select 1 from public.community_chat_policy_versions);

------------------------------------------------------------------------------
-- Access: restrictions, hidden messages
------------------------------------------------------------------------------

-- The single active restriction that governs a member in a room, strongest first.
-- A platform-wide restriction (room_id null) applies to every room.
create or replace function public.community_chat_restriction(_user_id uuid, _room_id uuid)
returns table (
  restriction_id uuid,
  kind public.community_restriction_kind,
  room_id uuid,
  reason text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.kind, r.room_id, r.reason, r.expires_at
  from public.community_chat_restrictions r
  where private.subject_is_self_or_admin(_user_id)
    and r.user_id = _user_id
    and r.lifted_at is null
    and (r.expires_at is null or r.expires_at > now())
    and (r.room_id is null or r.room_id = _room_id)
  order by
    case r.kind when 'ban' then 0 when 'room_removal' then 1 else 2 end,
    r.expires_at desc nulls first
  limit 1;
$$;

-- A ban or a room removal takes the room away entirely. A mute does not: a
-- muted member keeps reading and loses only the ability to post.
create or replace function private.community_chat_access_revoked(_user_id uuid, _room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_chat_restrictions r
    where r.user_id = _user_id
      and r.lifted_at is null
      and (r.expires_at is null or r.expires_at > now())
      and (
        r.kind = 'ban'
        or (r.kind = 'room_removal' and r.room_id = _room_id)
      )
      and (r.room_id is null or r.room_id = _room_id)
  );
$$;

create or replace function public.community_room_visible_to(
  _room_id uuid,
  _access_policy public.community_access_policy,
  _user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    _user_id is not null
    and private.subject_is_self_or_admin(_user_id)
    and not private.community_chat_access_revoked(_user_id, _room_id)
    and exists (
      select 1
      from public.community_rooms r
      where r.id = _room_id
        and r.deleted_at is null
        and r.is_active
        and r.access_policy = _access_policy
        and case r.access_policy
          when 'signed_in' then true
          when 'verified_vendor' then
            public.is_verified_vendor(_user_id)
            or private.role_held(_user_id, 'admin')
            or private.role_held(_user_id, 'moderator')
          when 'role_allowlist' then exists (
            select 1
            from public.community_room_grants g
            where g.room_id = _room_id
              and g.grant_kind = 'role'
              and g.role is not null
              and private.role_held(_user_id, g.role)
          )
          when 'user_allowlist' then exists (
            select 1
            from public.community_room_grants g
            where g.room_id = _room_id
              and g.grant_kind = 'user'
              and g.user_id = _user_id
          )
          else false
        end
    );
$$;

drop policy if exists community_messages_member_read on public.community_messages;
create policy community_messages_member_read
on public.community_messages for select
to authenticated
using (
  published_at is not null
  and deleted_at is null
  and hidden_at is null
  and public.can_access_community_room(room_id, auth.uid())
);

------------------------------------------------------------------------------
-- Grants and RLS for the new tables
------------------------------------------------------------------------------

alter table public.community_message_flags enable row level security;
alter table public.community_chat_restrictions enable row level security;
alter table public.community_moderation_actions enable row level security;
alter table public.community_chat_policy_versions enable row level security;
alter table public.community_chat_policy_acceptances enable row level security;
alter table public.community_message_flags force row level security;
alter table public.community_chat_restrictions force row level security;
alter table public.community_moderation_actions force row level security;
alter table public.community_chat_policy_versions force row level security;
alter table public.community_chat_policy_acceptances force row level security;

-- Members never write moderation data directly. Reports, acceptances, and every
-- staff action go through server code holding the service role.
revoke all on public.community_message_flags from public, anon, authenticated;
revoke all on public.community_chat_restrictions from public, anon, authenticated;
revoke all on public.community_moderation_actions from public, anon, authenticated;
revoke all on public.community_chat_policy_versions from public, anon, authenticated;
revoke all on public.community_chat_policy_acceptances from public, anon, authenticated;
grant all on public.community_message_flags to service_role;
grant all on public.community_chat_restrictions to service_role;
grant select, insert on public.community_moderation_actions to service_role;
grant all on public.community_chat_policy_versions to service_role;
grant all on public.community_chat_policy_acceptances to service_role;

grant select on public.community_chat_policy_versions to authenticated;
drop policy if exists community_chat_policy_member_read on public.community_chat_policy_versions;
create policy community_chat_policy_member_read
on public.community_chat_policy_versions for select
to authenticated
using (is_active);

grant select on public.community_chat_policy_acceptances to authenticated;
drop policy if exists community_chat_policy_acceptances_own_read on public.community_chat_policy_acceptances;
create policy community_chat_policy_acceptances_own_read
on public.community_chat_policy_acceptances for select
to authenticated
using (user_id = auth.uid());

revoke execute on function public.community_chat_restriction(uuid, uuid) from public, anon;
grant execute on function public.community_chat_restriction(uuid, uuid) to authenticated, service_role;
revoke all on function private.community_chat_access_revoked(uuid, uuid) from public, anon, authenticated;
revoke all on function private.community_moderation_actions_append_only() from public, anon, authenticated;
