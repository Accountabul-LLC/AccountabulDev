-- ACC-20260910 red-team hardening. Tighten only.

update storage.buckets
set public = false
where id in ('business-media', 'property-media')
  and public is distinct from false;

revoke insert (status) on public.property_inquiries from anon, authenticated;
revoke insert (status) on public.service_inquiries from anon, authenticated;

drop policy if exists property_inquiries_insert_anon on public.property_inquiries;
create policy property_inquiries_insert_anon
on public.property_inquiries for insert
to anon
with check (
  from_user_id is null
  and status = 'new'
  and exists (
    select 1
    from public.properties p
    join public.businesses b on b.id = p.business_id
    where p.id = property_id
      and p.business_id = property_inquiries.business_id
      and p.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists property_inquiries_insert on public.property_inquiries;
create policy property_inquiries_insert
on public.property_inquiries for insert
to authenticated
with check (
  from_user_id = auth.uid()
  and status = 'new'
  and exists (
    select 1
    from public.properties p
    where p.id = property_id
      and p.business_id = property_inquiries.business_id
      and p.status = 'published'
  )
);

drop policy if exists service_inquiries_insert_anon on public.service_inquiries;
create policy service_inquiries_insert_anon
on public.service_inquiries for insert
to anon
with check (
  from_user_id is null
  and status = 'new'
  and exists (
    select 1
    from public.services s
    join public.businesses b on b.id = s.business_id
    where s.id = service_id
      and s.business_id = service_inquiries.business_id
      and s.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

drop policy if exists service_inquiries_insert on public.service_inquiries;
create policy service_inquiries_insert
on public.service_inquiries for insert
to authenticated
with check (
  from_user_id = auth.uid()
  and status = 'new'
  and exists (
    select 1
    from public.services s
    where s.id = service_id
      and s.business_id = service_inquiries.business_id
      and s.status = 'published'
  )
);

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
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    );
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
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
    )
  order by m.created_at asc;
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

revoke truncate, trigger, references on public.business_policies from anon, authenticated;

drop policy if exists event_passes_own_read on public.event_passes;
create policy event_passes_own_read
on public.event_passes for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_role(auth.uid(), 'admin')
);

drop policy if exists chat_messages_insert on public.chat_messages;

drop policy if exists business_media_authenticated_read on storage.objects;
create policy business_media_authenticated_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'business-media'
  and (
    exists (
      select 1
      from public.businesses b
      where b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
        and (b.logo_path = objects.name or b.cover_path = objects.name)
    )
    or exists (
      select 1
      from public.services s
      join public.businesses b on b.id = s.business_id
      where s.status = 'published'
        and s.image_path = objects.name
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    )
    or exists (
      select 1
      from public.businesses b
      where b.id = nullif(split_part(objects.name, '/', 1), '')::uuid
        and (
          public.can_manage_business(b.id, auth.uid())
          or public.has_role(auth.uid(), 'admin')
        )
    )
  )
);

drop policy if exists property_storage_authenticated_read on storage.objects;
create policy property_storage_authenticated_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'property-media'
  and (
    exists (
      select 1
      from public.properties p
      join public.businesses b on b.id = p.business_id
      where p.status = 'published'
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
        and (
          p.cover_path = objects.name
          or exists (
            select 1
            from public.property_media pm
            where pm.property_id = p.id
              and pm.storage_path = objects.name
          )
        )
    )
    or exists (
      select 1
      from public.businesses b
      where b.id = nullif(split_part(objects.name, '/', 1), '')::uuid
        and (
          public.can_manage_business(b.id, auth.uid())
          or public.has_role(auth.uid(), 'admin')
        )
    )
  )
);
