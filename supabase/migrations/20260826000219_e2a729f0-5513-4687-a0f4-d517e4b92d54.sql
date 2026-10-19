create type public.account_type as enum ('individual', 'business');

alter table public.profiles
  add column if not exists account_type public.account_type not null default 'individual';

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
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,''),'@',1)),
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
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
