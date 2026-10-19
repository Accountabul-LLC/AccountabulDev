-- Property Intelligence Phase 5 (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md):
-- API access requests, ported from property-intelligence-app's
-- `propertyApiRequests` (D1). Low priority per the plan doc: an internal ops
-- queue, not a customer-facing feature. Submitting a request never itself
-- grants credentials — `status` starts 'pending' and only an admin action
-- (via public.has_role) can change it; there is deliberately no owner UPDATE
-- policy on this table at all, so a client can never self-approve.

create table public.property_api_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  organization text not null check (length(organization) between 1 and 200),
  use_case text not null check (length(use_case) between 1 and 2000),
  monthly_volume text not null check (length(monthly_volume) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index property_api_access_requests_status_created_idx
  on public.property_api_access_requests (status, created_at desc);

revoke all on public.property_api_access_requests from public, anon, authenticated;
grant select, insert, update on public.property_api_access_requests to authenticated;
grant all on public.property_api_access_requests to service_role;
alter table public.property_api_access_requests enable row level security;

-- One request per account (unique user_id above): the client names its own
-- request but only ever as 'pending' -- the insert cannot arrive pre-approved.
create policy property_api_access_requests_owner_insert
  on public.property_api_access_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

-- Owner reads their own request status; admin sees the whole queue.
create policy property_api_access_requests_read
  on public.property_api_access_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role(auth.uid(), 'admin'));

-- Only admin may ever change status/decision fields. No owner UPDATE policy
-- exists at all, so a resubmission after denial is a fresh support request,
-- not a client-side edit.
create policy property_api_access_requests_admin_update
  on public.property_api_access_requests for update to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
