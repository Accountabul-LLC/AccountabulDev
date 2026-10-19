-- Public media must follow the publication state of the exact business asset,
-- service, or property that references it. Business approval alone is not
-- enough to expose media belonging to a draft child record.

drop policy if exists media_public_read on storage.objects;
drop policy if exists business_media_public_read on storage.objects;
drop policy if exists business_media_authenticated_read on storage.objects;
drop policy if exists property_storage_public_read on storage.objects;
drop policy if exists property_storage_authenticated_read on storage.objects;

create policy business_media_public_read
on storage.objects for select
to anon
using (
  bucket_id = 'business-media'
  and (
    exists (
      select 1
      from public.businesses b
      where b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
        and (
          b.logo_path = storage.objects.name
          or b.cover_path = storage.objects.name
        )
    )
    or exists (
      select 1
      from public.services s
      join public.businesses b on b.id = s.business_id
      where s.status = 'published'
        and s.image_path = storage.objects.name
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    )
  )
);

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
        and (
          b.logo_path = storage.objects.name
          or b.cover_path = storage.objects.name
        )
    )
    or exists (
      select 1
      from public.services s
      join public.businesses b on b.id = s.business_id
      where s.status = 'published'
        and s.image_path = storage.objects.name
        and b.profile_status = 'published'
        and b.verification_status = 'verified'
        and b.public_profile_enabled
    )
    or exists (
      select 1
      from public.businesses b
      where b.id = nullif(split_part(name, '/', 1), '')::uuid
        and (
          public.is_business_member(b.id, (select auth.uid()))
          or public.has_role((select auth.uid()), 'admin')
        )
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
    from public.properties p
    join public.businesses b on b.id = p.business_id
    where p.status = 'published'
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
      and (
        p.cover_path = storage.objects.name
        or exists (
          select 1
          from public.property_media pm
          where pm.property_id = p.id
            and pm.storage_path = storage.objects.name
        )
      )
  )
);

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
          p.cover_path = storage.objects.name
          or exists (
            select 1
            from public.property_media pm
            where pm.property_id = p.id
              and pm.storage_path = storage.objects.name
          )
        )
    )
    or exists (
      select 1
      from public.businesses b
      where b.id = nullif(split_part(name, '/', 1), '')::uuid
        and (
          public.is_business_member(b.id, (select auth.uid()))
          or public.has_role((select auth.uid()), 'admin')
        )
    )
  )
);
