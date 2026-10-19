-- Restore the intended owner/manager boundary for property drafts. An older
-- compatibility migration broadened these policies to every active business
-- member, which made viewer and lead-only roles capable of mutating listings.

drop policy if exists properties_insert on public.properties;
create policy properties_insert
on public.properties for insert
to authenticated
with check (public.can_manage_business(business_id, (select auth.uid())));

drop policy if exists properties_update on public.properties;
create policy properties_update
on public.properties for update
to authenticated
using (public.can_manage_business(business_id, (select auth.uid())))
with check (public.can_manage_business(business_id, (select auth.uid())));

drop policy if exists properties_delete on public.properties;
create policy properties_delete
on public.properties for delete
to authenticated
using (public.can_manage_business(business_id, (select auth.uid())));
