-- Reconstructed 2026-09-10 from live catalog on PRODUCTION_PROJECT_REF
-- (schema_migrations version 20260909185041 / name google_oauth_profile_fields).
-- Already applied on that project. Do not re-apply there.
-- Display-name mapping only. Roles still insert `member`; never from user metadata.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email_display, display_name, first_name, last_name, account_type)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', '')
    ),
    case
      when (new.raw_user_meta_data ->> 'account_type') = 'business' then 'business'::public.account_type
      else 'individual'::public.account_type
    end
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
