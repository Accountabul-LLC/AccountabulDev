-- Column-level read privileges for anonymous visitors on events
revoke select on public.events from anon;
grant select (
  id, slug, title, description, host_business_id,
  scheduled_start_at, actual_start_at, ended_at, status,
  chat_enabled, tips_enabled, cover_path, created_at, updated_at
) on public.events to anon;

-- One owner seat per business, enforced by the database
create unique index if not exists business_members_one_owner_per_business
  on public.business_members (business_id)
  where membership_role = 'owner';