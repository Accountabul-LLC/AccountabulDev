-- Property Intelligence Phase 3 (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md):
-- owner document uploads ("Your Property Records"), ported from
-- property-intelligence-app's `propertyRecordSubmissions` / `propertyRecordReviews`
-- (D1) onto Postgres. An owner's upload is never itself a verified fact — only
-- an admin/moderator review can flip `status` to 'verified', and that review
-- is the only thing the Property Intelligence timeline may ever surface as an
-- "Accountabul-verified owner record" (ACC design non-negotiable, see the port
-- plan's Phase 3 section). Links to property_analysis_threads (the per-user
-- workspace) rather than property_intel_parcels directly, since the thread
-- already scopes both the owner and the parcel (unique (user_id, parcel_id)
-- in 20260923160000_property_intelligence_workspaces.sql).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-owner-records',
  'property-owner-records',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do nothing;

create table public.property_owner_documents (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.property_analysis_threads(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (length(category) between 1 and 60),
  title text not null check (length(title) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  occurred_at date,
  amount numeric check (amount is null or amount >= 0),
  vendor_name text check (vendor_name is null or length(vendor_name) <= 200),
  reference_number text check (reference_number is null or length(reference_number) <= 120),
  storage_path text not null unique check (length(storage_path) between 1 and 512),
  original_filename text not null check (length(original_filename) between 1 and 255),
  content_type text not null
    check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
  review_note text check (review_note is null or length(review_note) <= 2000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index property_owner_documents_owner_created_idx
  on public.property_owner_documents (user_id, created_at desc);
create index property_owner_documents_status_created_idx
  on public.property_owner_documents (status, created_at desc);
create index property_owner_documents_thread_idx
  on public.property_owner_documents (thread_id, created_at desc);

revoke all on public.property_owner_documents from public, anon, authenticated;
grant select, insert, update on public.property_owner_documents to authenticated;
grant all on public.property_owner_documents to service_role;
alter table public.property_owner_documents enable row level security;

-- Owner can only ever create a fresh, unreviewed submission: the review
-- columns must be exactly their defaults on insert, so a forged payload
-- cannot self-declare 'verified' at write time.
create policy property_owner_documents_owner_insert
  on public.property_owner_documents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'submitted'
    and review_note is null
    and reviewed_by is null
    and reviewed_at is null
  );

-- Owner reads their own submissions; admin/moderator read the review queue.
create policy property_owner_documents_read
  on public.property_owner_documents for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
  );

-- Only admin/moderator may ever write a review decision onto the row.
-- Deliberately no owner UPDATE policy exists, so an owner cannot self-flip
-- their own document to 'verified' by any client-side write.
create policy property_owner_documents_review_update
  on public.property_owner_documents for update to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'moderator'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'moderator'));

-- Append-only review ledger, mirrors the source app's review history.
create table public.property_record_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.property_owner_documents(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  decision text not null check (decision in ('verified', 'rejected')),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index property_record_reviews_submission_created_idx
  on public.property_record_reviews (submission_id, created_at desc);

revoke all on public.property_record_reviews from public, anon, authenticated;
grant select, insert on public.property_record_reviews to authenticated;
grant all on public.property_record_reviews to service_role;
alter table public.property_record_reviews enable row level security;

-- Insert-only for admin/moderator; no update or delete policy exists at all,
-- so a review, once recorded, cannot be edited or erased by anyone.
create policy property_record_reviews_reviewer_insert
  on public.property_record_reviews for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'moderator'))
  );

-- The document owner can see their own review history; admin/moderator see all.
create policy property_record_reviews_read
  on public.property_record_reviews for select to authenticated
  using (
    reviewer_id = (select auth.uid())
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
    or exists (
      select 1 from public.property_owner_documents d
      where d.id = submission_id and d.user_id = (select auth.uid())
    )
  );

-- Storage: object key convention is "<user_id>/<uuid>.<ext>", same folder-scoping
-- idiom as business-media/property-media (src/lib/media.ts). No public read;
-- reads are signed URLs only. No update/delete policy: a submitted document is
-- immutable evidence — a correction is a new submission, not an edit in place.
create policy property_owner_records_owner_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'property-owner-records'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy property_owner_records_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'property-owner-records'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  );
