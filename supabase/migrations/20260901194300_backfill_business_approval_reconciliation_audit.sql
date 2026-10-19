-- The original Operations Console could leave a business in a partial
-- publication state. Migration 20260901090118 repaired those records to the
-- canonical approved tuple, but that repair predated the transactional review
-- function's audit write. Preserve an honest system reconciliation record for
-- every approved business that has no approval audit evidence.
--
-- actor_user_id intentionally stays null: the historical operator identity was
-- not captured, and this migration must not invent one.
insert into public.audit_log (
  actor_user_id,
  action,
  target_table,
  target_id,
  diff,
  request_id
)
select
  null,
  'ops.business.approval_reconciled',
  'businesses',
  b.id,
  jsonb_build_object(
    'source', 'legacy_partial_approval_repair',
    'reason', 'Canonical approved state existed without a captured operations approval audit.',
    'after', jsonb_build_object(
      'profile_status', b.profile_status,
      'verification_status', b.verification_status,
      'public_profile_enabled', b.public_profile_enabled,
      'published_at', b.published_at
    )
  ),
  'migration:20260901194300'
from public.businesses b
where b.profile_status = 'published'
  and b.verification_status = 'verified'
  and b.public_profile_enabled
  and not exists (
    select 1
    from public.audit_log a
    where a.target_table = 'businesses'
      and a.target_id = b.id
      and a.action in (
        'ops.business.approve',
        'ops.business.approval_reconciled'
      )
  );
