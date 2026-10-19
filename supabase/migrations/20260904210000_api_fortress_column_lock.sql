-- API fortress: verification metadata and payment ledger stay on the server path.
-- Managers still update public profile fields and pending review status via the Data API.
-- enforce_business_approval continues to block published/verified self-grants.

revoke insert, update (
  tax_id_last4,
  verification_reference,
  verification_checked_at,
  verification_failure_reason,
  published_at
) on public.businesses from authenticated;

revoke update (created_by) on public.businesses from authenticated;

revoke select on public.payment_events from authenticated;
