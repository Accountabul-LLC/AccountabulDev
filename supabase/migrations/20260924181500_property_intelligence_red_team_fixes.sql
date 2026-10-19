-- Blue team fixes for docs/security/2026-09-24-red-team-property-intelligence-phases.md.
-- Ready-for-verification, not Closed -- see docs/security/2026-09-24-blue-team.md and
-- docs/security/ASSESSMENT_STATE.md. A fresh Verifier session closes these, not this pass.

-- ACC-20260924-001 (Low): property_owner_documents_owner_insert checked actor identity
-- (user_id = auth.uid()) but never actor authority over the referenced thread_id, so a
-- direct PostgREST insert (bypassing the app-layer ownership pre-check in
-- property-records-upload.functions.ts) could attach a document row to another account's
-- workspace. Tighten the WITH CHECK to also require the thread belong to the caller --
-- same exists-against-owner-scoped-table pattern already used correctly by
-- property_report_deliveries_owner_insert.
drop policy property_owner_documents_owner_insert on public.property_owner_documents;
create policy property_owner_documents_owner_insert
  on public.property_owner_documents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'submitted'
    and review_note is null
    and reviewed_by is null
    and reviewed_at is null
    and exists (
      select 1 from public.property_analysis_threads t
      where t.id = thread_id and t.user_id = (select auth.uid())
    )
  );

-- ACC-20260924-002 (Medium): property_reports granted direct `authenticated` INSERT even
-- though the table's own design intent (and its migration's header comment) is
-- "server-function-only" generation -- that invariant was not enforced by the schema.
-- report-vault.server.ts's generateReportSnapshot now writes this row via the service-role
-- client (supabaseAdmin) instead of the caller's RLS-scoped client, so `authenticated` no
-- longer needs -- and must not keep -- direct INSERT access: revoking it, not just adding an
-- ownership check, is the correct tightening here, since nothing in this repo's intended
-- design ever wants a client to write this table directly. This matches the pattern already
-- used correctly for the property-report-vault storage bucket (read-only for authenticated,
-- no insert policy at all).
drop policy property_reports_owner_insert on public.property_reports;
revoke insert on public.property_reports from authenticated;
