-- Reconstructed 2026-09-10 from live catalog on PRODUCTION_PROJECT_REF
-- (schema_migrations version 20260907045413 / name evening_red_team_hardening).
-- Already applied on that project. Do not re-apply there.

create or replace function public.get_my_business_profile(p_business_id uuid)
returns setof public.businesses
language sql
stable
security definer
set search_path = public
as $$
  select b.*
  from public.businesses b
  where b.id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    );
$$;

create or replace function public.list_property_inquiries(p_business_id uuid)
returns setof public.property_inquiries
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.property_inquiries i
  where i.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    )
  order by i.created_at desc;
$$;

create or replace function public.list_service_inquiries(p_business_id uuid)
returns setof public.service_inquiries
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.service_inquiries i
  where i.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    )
  order by i.created_at desc;
$$;

create or replace function public.list_business_credentials(p_business_id uuid)
returns setof public.business_credentials
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.business_credentials c
  where c.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    )
  order by c.created_at desc;
$$;

create or replace function public.list_business_members(p_business_id uuid)
returns setof public.business_members
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.business_members m
  where m.business_id = p_business_id
    and (
      public.is_business_member(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    )
  order by m.created_at asc;
$$;

create or replace function public.update_inquiry_status(
  p_table text,
  p_id uuid,
  p_status public.inquiry_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
begin
  if p_table = 'property_inquiries' then
    select business_id into v_business_id from public.property_inquiries where id = p_id;
  elsif p_table = 'service_inquiries' then
    select business_id into v_business_id from public.service_inquiries where id = p_id;
  else
    raise exception 'invalid inquiry table';
  end if;

  if v_business_id is null then
    raise exception 'inquiry not found';
  end if;

  if not (
    public.can_manage_business(v_business_id, auth.uid())
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'not authorized to update this inquiry';
  end if;

  if p_table = 'property_inquiries' then
    update public.property_inquiries set status = p_status where id = p_id;
  else
    update public.service_inquiries set status = p_status where id = p_id;
  end if;
end;
$$;

create or replace function public.has_active_membership(
  p_user_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.membership_subscriptions subscription
    where subscription.user_id = p_user_id
      and (
        (
          subscription.status in ('active', 'trialing')
          and subscription.current_period_end is not null
          and subscription.current_period_end > p_at
        )
        or (
          subscription.status = 'past_due'
          and subscription.grace_expires_at is not null
          and subscription.grace_expires_at > p_at
        )
      )
  );
$$;

create or replace function public.has_event_pass(
  p_event_id uuid,
  p_user_id uuid,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_passes pass
    where pass.event_id = p_event_id
      and pass.user_id = p_user_id
      and pass.status = 'active'
      and pass.expires_at is not null
      and pass.expires_at > p_at
  );
$$;
