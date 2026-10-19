-- 0001 extensions and enums
create extension if not exists pgcrypto;

create type public.app_role as enum ('member','business_owner','business_staff','moderator','admin');
create type public.membership_role as enum ('owner','manager','listing_manager','lead_manager','viewer');
create type public.invitation_status as enum ('invited','active','revoked');
create type public.profile_status as enum ('draft','pending_review','published','rejected','suspended','archived');
create type public.verification_status as enum ('unverified','pending','in_review','verified','rejected','expired');
create type public.onboarding_status as enum ('new','profile_complete','business_started','complete');
create type public.credential_review_status as enum ('pending','approved','rejected');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 0002 profiles and user_roles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email_display text,
  first_name text,
  last_name text,
  display_name text,
  avatar_path text,
  phone text,
  city text,
  state text,
  country text,
  onboarding_status public.onboarding_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role and revoked_at is null
  );
$$;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid() or public.has_role(auth.uid(),'admin'))
  with check (id = auth.uid() or public.has_role(auth.uid(),'admin'));

create policy "user_roles_select_own" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "user_roles_admin_write" on public.user_roles
  for all to authenticated using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email_display, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,''),'@',1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 0003 businesses and members
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  legal_name text not null,
  display_name text not null,
  headline text,
  description text,
  logo_path text,
  cover_path text,
  website_url text,
  public_email text,
  public_phone text,
  year_founded int,
  employee_count_range text,
  primary_industry text,
  address_city text,
  address_state text,
  address_country text,
  service_areas text[] not null default '{}',
  profile_status public.profile_status not null default 'draft',
  verification_status public.verification_status not null default 'unverified',
  public_profile_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

grant select on public.businesses to anon;
grant select, insert, update on public.businesses to authenticated;
grant all on public.businesses to service_role;
alter table public.businesses enable row level security;

create trigger businesses_set_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();

create index businesses_status_published_idx on public.businesses (profile_status, published_at desc);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role public.membership_role not null default 'viewer',
  permissions jsonb not null default '{}'::jsonb,
  invitation_status public.invitation_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

grant select, insert, update, delete on public.business_members to authenticated;
grant all on public.business_members to service_role;
alter table public.business_members enable row level security;

create trigger business_members_set_updated_at before update on public.business_members
  for each row execute function public.set_updated_at();

create index business_members_user_idx on public.business_members (user_id);

create or replace function public.is_business_member(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = _business_id and user_id = _user_id and invitation_status = 'active'
  );
$$;

create or replace function public.can_manage_business(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = _business_id and user_id = _user_id
      and invitation_status = 'active'
      and membership_role in ('owner','manager')
  );
$$;

create or replace function public.is_business_owner(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = _business_id and user_id = _user_id
      and invitation_status = 'active' and membership_role = 'owner'
  );
$$;

create policy "businesses_public_read" on public.businesses
  for select to anon
  using (profile_status = 'published' and public_profile_enabled = true);

create policy "businesses_authenticated_read" on public.businesses
  for select to authenticated
  using (
    (profile_status = 'published' and public_profile_enabled = true)
    or public.is_business_member(id, auth.uid())
    or public.has_role(auth.uid(),'admin')
    or public.has_role(auth.uid(),'moderator')
  );

create policy "businesses_insert_own" on public.businesses
  for insert to authenticated with check (created_by = auth.uid());

create policy "businesses_update_manager" on public.businesses
  for update to authenticated
  using (public.can_manage_business(id, auth.uid()) or public.has_role(auth.uid(),'admin'))
  with check (public.can_manage_business(id, auth.uid()) or public.has_role(auth.uid(),'admin'));

create policy "business_members_read" on public.business_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_business_member(business_id, auth.uid())
    or public.has_role(auth.uid(),'admin')
  );

create policy "business_members_insert" on public.business_members
  for insert to authenticated
  with check (
    public.is_business_owner(business_id, auth.uid())
    or public.has_role(auth.uid(),'admin')
    or (
      user_id = auth.uid()
      and membership_role = 'owner'
      and exists (select 1 from public.businesses b where b.id = business_id and b.created_by = auth.uid())
      and not exists (select 1 from public.business_members m where m.business_id = business_id)
    )
  );

create policy "business_members_update" on public.business_members
  for update to authenticated
  using (public.is_business_owner(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'))
  with check (public.is_business_owner(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

create policy "business_members_delete" on public.business_members
  for delete to authenticated
  using (public.is_business_owner(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

-- 0004 business credentials
create table public.business_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  credential_type text not null,
  issuing_authority text,
  identifier text,
  issued_at date,
  expires_at date,
  document_path text,
  private_notes text,
  review_status public.credential_review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  public_display_approved boolean not null default false,
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.business_credentials to authenticated;
grant all on public.business_credentials to service_role;
alter table public.business_credentials enable row level security;

create trigger business_credentials_set_updated_at before update on public.business_credentials
  for each row execute function public.set_updated_at();

create index business_credentials_business_idx on public.business_credentials (business_id, review_status);

create policy "business_credentials_read" on public.business_credentials
  for select to authenticated
  using (
    public.can_manage_business(business_id, auth.uid())
    or public.has_role(auth.uid(),'admin')
    or public.has_role(auth.uid(),'moderator')
  );

create policy "business_credentials_insert" on public.business_credentials
  for insert to authenticated
  with check (public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

create policy "business_credentials_update" on public.business_credentials
  for update to authenticated
  using (
    (public.can_manage_business(business_id, auth.uid()) and review_status = 'pending')
    or public.has_role(auth.uid(),'admin')
  )
  with check (
    (public.can_manage_business(business_id, auth.uid()) and review_status = 'pending')
    or public.has_role(auth.uid(),'admin')
  );