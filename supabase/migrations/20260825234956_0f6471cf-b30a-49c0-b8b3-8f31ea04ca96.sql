-- 1. Presence participation helper (security definer avoids recursive RLS on event_presence)
create or replace function public.can_view_event_presence(_event_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.event_presence p
    where p.event_id = _event_id and p.user_id = _user_id
  )
  or exists (
    select 1 from public.event_reminders r
    where r.event_id = _event_id and r.user_id = _user_id
  )
  or exists (
    select 1 from public.events e
    where e.id = _event_id
      and e.host_business_id is not null
      and public.can_manage_business(e.host_business_id, _user_id)
  )
  or public.has_role(_user_id, 'admin'::app_role)
  or public.has_role(_user_id, 'moderator'::app_role);
$$;

revoke all on function public.can_view_event_presence(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_view_event_presence(uuid, uuid) to service_role;

-- 2. Scope presence reads
drop policy if exists event_presence_read on public.event_presence;
create policy event_presence_read on public.event_presence
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.can_view_event_presence(event_id, auth.uid())
  );

-- 3. Fix the tautological self-claim branch on business_members insert
drop policy if exists business_members_insert on public.business_members;
create policy business_members_insert on public.business_members
  for insert to authenticated
  with check (
    public.is_business_owner(business_id, auth.uid())
    or public.has_role(auth.uid(), 'admin'::app_role)
    or (
      user_id = auth.uid()
      and membership_role = 'owner'::membership_role
      and exists (
        select 1 from public.businesses b
        where b.id = business_members.business_id
          and b.created_by = auth.uid()
      )
      and not exists (
        select 1 from public.business_members m
        where m.business_id = business_members.business_id
      )
    )
  );

-- 4. Helper functions are policy-internal only
revoke all on function public.has_role(uuid, app_role) from public, anon, authenticated;
revoke all on function public.is_business_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_business_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_manage_business(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_chat_banned(uuid, uuid) from public, anon, authenticated;

grant execute on function public.has_role(uuid, app_role) to service_role;
grant execute on function public.is_business_member(uuid, uuid) to service_role;
grant execute on function public.is_business_owner(uuid, uuid) to service_role;
grant execute on function public.can_manage_business(uuid, uuid) to service_role;
grant execute on function public.is_chat_banned(uuid, uuid) to service_role;