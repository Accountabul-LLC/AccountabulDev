-- Property Intelligence Phase 4 (docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md):
-- PDF vault. Ported from property-intelligence-app's `report_snapshots` /
-- `report_documents` / `report_deliveries` (D1) onto Postgres.
--
-- Judgment call: collapsed the source's 3-table split into 2 tables here
-- (property_reports + property_report_deliveries). The source split
-- "document" out from "snapshot" because one snapshot could render several
-- document types (complete_report, conversation_transcript, voice_transcript,
-- legacy per-section reports...). This repo has no chat/voice workspace
-- (confirmed unbuilt in docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md), so there
-- is exactly one meaningful document per snapshot: the Report PDF itself.
-- Folding the PDF's storage_path/pdf_hash/pdf_size directly onto the snapshot
-- row avoids a join that would always resolve 1:1 in this repo, while keeping
-- the snapshot itself immutable (no update/delete policy at all) and the
-- action history in its own append-only table, matching the plan's wording
-- ("Table property_reports: immutable JSON snapshot ... Storage path for the
-- rendered PDF, action history").
--
-- Content-hash dedup: content_hash excludes the report's own capture
-- timestamp and the workspace's mutable status field, so regenerating a
-- report from an unchanged deal scenario + workspace produces the same
-- content_hash and the existing row (and its stored PDF) is reused instead
-- of creating a duplicate -- see report-vault-validation.ts's
-- comparableSnapshotJson, mirroring the source app's
-- records-repository.ts `comparableSnapshot`.
--
-- Generation is server-function-only (report-vault.functions.ts), never a
-- client-side render, so content_hash/pdf_hash can never diverge from the
-- stored bytes. Writes to the storage bucket therefore only ever come from
-- the service role; authenticated users get a read-only, owner-scoped
-- storage policy for short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-report-vault',
  'property-report-vault',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

create table public.property_reports (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.property_analysis_threads(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_scenario_id uuid references public.property_deal_scenarios(id) on delete set null,
  version integer not null check (version > 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot_json jsonb not null check (pg_column_size(snapshot_json) <= 262144),
  storage_path text not null unique check (length(storage_path) between 1 and 512),
  pdf_hash text not null check (pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_size integer not null check (pdf_size > 0 and pdf_size <= 10485760),
  created_at timestamptz not null default now(),
  unique (thread_id, version)
);
create index property_reports_owner_created_idx
  on public.property_reports (user_id, created_at desc);
create index property_reports_thread_version_idx
  on public.property_reports (thread_id, version desc);

revoke all on public.property_reports from public, anon, authenticated;
grant select, insert on public.property_reports to authenticated;
grant all on public.property_reports to service_role;
alter table public.property_reports enable row level security;

-- Owner-scoped, immutable snapshot: insert and select only. Deliberately no
-- UPDATE or DELETE policy at all -- once written, a report row (and its PDF)
-- can never be edited or removed by any client, matching "immutable JSON
-- snapshot per report version" in the port plan.
create policy property_reports_owner_insert
  on public.property_reports for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy property_reports_owner_read
  on public.property_reports for select to authenticated
  using (user_id = (select auth.uid()));

-- Append-only action history: print/download/share/delete. "delete" here
-- records that the owner asked to remove a report from their own view; it is
-- logged, not a real row deletion -- property_reports has no delete policy.
create table public.property_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.property_reports(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null check (action in ('print', 'download', 'share', 'delete')),
  created_at timestamptz not null default now()
);
create index property_report_deliveries_report_created_idx
  on public.property_report_deliveries (report_id, created_at desc);
create index property_report_deliveries_owner_created_idx
  on public.property_report_deliveries (user_id, created_at desc);

revoke all on public.property_report_deliveries from public, anon, authenticated;
grant select, insert on public.property_report_deliveries to authenticated;
grant all on public.property_report_deliveries to service_role;
alter table public.property_report_deliveries enable row level security;

-- Insert-only for the report's own owner; no update or delete policy exists
-- at all, so a recorded action cannot be edited or erased by anyone
-- (mirrors property_record_reviews' append-only pattern from Phase 3).
create policy property_report_deliveries_owner_insert
  on public.property_report_deliveries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.property_reports r
      where r.id = report_id and r.user_id = (select auth.uid())
    )
  );

create policy property_report_deliveries_owner_read
  on public.property_report_deliveries for select to authenticated
  using (user_id = (select auth.uid()));

-- Storage: object key convention is "<user_id>/<thread_id>/<version>-<uuid>.pdf",
-- same folder-scoping idiom as property-owner-records/business-media. Only a
-- read policy exists here -- the PDF is always generated and uploaded
-- server-side with the service role (report-vault.server.ts), which bypasses
-- RLS entirely, so no authenticated INSERT policy is needed or granted. No
-- public/anon grant exists on the bucket's storage.objects rows -- private,
-- signed URLs only.
create policy property_report_vault_owner_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'property-report-vault'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );
