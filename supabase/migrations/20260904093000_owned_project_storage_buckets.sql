insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('business-media', 'business-media', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif']::text[]),
  ('property-media', 'property-media', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif']::text[])
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
