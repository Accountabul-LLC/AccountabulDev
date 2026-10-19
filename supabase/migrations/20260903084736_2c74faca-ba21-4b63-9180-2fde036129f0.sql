create table public.business_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null,
  slug text not null,
  policy_type text not null default 'custom',
  content text not null default '',
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, slug)
);

grant select on public.business_policies to anon;
grant select, insert, update, delete on public.business_policies to authenticated;
grant all on public.business_policies to service_role;

alter table public.business_policies enable row level security;

create policy "Public can read published policies of approved businesses"
on public.business_policies for select
to anon, authenticated
using (
  is_published
  and exists (
    select 1 from public.businesses b
    where b.id = business_policies.business_id
      and b.profile_status = 'published'
      and b.verification_status = 'verified'
      and b.public_profile_enabled
  )
);

create policy "Business managers can read their policies"
on public.business_policies for select
to authenticated
using (
  public.can_manage_business(business_id, auth.uid())
  or public.has_role(auth.uid(), 'admin')
);

create policy "Business managers can insert policies"
on public.business_policies for insert
to authenticated
with check (
  public.can_manage_business(business_id, auth.uid())
  or public.has_role(auth.uid(), 'admin')
);

create policy "Business managers can update policies"
on public.business_policies for update
to authenticated
using (
  public.can_manage_business(business_id, auth.uid())
  or public.has_role(auth.uid(), 'admin')
)
with check (
  public.can_manage_business(business_id, auth.uid())
  or public.has_role(auth.uid(), 'admin')
);

create policy "Business managers can delete policies"
on public.business_policies for delete
to authenticated
using (
  public.can_manage_business(business_id, auth.uid())
  or public.has_role(auth.uid(), 'admin')
);

create trigger business_policies_set_updated_at
before update on public.business_policies
for each row execute function public.set_updated_at();

create index business_policies_business_idx on public.business_policies (business_id, sort_order, created_at);