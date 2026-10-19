-- Keep the current single-business workspace deterministic.
--
-- A business account may receive memberships in other companies, but it can
-- create only one company of its own. This prevents onboarding retries or two
-- open tabs from leaving competing owner-created records while the application
-- still exposes one active business workspace.

create unique index if not exists businesses_one_created_record_per_user
  on public.businesses (created_by)
  where created_by is not null;

-- Prefer the member's own company deterministically when the account also has
-- staff memberships. A future multi-business picker can replace this default
-- without changing the one-created-company invariant.
create or replace function public.get_my_memberships()
returns table(business_id uuid, membership_role public.membership_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id, m.membership_role
  from public.business_members m
  where m.user_id = auth.uid()
    and m.invitation_status = 'active'
  order by
    (m.membership_role = 'owner'::public.membership_role) desc,
    m.joined_at asc nulls last,
    m.business_id asc;
$$;

revoke execute on function public.get_my_memberships() from public, anon;
grant execute on function public.get_my_memberships() to authenticated;
