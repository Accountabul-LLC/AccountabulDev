# Admin business-approval pipeline

Status: connected behavior contract and verification record.

## Outcome

The Accountabul Operations Console is the only administrative surface for
business review. The public application owns the data and the protected API;
the console authenticates staff, calls that API server-to-server, and renders
only the returned state.

Approval is one database transaction. A business is approved and public only
when this complete tuple is true:

```text
profile_status = published
verification_status = verified
public_profile_enabled = true
```

No individual field, label, or button is evidence of approval by itself.

## End-to-end flow

1. Business onboarding creates one `businesses` row and one active owner row in
   `business_members`.
2. The business can prepare draft services and properties before approval.
3. The Operations Console loads the queue through
   `GET /api/internal/ops/businesses`. The bearer credential stays on the
   console server.
4. An operator chooses approve, request changes, reject, or suspend. The latter
   three decisions require an internal note of at most 2,000 characters.
5. `PATCH /api/internal/ops/businesses` validates the request and calls
   `review_business(...)`; it never performs independent field updates.
6. `review_business(...)` locks the business row, validates the transition,
   updates the complete publication tuple, writes an audit row, and returns the
   updated record in the same transaction.
7. The console replaces only that row with the returned record, closes the
   confirmation, shows explicit acceptance feedback, actively refetches the
   queue, and verifies that the three approval fields match.
8. If the refetch is stale, missing, or fails, the returned server record stays
   visible and the console shows **Decision accepted — queue reconciliation
   unverified** with a retry action. It does not relabel an accepted decision as
   a failed mutation.
9. Public business, service, property, inquiry, and media reads independently
   require the canonical approved parent tuple.

## Decision transitions

| Decision        | Profile     | Verification | Public page | Additional rule                                      |
| --------------- | ----------- | ------------ | ----------- | ---------------------------------------------------- |
| Approve         | `published` | `verified`   | enabled     | Duplicate approval is a conflict.                    |
| Request changes | `draft`     | `unverified` | disabled    | Non-empty note required.                             |
| Reject          | `rejected`  | `rejected`   | disabled    | Non-empty note required.                             |
| Suspend         | `suspended` | `expired`    | disabled    | Allowed only from canonical approval; note required. |

Database conflicts return HTTP `409`; malformed input returns `400`;
missing/incorrect operations credentials return `401`/`403`; a missing
business returns `404`.

## Approved-owner capabilities

An active owner or manager can create and edit business, service, and property
drafts. Once the parent business is approved:

- a service may be published by its owner or manager;
- a property may be submitted as `pending_review`;
- a property cannot be published directly by the owner or manager;
- property publication remains an Accountabul staff decision.

Membership roles other than owner or manager stay read-only for these
management operations. Database RLS and triggers enforce this boundary even if
the UI is bypassed.

## FlowRight Plumbing Test Company verification — 2026-09-01

Primary record:

```text
business_id: 8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0
slug: flowright-plumbing-test-company-fnu3l
owner: active owner membership
profile: published
verification: verified
public profile: enabled
```

Connected evidence:

- The private Operations Console, under the allowlisted console-owner session,
  reported `Needs review 0`, `Published 2`, and displayed FlowRight as
  `published / verified / visible`.
- The FlowRight inspection drawer disabled duplicate approval and offered
  request changes, reject, and suspend.
- A separate signed-out browser loaded the stable public FlowRight page and its
  published **Emergency Plumbing Repair** service.
- Live database state contains one active owner membership and one published
  service for FlowRight; it currently contains no property listing.
- A rollback-only owner probe successfully created and published a service
  draft, successfully created and submitted a property draft, and received
  PostgreSQL `42501` when attempting direct property publication. Follow-up
  counts proved that zero probe rows persisted.
- A rollback-only review probe produced the complete approved tuple and one
  audit row. Duplicate approval and a blank-note corrective decision both
  returned PostgreSQL `22023`. A business owner attempting to review their own
  business received PostgreSQL `42501`.
- The deployed endpoint returned `401` without a bearer and `403` with an
  intentionally incorrect bearer.

## Historical approval audit reconciliation

FlowRight and one other current business have the canonical approved tuple but
no approval audit entry. That state is consistent with the legacy partial-state
repair in migration `20260901090118`, which completed approval fields before
the transactional review function's audit write existed.

Migration `20260901194300` adds one honest system reconciliation entry for each
canonically approved business lacking either an `ops.business.approve` or prior
`ops.business.approval_reconciled` record. It leaves `actor_user_id` null because
the historical operator identity was never captured, labels the source as
`legacy_partial_approval_repair`, and does not modify business state. The
`not exists` guard makes the backfill idempotent.

## Release verification

Branch verification completed on 2026-09-01:

- Final application: application and Worker type-checks passed, all 63 tests
  passed, lint completed with 10 existing Fast Refresh warnings and no errors,
  and the production build passed.
- Operations Console: TypeScript passed, all 58 tests passed, and the
  production build passed. The full-repository lint remains blocked by the
  repository's pre-existing CRLF/Prettier mismatch; correcting every tracked
  file belongs in a separate formatting-only pull request, not this approval
  change.
- The connected rollback-only backfill test selected two missing canonical
  approvals exactly once each, including FlowRight, and persisted zero rows.
- Live migration history does not yet contain `20260901194300`; applying it is
  part of the reviewed release, not a dashboard-only database change.

Before promotion to `main`:

- run type-check, lint, tests, and the production build in both repositories;
- run the audit backfill inside a rollback-only connected transaction and prove
  exactly the previously missing approved records are selected;
- verify the committed migration is not already in the live ledger before it is
  applied;
- after deployment, verify every canonical approved business has exactly one
  approval or reconciliation audit and rerun the Operations Console/public-page
  checks;
- keep Lovable paused during the reviewed `dev` to `main` release merge.
