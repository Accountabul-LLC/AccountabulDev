# Business Experience Contract

Status: accepted implementation contract for the Accountabul business workspace,
public business site, and private operations review flow.

## Goal

A business owner enters company information once, operates the business from one
workspace, and shares one stable public address after Accountabul approval. Personal
account details never silently overwrite company details, and company details never
silently populate the private person record.

## Source of truth

| Concern                             | Authoritative record                      | Visibility                                                 | Owner                    |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| Signed-in person                    | `profiles`                                | The person and authorized platform staff                   | Account holder           |
| Company identity and public contact | `businesses`                              | Business members while private; everyone after approval    | Business owner/manager   |
| Access to a company                 | `business_members`                        | Authorized members and staff                               | Business owner           |
| Products and services               | `services`                                | Business members while draft; everyone after publication   | Business owner/manager   |
| Customer requests                   | `service_inquiries`, `property_inquiries` | Submitter where applicable and authorized business members | Business owner/lead team |

`profiles.account_type` selects onboarding; it does not duplicate a company and is not
an authorization role. Pending status does not move business fields into `profiles`.

## Route and application ownership

- `/dashboard` is the business operations overview: page readiness, service/listing
  counts, lead count, publication state, and next actions.
- `/dashboard/business` edits the one authoritative company record created by business
  onboarding.
- `/dashboard/profile` is explicitly the private personal account.
- `/dashboard/services` manages draft or published service offerings and service media.
- `/businesses/$slug` is the stable public business site. It is available only when the
  business is published, verified, and publicly enabled.
- Administrative decisions do not exist under `/dashboard`. They are made in the
  separate, private Accountabul Operations Console, which calls the protected
  `/api/internal/ops/businesses` endpoint.

## Publication state contract

A business is public only when all three conditions are true:

```text
profile_status = published
verification_status = verified
public_profile_enabled = true
```

Approval sets the three values atomically. Requesting changes, rejecting, or suspending
a business always disables public visibility. Those three decisions require an internal
operator note. Every decision is written to `audit_log` by the database transaction.

Business owners and managers may create drafts and submit them for review. Other
business-membership roles are read-only on the current business, service, and property
management screens. Owners and managers cannot grant their own business verification,
business publication, or property publication. Service publication is unavailable until
the parent business is approved; property publication remains staff-controlled.

## Media contract

- Business logos, covers, and service images use the `business-media` bucket.
- A service stores its path in `services.image_path` below
  `<business_id>/services/<service_id>/`.
- Uploads are limited to 5 MB and business-manager storage paths.
- A new media path is persisted before the previous object is removed, preventing a
  failed database update from leaving a broken reference.
- Anonymous reads of business identity media require the approved public business to
  reference the exact object. Service and property media additionally require the exact
  child record to be published; approving a business never exposes draft child media.

## Stable address and future hosting

The canonical first address is `/businesses/$slug`. Future paid hosting and custom
domains must map a verified domain to the existing business ID; they must not create a
second business record or a second page editor. Domain verification, billing, redirects,
and certificate lifecycle are a later phase and are not implied by the current route.

## Acceptance criteria

1. Completing business onboarding creates exactly one business and one owner membership.
2. Opening Business page settings shows the onboarding data without re-entry.
3. Editing business settings updates the same row used by the workspace and public site.
4. Personal account copy clearly distinguishes the private person from the public company.
5. The overview uses one authorized metrics call and shows truthful empty/error states.
6. Owners/managers can create and edit service and property drafts and their media.
   Service publication and property review submission unlock only after business
   approval; property publication stays staff-only. Other membership roles remain
   read-only at both the UI and RLS boundaries.
7. A signed-out visitor can view only approved businesses and services and can submit a
   valid inquiry for a published service.
8. The private Operations Console can inspect real business submissions and atomically
   approve, request changes, reject, or suspend them through the internal API.
9. No public-app admin route or navigation exists, and no operations credential reaches
   the browser.
10. Type-check, automated tests, production build, scoped lint/formatting, migration
    dry-run, database advisors, and rendered desktop/mobile QA pass before merge.

## Verification record — 2026-09-01

The release branch is `codex/business-experience-20260901` and the review is GitHub
pull request #4. The following evidence was collected before production deployment:

| Requirement                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Approval transition contract        | Unit tests cover canonical approval, hidden corrective states, note requirements, partial-state repair, and unsupported actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Passed                                          |
| Application correctness             | TypeScript, 58 automated tests, full ESLint, Prettier, both application and worker type-checks, and the production build completed successfully. The public directory and both public property routes apply the complete approved-parent tuple explicitly in addition to RLS.                                                                                                                                                                                                                                                                                                                                                   | Passed                                          |
| Migration syntax                    | All eight business-experience migrations were accepted by the connected Postgres runtime. The business/content review functions and their duplicate-decision, note-length, suspension, parent-approval, and least-privilege guards passed behavioral checks. The one-business and inquiry-bound migrations also passed rollback-only schema runs after live-data preflights returned no conflicts.                                                                                                                                                                                                                              | Passed                                          |
| Migration execution                 | Migrations `20260901090118`, `20260901093435`, `20260901114700`, `20260901115500`, `20260901170719`, `20260901172858`, `20260901174400`, and `20260901174957` were applied once and recorded in the connected migration ledger. Post-deployment inspection verified the expected functions, policies, columns, grants, approval repair, property-role boundary, anonymous media visibility, review-function execution boundaries, valid unique creator index, deterministic membership ordering, and eight validated inquiry constraints.                                                                                       | Passed                                          |
| Current FlowRight application state | The exact stable slug is `/businesses/flowright-plumbing-test-company-fnu3l`. The live directory lists FlowRight as verified, the stable public profile loads, and its published Emergency Plumbing Repair service is visible.                                                                                                                                                                                                                                                                                                                                                                                                  | Public visibility passed                        |
| Public inquiry path                 | A signed-out browser submitted the clearly labeled synthetic inquiry `codex.flowright.inquiry.20260901@example.com`; the deployed application returned “Request sent to the business.”                                                                                                                                                                                                                                                                                                                                                                                                                                          | Passed                                          |
| Operations Console identity         | Lovable managed Google authentication is the console's only Google path. An authenticated preview session for the exactly allowlisted `owner@accountabul.example` identity displayed the owner role and the locked business-review surface on 2026-09-01. The consolidation commit removed the custom OAuth routes, PKCE/nonce/JWKS code, `jose`, Google client credentials, and the generated server-side Supabase admin client. It requires `email_verified === true` exactly and passed 58/58 console tests plus lint, type-check, build, and signed-out browser route checks.                                                      | Passed                                          |
| Operations Console data boundary    | A newly generated 64-character bearer key is stored only in the Accountabul and private Ops Hub Lovable Cloud secret stores. The Ops Hub uses `https://accountabul-foundry.lovable.app` because Lovable's editor gate blocks cross-project access to the private preview origin. After Accountabul was published from merge commit `a0228ce`, the live health endpoint returned `401` without a bearer, `403` with an intentionally incorrect bearer, and `200` only with the protected matching key. The allowlisted `owner@accountabul.example` Google owner session loaded two real published businesses and no fabricated records. | Deployed and verified                           |
| Operations Console reconciliation   | The private Ops Hub now replaces a reviewed business row only from the successful backend response, actively refetches the queue, verifies the canonical approval tuple, and preserves the returned row with a visible retry warning if the refetch is missing, stale, or fails. An independently downloaded 2026-09-01 snapshot passed TypeScript, changed-file ESLint, 70/70 tests, and a production build.                                                                                                                                                                                                                   | Code verified; live decision pending            |
| Live migration ledger               | Versions `20260901090118`, `20260901093435`, `20260901114700`, `20260901115500`, `20260901170719`, `20260901172858`, `20260901174400`, and `20260901174957` were confirmed exactly once in the connected project ledger after application.                                                                                                                                                                                                                                                                                                                                                                                      | Passed                                          |
| One authoritative business          | Live data contained no duplicate non-null `businesses.created_by` values before migration. Migration `20260901172858` installed a valid partial unique index so retries or multiple onboarding tabs cannot create competing owner-created companies. The onboarding route retains the inserted ID immediately and, after a uniqueness race, resumes the already-created row. `get_my_memberships` now selects owner memberships first with deterministic tie-breakers, has an empty search path, denies `anon`/`PUBLIC`, and permits `authenticated`.                                                                           | Deployed and verified                           |
| Inquiry input boundary              | Existing service/property inquiry rows passed length, trimming, and email-shape preflight. Shared client normalization now bounds names, emails, phones, and messages before submission. Migration `20260901174400` enforces the same rules on both inquiry tables for direct Data API calls; all eight constraints are validated, and a rollback-safe live probe confirmed an oversized name is rejected without persisting a row.                                                                                                                                                                                             | Deployed and verified                           |
| Public structured data              | The public business page serializes owner-controlled organization fields with an inline-script-safe JSON-LD encoder. The regression test proves a `</script><script>` payload cannot terminate the structured-data element while the serialized output still round-trips to the original JSON value.                                                                                                                                                                                                                                                                                                                            | Passed                                          |
| Property role/media guards          | Migrations `20260901114700` and `20260901115500` now require owner/manager property mutations and prevent draft child media from becoming anonymously readable. Post-deployment policy inspection matched the committed SQL, and an actual `anon` role query exposed only the published FlowRight service image while hiding the unrelated business and property objects.                                                                                                                                                                                                                                                       | Deployed and verified                           |
| Review transition guard             | Migration `20260901170719` rejects duplicate decisions, notes over 2,000 characters, and suspension of any business that is not canonically approved. The internal endpoint returns malformed input as `400`, authorization failure as `401/403`, and database state conflicts as `409` without claiming the decision succeeded. The deployed function denies `anon` and `PUBLIC`, permits only authenticated/admin and service-role execution, and fixes its search path.                                                                                                                                                      | Deployed; live console decision pending         |
| Content review boundary             | Migration `20260901174957` adds atomic property, service, and credential review functions with row locks, state guards, approved-parent checks, bounded notes, and same-transaction audit writes. Live privilege inspection confirmed `anon` and `authenticated` cannot execute them, `service_role` can, and every function pins an empty search path. Service-role missing-record smoke calls returned safely without writes; an authenticated call failed with PostgreSQL `42501`.                                                                                                                                           | Deployed; live console decision pending         |
| Public property media               | Marketplace cards and property detail pages resolve stored cover/gallery paths through the property-media bucket before rendering instead of passing storage object paths directly to `<img>`. The public queries also require an inner approved parent business. A read-only query against the connected Data API accepted that exact join/filter shape; it returned no currently published properties, so live image rendering still needs a post-deployment fixture or listing.                                                                                                                                              | Code/API shape verified; rendered proof pending |
| Supabase advisors                   | Security and performance advisor calls were attempted but the connected account does not have permission to read those reports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pending authorized advisor access               |

Code-level gates are not accepted as proof that production is fixed. After merge and
deployment, use Flow Right Plumbing Test Company to run this state-transition matrix:

| Action                               | Required admin result                                                                                                                                    | Required public result                                                         | Required owner result                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Repair/approve legacy partial record | Row becomes `published` + `verified` + public; review queue refreshes immediately; Approve becomes unavailable.                                          | Stable business URL loads the profile, services, and eligible listings.        | Approval banner is shown; service publication and property review submission are enabled. |
| Approve a normal pending record      | The same canonical three-field state is returned by the API and displayed without a manual reload.                                                       | Profile becomes discoverable and directly addressable.                         | Approved capabilities unlock without creating another business record.                    |
| Request changes                      | A note is required; row becomes draft + unverified + hidden and returns to the appropriate work queue.                                                   | Profile and child public content disappear.                                    | Draft editing remains available; public submission actions are gated.                     |
| Reject                               | A note is required; row becomes rejected + rejected + hidden.                                                                                            | Profile and child public content disappear.                                    | The rejected state is visible without granting publication capabilities.                  |
| Suspend                              | The action is available only for a canonically approved business and requires a note; row becomes suspended + expired + hidden.                          | Profile, services, listings, public media, and inquiry entry points disappear. | Draft management remains safe while public publication actions are gated.                 |
| Re-approve                           | The complete approval state is restored atomically and the new audit entry is visible to operations staff.                                               | The same stable URL becomes available again.                                   | Approved capabilities return without duplicating content or membership.                   |
| Invalid or unauthorized request      | Missing/incorrect bearer credentials, invalid IDs or decisions, and missing mandatory notes are rejected without changing the business or audit history. | No visibility change.                                                          | No capability change.                                                                     |

The reviewed merge is deployed from `main`, Lovable ingested merge commit `a0228ce`, and
the separate private Ops Hub now has both the verified allowlisted Google owner session
and the authenticated server-to-server Accountabul connection. Production browser QA
confirmed the public directory, FlowRight's stable slug, its image-backed Emergency
Plumbing Repair service and signed-out request form, and the canonical admin record with
Approve disabled and Request changes, Reject, and Suspend available. Safe failure-path
checks returned `403` for an incorrect bearer and `400` for invalid input or a missing
mandatory note without changing business state.

The full destructive FlowRight transition matrix and a signed-in owner production smoke
test remain live-verification items; do not hide, reject, suspend, or reset the published
test company merely to exercise those paths without explicit authorization.
Reading Supabase advisor reports also remains an explicit operational follow-up because
the current connected account does not have that authority.
