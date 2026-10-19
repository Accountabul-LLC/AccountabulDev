# Accountabul Two-Application Administration Plan

Status: implementation contract for the standalone Operations Console migration.

## 1. Outcome

Accountabul will operate as two connected applications with one production data source:

1. **Accountabul Final** is the public and member-facing platform. Visitors discover
   businesses, services, properties, and public live events. Signed-in people manage
   profiles, memberships, portfolios, business pages, services, listings, inquiries,
   subscriptions, and permitted live-event participation.
2. **Accountabul Operations Console** is the private control plane. Approved Accountabul
   operators review businesses, properties, services, and credentials; run events;
   moderate activity; monitor payments and providers; inspect audits; and oversee data
   migrations.

The Operations Console does not replace the public platform. It governs it. A decision
made in the console changes the authoritative Accountabul database through a protected
server API. The public platform then reflects that state through its normal public or
member queries.

## 2. Non-negotiable boundary

The following rules keep the two applications connected without creating two competing
systems:

- Accountabul Final remains the only owner of product data, schemas, migrations, public
  authorization rules, and public/member workflows.
- The Operations Console receives only purpose-built operations responses from
  `/api/internal/ops/*` endpoints.
- The Operations Console never receives an Accountabul database URL, publishable key,
  service-role key, storage credential, Stripe secret, Restream secret, or wallet secret.
- The console never queries Accountabul Supabase directly from a browser or server
  function.
- The public platform has no `/admin` page, admin navigation, or hidden browser-side
  administration client.
- Every privileged decision uses an atomic database function: lock the record, validate
  the current state, update it, and append the audit event in one transaction.
- A console screen may be rebuilt from a former admin workflow, but old direct-database
  code and old authentication code must not be copied.
- One database remains authoritative. The console may cache screen state while a request
  is open, but it must re-fetch the server result after every mutation.

## 3. Application responsibilities

| Capability            | Accountabul Final                                                                             | Operations Console                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Public discovery      | Business directory, marketplace, property/service detail, public event pages                  | No public discovery pages                                                                    |
| Authentication        | Google/member sign-in, onboarding, account recovery, user sessions                            | Managed Google sign-in for exact allowlisted operators                                       |
| User profiles         | Person profile, contact data, portfolio, saves, follows, membership state                     | Read-only account support view in a later access phase                                       |
| Business ownership    | Create/resume one authoritative business, team workspace, business page editing               | Approve, request changes, reject, suspend, and inspect history                               |
| Services              | Owners/managers create, edit, publish after business approval, archive, and receive inquiries | Oversight queue; approve submitted services; reject/request changes; suspend public services |
| Properties            | Owners/managers create drafts, edit, submit for review, archive, and receive inquiries        | Review submitted listings; publish, reject/request changes, and suspend listings             |
| Credentials           | Owners/managers submit verification credentials                                               | Approve/reject credentials and control public-display approval                               |
| Live events           | Members view eligible streams, chat, request to speak, and tip according to access rules      | Configure events, providers, speakers, moderation, passes, and operational health            |
| Memberships           | Plans, eligibility, subscription state, entitlements, and member access                       | Billing/provider oversight, exception handling, refunds, and later entitlement support       |
| Payments              | Customer checkout and signed webhook-driven status                                            | Reconciliation, failures, controlled refunds, and catalog administration                     |
| Audit                 | No administrative audit surface                                                               | Immutable operations activity and migration history                                          |
| Property intelligence | Public/member entry point and authorized deal-analysis workflow                               | Later operational support and usage visibility; no hidden duplicate analyzer                 |

## 4. Former admin capability inventory

The former Accountabul Final admin screens contained a mixture of useful workflows and
unsafe implementation patterns. The migration carries forward the workflow intent only.

| Former capability                   | Current destination                 | Status                                                    |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| Business review queue               | Console `/businesses`               | Implemented in console and API                            |
| Property listing review             | Console `/properties`               | API contract implemented; console screen required         |
| Service review/oversight            | Console `/services`                 | API contract implemented; console screen required         |
| Business credential review          | Console `/credentials`              | API contract implemented; console screen required         |
| Conference room/event controls      | Console `/events` and `/events/:id` | Implemented                                               |
| Community chat rooms                | Console `/chat-rooms`               | API contract implemented; console screen required         |
| Tips/payment reconciliation         | Console `/billing`                  | Implemented                                               |
| Paid-comment moderation             | Console `/moderation`               | Implemented                                               |
| Speaker requests                    | Console `/speakers`                 | Implemented                                               |
| Provider health/authorization       | Console `/providers`                | Implemented                                               |
| Operations log                      | Console `/audit`                    | Implemented for `audit_log`                               |
| Migration batches                   | Console `/audit`                    | Read API implemented; console section required            |
| Historical registry-admin subsystem | No automatic destination            | Legacy/incompatible; requires a separate product decision |

The historical registry-admin subsystem referenced tables and records that do not exist
in the current production schema. It is not part of this import. Recreating it would be a
new feature, not an admin-page migration.

## 5. State and dependency contracts

### 5.1 Business approval

A business is public only when all three fields agree:

```text
profile_status = published
verification_status = verified
public_profile_enabled = true
```

Approval sets all three values in one transaction. Requesting changes, rejecting, or
suspending a business removes public visibility. Public services, property listings, and
their media also require this approved parent-business state.

### 5.2 Property review

```text
owner draft -> owner submits -> pending_review
pending_review -> operator approves -> published
pending_review -> operator requests changes -> draft
pending_review -> operator rejects -> rejected
published -> operator suspends -> archived
```

Only Accountabul staff can publish a property. The database enforces this even if an
owner bypasses the page UI. Approval is rejected when the parent business is not
canonically approved.

### 5.3 Service oversight

Approved businesses may publish their own services in the current launch model. The
console still needs visibility and a suspension path. If a service is explicitly
submitted with `pending_review`, staff can approve, request changes, or reject it using
the same transition pattern as a property. A public service may be suspended to
`archived`. The database rejects any attempt to publish a service beneath an unapproved
business.

Mandatory pre-publication service review is not introduced by this migration. That is a
future policy choice because it would change the business-owner launch experience.

### 5.4 Credential review

```text
owner submits -> pending
pending -> operator approves -> approved + public_display_approved
pending -> operator rejects -> rejected + hidden
```

Rejection requires an operator note. Credential documents and private notes remain
private operations data and must never appear on public pages.

### 5.5 Notes, conflicts, and audit

- Approval may omit a note. Decisions that hide, reject, suspend, or return work require
  a note.
- Notes are trimmed and limited to 2,000 characters at both API and database boundaries.
- A decision that does not match the current state returns HTTP `409`; it does not modify
  the record or append an audit entry.
- Missing or wrong server authentication returns `401` or `403`.
- Invalid JSON, IDs, decisions, or notes return `400`.
- Missing records return `404`.
- Every accepted decision records the before state, after state, note, request ID, action,
  target table, target ID, timestamp, and the database-authenticated actor when available.

## 6. Build sequence

The order matters because each console screen depends on a protected server contract and
each public page depends on authoritative database state.

### Step 1 — Freeze the boundary and inventory

1. Keep the public `/admin` route removed.
2. Record every former admin capability and map it to an existing or planned console
   route.
3. Identify legacy screens that refer to obsolete tables and exclude them explicitly.
4. Confirm Accountabul Final and Operations Console project IDs, origins, and repository
   ownership before changing either project.

Acceptance:

- Every admin capability has one named owner and destination.
- No capability is implemented in both applications.

### Step 2 — Complete the public platform control API

1. Retain the existing businesses, events, moderation, speaker, payments, provider,
   metrics, audit, and catalog endpoints.
2. Add protected `GET` and `PATCH` endpoints for properties, services, and credentials.
3. Add atomic database functions for all accepted review decisions.
4. Return migration-batch history with the audit response without exposing SQL or
   database credentials.
5. Return bounded, explicit response columns; do not return raw provider payloads or
   secrets.

Acceptance:

- Unauthenticated requests fail closed.
- A valid server bearer can list queues.
- Accepted mutations change the record and audit together.
- Invalid transitions leave both unchanged.

### Step 3 — Establish the Operations Console source of truth

1. Connect the private Operations Console to its own GitHub repository or otherwise
   establish one reviewed, recoverable source repository.
2. Keep the project private and unpublished.
3. Preserve the current managed Google operator login and exact email allowlist.
4. Store only server-side console configuration: Accountabul API base URL, shared
   operations bearer, console session secret, and allowed operator emails.

Acceptance:

- Console changes are versioned and recoverable.
- No Accountabul database or provider secret exists in the console repository or browser.

This step changes external project state and therefore requires the owner's immediate
confirmation before the GitHub connection is created.

### Step 4 — Import the missing console workflows

1. Add `/properties` with queue/all filters, property/business context, status history,
   details, approve, request-changes, reject, and suspend actions.
2. Add `/services` with all-service visibility, status filters, business context, and
   suspend/review actions.
3. Add `/credentials` with pending/history filters, private credential detail, and
   approve/reject actions.
4. Add the migration-batch history returned by the API to `/audit`.
5. Use one shared confirmation-dialog, note-input, error, loading, and empty-state pattern
   across all queues.
6. Re-fetch authoritative data after every mutation and disable duplicate/current-state
   decisions.

Acceptance:

- No queue uses mock or fabricated records.
- Buttons are derived from the complete current state, not one status badge.
- A successful action disappears from the pending queue and appears correctly in history.
- A `409` displays a refresh instruction and does not optimistically claim success.

### Step 5 — Pair protected environments

1. Select the exact Accountabul preview or production origin the console will control.
2. Generate one high-entropy `OPERATIONS_API_KEY`.
3. Configure the key on the Accountabul server and the same key on the console server.
4. Configure `ACCOUNTABUL_OPERATIONS_API_BASE_URL` in the console.
5. Verify health behavior: `401` without bearer, `403` with the wrong bearer, and `200`
   only with the matching bearer.
6. Never paste the bearer into source, Lovable chat, logs, screenshots, or documents.

Acceptance:

- Google login succeeds for an allowlisted operator and fails for anyone else.
- Real queue data loads after login.
- The browser never receives the server bearer.

This step handles a sensitive credential and requires the owner's immediate confirmation
at the moment the values are entered.

### Step 6 — Verify the end-to-end approval pipeline

Use FlowRight Plumbing Test Company as the first named business acceptance record:

1. Confirm its current business row is canonical and not duplicated.
2. Approve or inspect its repaired approval state in the console.
3. Confirm it leaves the review queue and shows published, verified, and public enabled.
4. Confirm its public business page is reachable while signed out.
5. Create or inspect one service and verify it can be public only under the approved
   business.
6. Create or inspect one property, submit it, approve it in the console, and confirm it
   appears in the signed-out marketplace.
7. Suspend the test property and confirm it disappears from public discovery while its
   audit history remains.
8. Verify at least one conflict and one unauthorized request leave data unchanged.

Acceptance:

- Console state, database state, and public visibility agree after every transition.
- There is one audit event for each accepted operator decision and none for rejected
  requests.

### Step 7 — Ship through the Lovable/Git workflow

1. Refresh `origin/main` and merge it into the Codex feature branch if main advanced.
2. Run type-check, tests, production build, and rendered UI QA for both applications.
3. Review the full pull-request diff for secrets, direct database access, duplicate admin
   routes, stale Lovable variants, migrations, and generated files.
4. Pause Lovable edits before merging.
5. Merge with **Create a merge commit** only.
6. Refresh both Lovable projects from their authoritative branches and repeat the named
   acceptance flow before resuming edits.

Acceptance:

- Both applications are on reviewed commits.
- Local and remote branches match and worktrees are clean.
- The public application still has no admin route.
- The private console controls the verified production behavior.

## 7. Launch gates and deferred work

The administration migration is launch-ready only after Steps 1 through 7 pass. The
following are intentionally deferred unless separately approved:

- employee/operator lifecycle beyond the single allowlisted owner;
- signed human operator claims propagated into every Accountabul API audit row;
- mandatory service review before publication;
- rebuilding the historical registry-admin subsystem;
- direct payouts or business-service payments;
- a second property-intelligence implementation inside the console;
- production secret rotation, publication, or merge without action-time confirmation.

## 8. Definition of done

This migration is done when the Operations Console is the only administrative control
plane, every imported workflow uses a protected Accountabul server endpoint, every
privileged transition is atomic and audited, FlowRight and the property/service test
matrix pass end to end, the public platform continues to support normal sign-in and
member/business use, and both applications have a reviewed source of truth.
