-- Property Intelligence intake claims and the pre-offer warning preference,
-- ported from property-intelligence-app's D1 tables property_intake_claims and
-- property_intelligence_notice_preferences (app/lib/property-intake-repository.ts
-- and property-intelligence-notice-repository.ts).
--
-- Both tables are owner-readable but service-role write ONLY, with no
-- authenticated INSERT or UPDATE policy anywhere. That is the load-bearing
-- decision, not tidiness:
--
--   * Intake claims must pass normalizePropertyIntakeClaims before they are
--     stored -- it bounds every count and rejects an out-of-range or
--     fractional figure. A direct PostgREST write would bypass that and let an
--     unbounded number reach a deal calculation.
--   * The warning's acknowledgment_count is the gate on dismissal: three
--     separate reviews are required before a user may turn the warning off. If
--     a client could write this row it could set the count to three and
--     dismiss the warning immediately, which defeats the control entirely.
--
-- Both therefore go through a server function holding the service-role client,
-- the same stance 20260924181500 took for property_reports.

create table public.property_intake_claims (
  thread_id uuid primary key references public.property_analysis_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  claims jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(claims) = 'object'),
  check (pg_column_size(claims) <= 16384)
);
create index property_intake_claims_owner_idx
  on public.property_intake_claims (user_id, updated_at desc);

revoke all on public.property_intake_claims from public, anon, authenticated;
grant select on public.property_intake_claims to authenticated;
grant all on public.property_intake_claims to service_role;
alter table public.property_intake_claims enable row level security;

-- Owner reads their own intake only. No write policy exists at all.
create policy property_intake_claims_owner_read
  on public.property_intake_claims for select to authenticated
  using (user_id = (select auth.uid()));

create table public.property_intelligence_notice_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  acknowledgment_count integer not null default 0
    check (acknowledgment_count between 0 and 3),
  last_acknowledged_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The warning may only be dismissed once all three reviews are recorded.
  -- Enforced here as well as in the server function, so the invariant holds
  -- even if a future caller forgets it.
  check (dismissed_at is null or acknowledgment_count >= 3)
);

revoke all on public.property_intelligence_notice_preferences from public, anon, authenticated;
grant select on public.property_intelligence_notice_preferences to authenticated;
grant all on public.property_intelligence_notice_preferences to service_role;
alter table public.property_intelligence_notice_preferences enable row level security;

create policy property_intelligence_notice_preferences_owner_read
  on public.property_intelligence_notice_preferences for select to authenticated
  using (user_id = (select auth.uid()));
