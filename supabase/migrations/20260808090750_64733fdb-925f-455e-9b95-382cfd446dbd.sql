-- 0005 enums
create type public.property_status as enum ('draft','pending_review','published','rejected','archived');
create type public.service_status as enum ('draft','pending_review','published','rejected','archived');
create type public.inquiry_status as enum ('new','contacted','qualified','won','lost','spam');
create type public.event_status as enum ('scheduled','live','ended','canceled','replay_available');
create type public.tip_status as enum ('created','processing','paid','failed','refunded');

-- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text,
  property_type text,
  address_line1 text,
  address_city text,
  address_state text,
  address_country text,
  postal_code text,
  latitude numeric,
  longitude numeric,
  bedrooms integer,
  bathrooms numeric,
  area_sqft integer,
  price_minor bigint,
  currency text not null default 'USD',
  cover_path text,
  status public.property_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  archived_at timestamptz
);
grant select, insert, update, delete on public.properties to authenticated;
grant select on public.properties to anon;
grant all on public.properties to service_role;
alter table public.properties enable row level security;
create policy properties_public_read on public.properties for select to anon using (status = 'published');
create policy properties_auth_read on public.properties for select to authenticated using (
  status = 'published' or public.is_business_member(business_id, auth.uid())
  or public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create policy properties_insert on public.properties for insert to authenticated with check (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy properties_update on public.properties for update to authenticated using (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin')) with check (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy properties_delete on public.properties for delete to authenticated using (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create index properties_status_published_idx on public.properties (status, published_at desc);
create index properties_business_status_idx on public.properties (business_id, status);
create trigger properties_set_updated_at before update on public.properties for each row execute function public.set_updated_at();

-- property media
create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.property_media to authenticated;
grant select on public.property_media to anon;
grant all on public.property_media to service_role;
alter table public.property_media enable row level security;
create policy property_media_public_read on public.property_media for select to anon using (
  exists (select 1 from public.properties p where p.id = property_id and p.status = 'published'));
create policy property_media_auth_read on public.property_media for select to authenticated using (
  exists (select 1 from public.properties p where p.id = property_id and (p.status = 'published'
    or public.is_business_member(p.business_id, auth.uid()) or public.has_role(auth.uid(),'admin'))));
create policy property_media_write on public.property_media for all to authenticated using (
  exists (select 1 from public.properties p where p.id = property_id and (public.can_manage_business(p.business_id, auth.uid()) or public.has_role(auth.uid(),'admin')))
) with check (
  exists (select 1 from public.properties p where p.id = property_id and (public.can_manage_business(p.business_id, auth.uid()) or public.has_role(auth.uid(),'admin'))));
create index property_media_property_idx on public.property_media (property_id, sort_order);

-- services
create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slug text not null unique,
  name text not null,
  summary text,
  description text,
  category text,
  price_minor bigint,
  currency text not null default 'USD',
  price_note text,
  service_areas text[] not null default '{}',
  status public.service_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
grant select, insert, update, delete on public.services to authenticated;
grant select on public.services to anon;
grant all on public.services to service_role;
alter table public.services enable row level security;
create policy services_public_read on public.services for select to anon using (status = 'published');
create policy services_auth_read on public.services for select to authenticated using (
  status = 'published' or public.is_business_member(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy services_write on public.services for all to authenticated using (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin')) with check (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create index services_business_status_idx on public.services (business_id, status);
create trigger services_set_updated_at before update on public.services for each row execute function public.set_updated_at();

-- inquiries
create table public.property_inquiries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_user_id uuid references auth.users(id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  message text not null,
  status public.inquiry_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.property_inquiries to authenticated;
grant all on public.property_inquiries to service_role;
alter table public.property_inquiries enable row level security;
create policy property_inquiries_read on public.property_inquiries for select to authenticated using (
  from_user_id = auth.uid() or public.is_business_member(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy property_inquiries_insert on public.property_inquiries for insert to authenticated with check (
  from_user_id = auth.uid() and exists (select 1 from public.properties p where p.id = property_id and p.business_id = property_inquiries.business_id and p.status = 'published'));
create policy property_inquiries_update on public.property_inquiries for update to authenticated using (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin')) with check (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create index property_inquiries_business_idx on public.property_inquiries (business_id, created_at desc);
create trigger property_inquiries_set_updated_at before update on public.property_inquiries for each row execute function public.set_updated_at();

create table public.service_inquiries (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  from_user_id uuid references auth.users(id) on delete set null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  message text not null,
  status public.inquiry_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.service_inquiries to authenticated;
grant all on public.service_inquiries to service_role;
alter table public.service_inquiries enable row level security;
create policy service_inquiries_read on public.service_inquiries for select to authenticated using (
  from_user_id = auth.uid() or public.is_business_member(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create policy service_inquiries_insert on public.service_inquiries for insert to authenticated with check (
  from_user_id = auth.uid() and exists (select 1 from public.services s where s.id = service_id and s.business_id = service_inquiries.business_id and s.status = 'published'));
create policy service_inquiries_update on public.service_inquiries for update to authenticated using (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin')) with check (
  public.can_manage_business(business_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
create index service_inquiries_business_idx on public.service_inquiries (business_id, created_at desc);
create trigger service_inquiries_set_updated_at before update on public.service_inquiries for each row execute function public.set_updated_at();

-- saves and follows
create table public.saved_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, property_id)
);
grant select, insert, delete on public.saved_properties to authenticated;
grant all on public.saved_properties to service_role;
alter table public.saved_properties enable row level security;
create policy saved_properties_own on public.saved_properties for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.business_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);
grant select, insert, delete on public.business_follows to authenticated;
grant all on public.business_follows to service_role;
alter table public.business_follows enable row level security;
create policy business_follows_own on public.business_follows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- events and chat
create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  host_business_id uuid references public.businesses(id) on delete set null,
  scheduled_start_at timestamptz,
  actual_start_at timestamptz,
  ended_at timestamptz,
  status public.event_status not null default 'scheduled',
  provider text,
  provider_account_id text,
  provider_record_id text,
  embed_url text,
  replay_url_path text,
  chat_enabled boolean not null default true,
  tips_enabled boolean not null default true,
  cover_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.events to anon;
grant select on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy events_public_read on public.events for select to anon using (status <> 'canceled');
create policy events_auth_read on public.events for select to authenticated using (true);
create policy events_admin_write on public.events for all to authenticated using (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator')) with check (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create index events_status_idx on public.events (status, scheduled_start_at desc);
create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  kind text not null default 'message',
  metadata jsonb not null default '{}'::jsonb,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert on public.chat_messages to authenticated;
grant all on public.chat_messages to service_role;
alter table public.chat_messages enable row level security;
create policy chat_messages_read on public.chat_messages for select to authenticated using (
  is_hidden = false or public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create policy chat_messages_update_mod on public.chat_messages for update to authenticated using (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator')) with check (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create index chat_messages_event_idx on public.chat_messages (event_id, created_at);

create table public.chat_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.chat_moderation_actions to authenticated;
grant all on public.chat_moderation_actions to service_role;
alter table public.chat_moderation_actions enable row level security;
create policy chat_mod_read on public.chat_moderation_actions for select to authenticated using (
  target_user_id = auth.uid() or public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create policy chat_mod_write on public.chat_moderation_actions for all to authenticated using (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator')) with check (
  public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'moderator'));
create index chat_mod_target_idx on public.chat_moderation_actions (target_user_id, event_id);

create table public.event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
grant select, insert, delete on public.event_reminders to authenticated;
grant all on public.event_reminders to service_role;
alter table public.event_reminders enable row level security;
create policy event_reminders_own on public.event_reminders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.event_presence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  unique (event_id, user_id)
);
grant select, insert, update on public.event_presence to authenticated;
grant all on public.event_presence to service_role;
alter table public.event_presence enable row level security;
create policy event_presence_read on public.event_presence for select to authenticated using (true);
create policy event_presence_own_write on public.event_presence for insert to authenticated with check (user_id = auth.uid());
create policy event_presence_own_update on public.event_presence for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tips and payments
create table public.tips (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  from_user_id uuid references auth.users(id) on delete set null,
  to_business_id uuid references public.businesses(id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'USD',
  message text,
  status public.tip_status not null default 'created',
  provider text,
  provider_record_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
grant select on public.tips to authenticated;
grant all on public.tips to service_role;
alter table public.tips enable row level security;
create policy tips_read on public.tips for select to authenticated using (
  from_user_id = auth.uid() or (to_business_id is not null and public.is_business_member(to_business_id, auth.uid()))
  or public.has_role(auth.uid(),'admin'));
create unique index tips_provider_record_idx on public.tips (provider, provider_record_id) where provider_record_id is not null;

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text,
  tip_id uuid references public.tips(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
grant all on public.payment_events to service_role;
alter table public.payment_events enable row level security;
create policy payment_events_admin_read on public.payment_events for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- operations
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  diff jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  status text not null default 'pending',
  dry_run boolean not null default true,
  notes text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
grant select on public.migration_batches to authenticated;
grant all on public.migration_batches to service_role;
alter table public.migration_batches enable row level security;
create policy migration_batches_admin on public.migration_batches for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.migration_record_map (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.migration_batches(id) on delete cascade,
  source_system text not null,
  legacy_id text not null,
  target_table text not null,
  target_id uuid,
  migrated_at timestamptz not null default now(),
  unique (source_system, legacy_id, target_table)
);
grant select on public.migration_record_map to authenticated;
grant all on public.migration_record_map to service_role;
alter table public.migration_record_map enable row level security;
create policy migration_record_map_admin on public.migration_record_map for select to authenticated using (public.has_role(auth.uid(),'admin'));