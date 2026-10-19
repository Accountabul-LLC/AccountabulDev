-- Business experience foundation
--
-- Services gain first-class media, service mutations are limited to business
-- managers, and business publication becomes an invariant enforced by the
-- database rather than a convention in one UI.

alter table public.services
  add column if not exists image_path text;

comment on column public.services.image_path is
  'Storage path in business-media, scoped below <business_id>/services/<service_id>/.';

drop policy if exists services_write on public.services;

create policy services_insert_manager
on public.services for insert
to authenticated
with check (public.can_manage_business(business_id, (select auth.uid())));

create policy services_update_manager
on public.services for update
to authenticated
using (public.can_manage_business(business_id, (select auth.uid())))
with check (public.can_manage_business(business_id, (select auth.uid())));

create policy services_delete_manager
on public.services for delete
to authenticated
using (public.can_manage_business(business_id, (select auth.uid())));

create or replace function public.enforce_business_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Browser users may submit a draft for review or hide an already-public page,
  -- but only platform administrators may grant publication or verification.
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    if new.profile_status is distinct from old.profile_status
       and new.profile_status in ('published', 'suspended', 'archived', 'rejected') then
      raise exception 'Only Accountabul staff can change approval status.';
    end if;

    if new.verification_status is distinct from old.verification_status
       and new.verification_status in ('verified', 'in_review', 'rejected', 'expired') then
      raise exception 'Only Accountabul staff can change verification status.';
    end if;

    if new.public_profile_enabled is distinct from old.public_profile_enabled
       and new.public_profile_enabled then
      raise exception 'Only Accountabul staff can publish a business page.';
    end if;

    if new.created_by is distinct from old.created_by then
      raise exception 'Business ownership record cannot be changed.';
    end if;
  end if;

  if new.profile_status = 'published'
     and (new.verification_status <> 'verified' or not new.public_profile_enabled) then
    raise exception 'Published businesses must be verified and publicly enabled.';
  end if;

  if new.profile_status <> 'published' and new.public_profile_enabled then
    raise exception 'Only published businesses may expose a public profile.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_business_approval() from public, anon, authenticated;
grant execute on function public.enforce_business_approval() to service_role;

-- Approval is a single database transaction. The standalone operations console
-- must never be able to leave a business in the legacy partial state of
-- published + in_review + hidden.
create or replace function public.review_business(
  p_business_id uuid,
  p_decision text,
  p_note text default null,
  p_request_id text default null
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_business public.businesses;
  after_business public.businesses;
begin
  if auth.uid() is null then
    if auth.role() <> 'service_role' then
      raise exception 'Not authorized to review businesses.' using errcode = '42501';
    end if;
  elsif not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only Accountabul administrators can review businesses.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'request_changes', 'reject', 'suspend') then
    raise exception 'Unsupported business review decision: %', p_decision using errcode = '22023';
  end if;

  if p_decision <> 'approve' and nullif(btrim(p_note), '') is null then
    raise exception 'A review note is required for this decision.' using errcode = '22023';
  end if;

  select b.*
    into before_business
    from public.businesses b
    where b.id = p_business_id
    for update;

  if not found then
    return null;
  end if;

  update public.businesses b
  set
    profile_status = case p_decision
      when 'approve' then 'published'::public.profile_status
      when 'request_changes' then 'draft'::public.profile_status
      when 'reject' then 'rejected'::public.profile_status
      when 'suspend' then 'suspended'::public.profile_status
    end,
    verification_status = case p_decision
      when 'approve' then 'verified'::public.verification_status
      when 'request_changes' then 'unverified'::public.verification_status
      when 'reject' then 'rejected'::public.verification_status
      when 'suspend' then 'expired'::public.verification_status
    end,
    public_profile_enabled = p_decision = 'approve',
    published_at = case when p_decision = 'approve' then coalesce(b.published_at, now()) else null end
  where b.id = p_business_id
  returning b.* into after_business;

  insert into public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    diff,
    request_id
  ) values (
    auth.uid(),
    'ops.business.' || p_decision,
    'businesses',
    p_business_id,
    jsonb_build_object(
      'before', to_jsonb(before_business),
      'after', to_jsonb(after_business),
      'note', nullif(btrim(p_note), '')
    ),
    nullif(btrim(p_request_id), '')
  );

  return after_business;
end;
$$;

revoke execute on function public.review_business(uuid, text, text, text)
  from public, anon;
grant execute on function public.review_business(uuid, text, text, text)
  to authenticated, service_role;

-- One small RPC replaces four dashboard queries and keeps inquiry tables behind
-- their existing RPC-only read boundary.
create or replace function public.get_business_workspace_metrics(p_business_id uuid)
returns table(service_count bigint, property_count bigint, lead_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.services s where s.business_id = p_business_id),
    (select count(*) from public.properties p where p.business_id = p_business_id),
    (select count(*) from public.service_inquiries si where si.business_id = p_business_id)
      + (select count(*) from public.property_inquiries pi where pi.business_id = p_business_id)
  where auth.uid() is not null
    and public.is_business_member(p_business_id, auth.uid());
$$;

revoke execute on function public.get_business_workspace_metrics(uuid)
  from public, anon;
grant execute on function public.get_business_workspace_metrics(uuid)
  to authenticated;

-- Repair records approved by the previous console implementation. The user
-- already approved these businesses, so this completes that requested action
-- instead of forcing a second manual approval.
update public.businesses
set
  verification_status = 'verified',
  public_profile_enabled = true,
  published_at = coalesce(published_at, now())
where profile_status = 'published'
  and (
    verification_status <> 'verified'
    or not public_profile_enabled
    or published_at is null
  );

-- A public business is one canonical state everywhere in the platform.
drop policy if exists businesses_public_read on public.businesses;
create policy businesses_public_read
on public.businesses for select
to anon
using (
  profile_status = 'published'
  and verification_status = 'verified'
  and public_profile_enabled
);

drop policy if exists businesses_authenticated_read on public.businesses;
create policy businesses_authenticated_read
on public.businesses for select
to authenticated
using (
  (
    profile_status = 'published'
    and verification_status = 'verified'
    and public_profile_enabled
  )
  or public.is_business_member(id, (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'moderator')
);

drop policy if exists properties_public_read on public.properties;
create policy properties_public_read
on public.properties for select
to anon
using (
  status = 'published'
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists properties_auth_read on public.properties;
create policy properties_auth_read
on public.properties for select
to authenticated
using (
  (
    status = 'published'
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    )
  )
  or public.is_business_member(business_id, (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin')
  or public.has_role((select auth.uid()), 'moderator')
);

drop policy if exists property_media_public_read on public.property_media;
create policy property_media_public_read
on public.property_media for select
to anon
using (
  exists (
    select 1
    from public.properties p
    join public.businesses b on b.id = p.business_id
    where p.id = property_id
      and p.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists property_media_auth_read on public.property_media;
create policy property_media_auth_read
on public.property_media for select
to authenticated
using (
  exists (
    select 1
    from public.properties p
    join public.businesses b on b.id = p.business_id
    where p.id = property_id
      and (
        (
          p.status = 'published'
          and b.profile_status = 'published'
          and b.verification_status = 'verified'
          and b.public_profile_enabled
        )
        or public.is_business_member(p.business_id, (select auth.uid()))
        or public.has_role((select auth.uid()), 'admin')
      )
  )
);

drop policy if exists services_public_read on public.services;
create policy services_public_read
on public.services for select
to anon
using (
  status = 'published'
  and exists (
    select 1
    from public.businesses b
    where b.id = business_id
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists services_auth_read on public.services;
create policy services_auth_read
on public.services for select
to authenticated
using (
  (
    status = 'published'
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    )
  )
  or public.is_business_member(business_id, (select auth.uid()))
  or public.has_role((select auth.uid()), 'admin')
);

-- Public pages accept real customer inquiries without requiring an Accountabul
-- login, but only for content that is currently published under an approved
-- business. Signed-in inquiry behavior remains governed by the existing policy.
drop policy if exists service_inquiries_insert_anon on public.service_inquiries;
create policy service_inquiries_insert_anon
on public.service_inquiries for insert
to anon
with check (
  from_user_id is null
  and exists (
    select 1
    from public.services s
    join public.businesses b on b.id = s.business_id
    where s.id = service_id
      and s.business_id = business_id
      and s.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists property_inquiries_insert_anon on public.property_inquiries;
create policy property_inquiries_insert_anon
on public.property_inquiries for insert
to anon
with check (
  from_user_id is null
  and exists (
    select 1
    from public.properties p
    join public.businesses b on b.id = p.business_id
    where p.id = property_id
      and p.business_id = business_id
      and p.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

-- Pending businesses' brand assets must not leak through the previously broad
-- storage read policy. Members retain access to their own drafts.
drop policy if exists media_public_read on storage.objects;

create policy business_media_public_read
on storage.objects for select
to anon
using (
  bucket_id = 'business-media'
  and exists (
    select 1
    from public.businesses b
    where b.id = nullif(split_part(name, '/', 1), '')::uuid
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

create policy business_media_authenticated_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'business-media'
  and exists (
    select 1
    from public.businesses b
    where b.id = nullif(split_part(name, '/', 1), '')::uuid
      and (
        (
          b.profile_status = 'published'
          and b.verification_status = 'verified'
          and b.public_profile_enabled
        )
        or public.is_business_member(b.id, (select auth.uid()))
        or public.has_role((select auth.uid()), 'admin')
      )
  )
);

create policy property_storage_public_read
on storage.objects for select
to anon
using (
  bucket_id = 'property-media'
  and exists (
    select 1
    from public.businesses b
    where b.id = nullif(split_part(name, '/', 1), '')::uuid
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

create policy property_storage_authenticated_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'property-media'
  and exists (
    select 1
    from public.businesses b
    where b.id = nullif(split_part(name, '/', 1), '')::uuid
      and (
        (
          b.profile_status = 'published'
          and b.verification_status = 'verified'
          and b.public_profile_enabled
        )
        or public.is_business_member(b.id, (select auth.uid()))
        or public.has_role((select auth.uid()), 'admin')
      )
  )
);

-- Owners may prepare drafts before approval. Once Accountabul approves the
-- business they may publish services and submit property listings for review.
-- Property publication itself remains an administrator action.
create or replace function public.enforce_approved_business_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_admin boolean := auth.uid() is not null and public.has_role(auth.uid(), 'admin');
  parent_is_approved boolean;
begin
  if auth.uid() is null or is_admin then
    return new;
  end if;

  if new.status in ('pending_review', 'published') then
    select exists (
      select 1
      from public.businesses b
      where b.id = new.business_id
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    ) into parent_is_approved;

    if not parent_is_approved then
      raise exception 'The business must be approved before publishing or submitting content.'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'properties'
     and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'Only Accountabul staff can publish a property listing.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists properties_enforce_approved_business on public.properties;
create trigger properties_enforce_approved_business
before insert or update on public.properties
for each row execute function public.enforce_approved_business_content();

drop trigger if exists services_enforce_approved_business on public.services;
create trigger services_enforce_approved_business
before insert or update on public.services
for each row execute function public.enforce_approved_business_content();

revoke execute on function public.enforce_approved_business_content()
  from public, anon, authenticated;
grant execute on function public.enforce_approved_business_content()
  to service_role;
