-- Public read for both media buckets
create policy "media_public_read"
on storage.objects for select
to anon, authenticated
using (bucket_id in ('business-media', 'property-media'));

-- Company managers may write only inside their own business folder
create policy "media_business_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('business-media', 'property-media')
  and public.can_manage_business(nullif(split_part(name, '/', 1), '')::uuid, auth.uid())
);

create policy "media_business_update"
on storage.objects for update
to authenticated
using (
  bucket_id in ('business-media', 'property-media')
  and public.can_manage_business(nullif(split_part(name, '/', 1), '')::uuid, auth.uid())
)
with check (
  bucket_id in ('business-media', 'property-media')
  and public.can_manage_business(nullif(split_part(name, '/', 1), '')::uuid, auth.uid())
);

create policy "media_business_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('business-media', 'property-media')
  and public.can_manage_business(nullif(split_part(name, '/', 1), '')::uuid, auth.uid())
);