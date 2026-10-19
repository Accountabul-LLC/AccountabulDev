-- Reconstructed 2026-09-10 from live catalog on PRODUCTION_PROJECT_REF
-- (schema_migrations version 20260909165841 / name community_chat, plus access_fix).
-- Already applied on that project. Do not re-apply there.
-- Seed user-factory RPCs are intentionally omitted; they stay service_role-only on live.

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'community_access_policy') then
    create type public.community_access_policy as enum (
      'signed_in',
      'verified_vendor',
      'role_allowlist',
      'user_allowlist'
    );
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'community_badge') then
    create type public.community_badge as enum ('member', 'vendor', 'moderator', 'admin');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'community_grant_kind') then
    create type public.community_grant_kind as enum ('role', 'user');
  end if;
end $$;

create table if not exists public.community_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  access_policy public.community_access_policy not null default 'signed_in',
  room_kind text not null default 'community',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint community_rooms_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  constraint community_rooms_name_len check (char_length(name) >= 1 and char_length(name) <= 80),
  constraint community_rooms_description_len check (description is null or char_length(description) <= 280),
  constraint community_rooms_kind_len check (char_length(room_kind) >= 1 and char_length(room_kind) <= 40)
);

create table if not exists public.community_room_grants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.community_rooms(id) on delete cascade,
  grant_kind public.community_grant_kind not null,
  role public.app_role,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint community_room_grants_shape check (
    (grant_kind = 'role' and role is not null and user_id is null)
    or (grant_kind = 'user' and user_id is not null and role is null)
  )
);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.community_rooms(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  author_display_name text,
  author_handle text,
  author_badge public.community_badge not null default 'member',
  author_avatar_url text,
  moderation_status public.moderation_status not null default 'pending',
  published_at timestamptz,
  content_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  client_attempt_id uuid not null,
  seed_batch_id uuid,
  constraint community_messages_body_len check (char_length(body) >= 1 and char_length(body) <= 500)
);

create table if not exists public.community_standards_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body_markdown text not null,
  is_active boolean not null default false,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists community_messages_attempt_uidx
  on public.community_messages (client_attempt_id);
create index if not exists community_messages_room_created_idx
  on public.community_messages (room_id, created_at desc);
create index if not exists community_messages_seed_batch_id_idx
  on public.community_messages (seed_batch_id)
  where seed_batch_id is not null;
create unique index if not exists community_room_grants_role_uidx
  on public.community_room_grants (room_id, role)
  where grant_kind = 'role';
create unique index if not exists community_room_grants_user_uidx
  on public.community_room_grants (room_id, user_id)
  where grant_kind = 'user';
create index if not exists community_rooms_active_sort_idx
  on public.community_rooms (sort_order, name)
  where deleted_at is null and is_active;

alter table public.community_rooms enable row level security;
alter table public.community_room_grants enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_standards_versions enable row level security;
alter table public.community_rooms force row level security;
alter table public.community_room_grants force row level security;
alter table public.community_messages force row level security;
alter table public.community_standards_versions force row level security;

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

create or replace function public.can_access_community_room(
  _room_id uuid,
  _user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.community_rooms r
    where r.id = _room_id
      and r.deleted_at is null
      and r.is_active
      and public.community_room_visible_to(r.id, r.access_policy, _user_id)
  );
$$;

revoke all on public.community_rooms from public, anon, authenticated;
revoke all on public.community_room_grants from public, anon, authenticated;
revoke all on public.community_messages from public, anon, authenticated;
revoke all on public.community_standards_versions from public, anon, authenticated;
grant all on public.community_rooms to service_role;
grant all on public.community_room_grants to service_role;
grant all on public.community_messages to service_role;
grant all on public.community_standards_versions to service_role;

grant select (
  id, slug, name, description, sort_order, is_active, access_policy, room_kind, created_at
) on public.community_rooms to authenticated;
grant select (
  id, room_id, user_id, body, created_at, author_display_name, author_handle, author_badge, author_avatar_url
) on public.community_messages to authenticated;
grant select on public.community_standards_versions to anon, authenticated;

drop policy if exists community_rooms_member_read on public.community_rooms;
create policy community_rooms_member_read
on public.community_rooms for select
to authenticated
using (deleted_at is null and is_active and public.community_room_visible_to(id, access_policy, auth.uid()));

drop policy if exists community_messages_member_read on public.community_messages;
create policy community_messages_member_read
on public.community_messages for select
to authenticated
using (
  published_at is not null
  and deleted_at is null
  and public.can_access_community_room(room_id, auth.uid())
);

drop policy if exists community_standards_public_read on public.community_standards_versions;
create policy community_standards_public_read
on public.community_standards_versions for select
to anon, authenticated
using (is_active = true);

revoke execute on function public.community_room_visible_to(uuid, public.community_access_policy, uuid)
  from public, anon;
grant execute on function public.community_room_visible_to(uuid, public.community_access_policy, uuid)
  to authenticated, service_role;
revoke execute on function public.can_access_community_room(uuid, uuid)
  from public, anon;
grant execute on function public.can_access_community_room(uuid, uuid)
  to authenticated, service_role;
