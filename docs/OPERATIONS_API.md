# Private Operations API

The Lovable Operations Console is a separate, private, unpublished application. It must set these server-only values:

```text
ACCOUNTABUL_OPERATIONS_API_BASE_URL=https://<Accountabul deployment>
OPERATIONS_API_KEY=<strong random secret shared with Accountabul server>
SESSION_SECRET=<independent 32+ character session secret>
OPERATIONS_GOOGLE_ALLOWED_EMAILS=<exact comma-separated owner emails>
```

None may use a `VITE_` prefix. Lovable provisions the identity-only Cloud URL and
publishable key used by its managed Google provider. The console must never contain an
Accountabul Supabase URL, a service-role key, or a direct Accountabul data query.

Google is the sole active console identity flow. The private console uses Lovable Cloud
managed Google authentication, verifies the managed bearer token at the server-function
boundary, requires `email_verified === true` exactly, and matches the normalized email
against the exact allowlist. Only the verified email and owner role enter the encrypted
HTTP-only console session; Google tokens are not persisted or used for Accountabul data
access. The post-authentication destination is fixed to `/businesses`, and all
production/preview sign-in fails closed unless `SESSION_SECRET` is at least 32 characters.
The previous custom OAuth routes, PKCE/nonce/JWKS implementation, Google client
credentials, and `jose` dependency were removed from the console.

Google authentication establishes the operator identity only. Real console data still
requires `ACCOUNTABUL_OPERATIONS_API_BASE_URL` and `OPERATIONS_API_KEY`; Google never
replaces the server-to-server bearer credential.

## Implemented endpoints

| Endpoint                                 | Methods                  | Purpose                                                                                     |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `/api/internal/ops/health`               | GET                      | Configuration-aware provider readiness without revealing secrets                            |
| `/api/internal/ops/moderation`           | GET, PATCH               | Paid-comment queue and exact-text approve/reject decisions                                  |
| `/api/internal/ops/restream-ingest`      | POST                     | Normalized external chat ingestion from the bridge                                          |
| `/api/internal/ops/restream-oauth-start` | POST                     | Create a one-time, CSRF-protected Restream authorization URL                                |
| `/api/internal/restream-token`           | POST                     | Bridge-only broker for refreshed Restream access tokens                                     |
| `/api/internal/ops/events`               | GET, POST, PATCH         | Event configuration, provider/player identifiers, and per-event access pricing              |
| `/api/internal/ops/studio`               | GET                      | Open Studio URL for an event (`eventId` or `slug`); camera stays on Accountabul             |
| `/api/internal/ops/live-alerts`          | POST                     | Send the schedule-time hop-on announcement for a scheduled event (`eventId`)                |
| `/api/internal/ops/catalog`              | POST                     | Create approved Stripe test Products/Prices and bind event passes                           |
| `/api/internal/ops/speaker-requests`     | GET, PATCH               | Queue decisions and one-time encrypted Restream guest paths                                 |
| `/api/internal/ops/payments`             | GET, POST                | Payment records, webhook failures, and idempotent Stripe refunds                            |
| `/api/internal/ops/providers`            | GET                      | Configuration-aware provider health without raw secrets                                     |
| `/api/internal/ops/metrics`              | GET                      | Event presence, chat, pass, and tip metrics                                                 |
| `/api/internal/ops/audit`                | GET                      | Immutable operations audit activity and migration-batch history                             |
| `/api/internal/ops/businesses`           | GET, PATCH               | Business review queue and atomic approval decisions                                         |
| `/api/internal/ops/properties`           | GET, PATCH               | Property review queue and atomic publication decisions                                      |
| `/api/internal/ops/services`             | GET, PATCH               | Service oversight queue and atomic review/suspension decisions                              |
| `/api/internal/ops/credentials`          | GET, PATCH               | Private business-credential review and public-display decisions                             |
| `/api/internal/ops/session`              | POST                     | Legacy environment-backed password verification; not used by managed Google sign-in         |
| `/api/internal/ops/community-rooms`      | GET, POST, PATCH, DELETE | Create and permission community chat rooms; soft-delete retains history                     |
| `/api/internal/ops/community-moderation` | GET, POST                | Post-publication chat moderation: flagged/reported queue, restrictions, append-only history |

Every operations-data request uses `Authorization: Bearer <OPERATIONS_API_KEY>` from
the Lovable server runtime. Missing configuration returns 503, missing bearer
authentication returns 401, and an incorrect token returns 403. The legacy `/session`
endpoint also accepts the bearer credential and verifies an environment-backed operator
password, but the current console does not call it.

## Deployment pairing and rotation

The API base URL and bearer key are an inseparable environment pair:

1. Choose the exact Accountabul origin whose data the console will administer.
2. Store one newly generated high-entropy key as `OPERATIONS_API_KEY` on that Accountabul
   origin and as `OPERATIONS_API_KEY` in the private Ops Hub.
3. Store the selected origin as `ACCOUNTABUL_OPERATIONS_API_BASE_URL` in the Ops Hub.
4. Verify the Accountabul health endpoint returns 401 without a bearer, 403 with an
   intentionally incorrect bearer, and 200 only with the protected matching key.
5. Verify `/businesses` loads real records after Google sign-in before performing a
   decision.
6. When rotating, configure and deploy the Accountabul side first, then update the Ops
   Hub immediately, verify a 200 health response, and revoke the previous key. Never
   paste either key into source, Lovable chat, logs, screenshots, or documentation.

The preview origin is useful for same-project checks, but Lovable's private preview access
gate prevents another project from using it as a server-to-server API origin:

```text
ACCOUNTABUL_OPERATIONS_API_BASE_URL=https://id-preview--b5380cc3-66e3-48e7-a502-6344428e07c2.lovable.app
```

The active Ops Hub pairing therefore uses the published origin:

```text
ACCOUNTABUL_OPERATIONS_API_BASE_URL=https://accountabul-foundry.lovable.app
```

On 2026-09-01, a newly generated 64-character bearer key was stored only in both Lovable
Cloud secret stores, Accountabul was published from merge commit `a0228ce`, and the live
health boundary returned 401 without a bearer, 403 for an incorrect bearer, and 200 for
the protected matching key. The allowlisted Google owner session then loaded the two real
published business records in `/businesses`. The Ops Hub remains private and unpublished.

The initial API supports one allowlisted managed-Google owner behind one service principal.
Before employee access is added, define an employee lifecycle and propagate signed operator
claims so every write-audit entry names the human operator. Catalog and refund writes
additionally require `STRIPE_OPERATIONS_MUTATIONS_ENABLED=true`, use the operations-only
restricted key, and leave payment status authoritative to signed webhooks.

Catalog writes return either `200` for an existing entry or `201` for a newly created entry with `{ productId, priceId, amountMinor, currency, environmentVariable, alreadyExists }`. `environmentVariable` is `null` for event passes because their Stripe IDs are stored on the event instead of in deployment configuration.

## Per-event access pricing

Each event can independently sell three things, at whatever price Ops sets — see
[EVENT_ACCESS_PRICING.md](./EVENT_ACCESS_PRICING.md) for the full model. Set these on
`POST`/`PATCH /api/internal/ops/events`, alongside the existing fields:

| Field                          | Type              | Meaning                                                             |
| ------------------------------ | ----------------- | -------------------------------------------------------------------- |
| `allowWatchPurchase`           | boolean           | Sell watch-only access for this event                                |
| `watchPriceMinor`              | integer \| null   | Price in minor units (cents). `0` = free. Required when the flag above is on |
| `allowWatchAndChatPurchase`    | boolean           | Sell watch + unlimited chat for this event                           |
| `watchAndChatPriceMinor`       | integer \| null   | Same rules as `watchPriceMinor`                                      |
| `allowGuestComment`            | boolean           | Sell one-time guest comments for this event                          |
| `guestCommentPriceMinor`       | integer \| null   | Same rules; `0` lets anyone comment once for free with no checkout   |
| `pricingCurrency`              | 3-letter code     | Shared by all three prices for this event. Defaults to `USD`         |

Turning a purchase type on without a price (including `0`) is rejected with `400`. These
fields only apply when `accessMode` is `subscriber_or_pass` for watch and watch+chat;
guest comments can be sold under any access mode. `GET /api/internal/ops/events` returns
the current values so the console can show what is actually configured.

There is no separate endpoint to call before setting a price: no Stripe Product or Price
is created for these. Checkout uses inline `price_data` at the moment someone pays, the
same mechanism already used for tips, so changing a number here takes effect on the very
next purchase.

## Business approval contract

`GET /api/internal/ops/businesses` returns the current business records needed by the review queue. A record needs review when it is pending or in review, including a legacy partial approval such as `published` + `in_review` + public profile disabled. The console must derive its badges, queue count, and disabled actions from the complete state; `profile_status` alone is not approval.

`PATCH /api/internal/ops/businesses` accepts:

```json
{
  "id": "<business UUID>",
  "decision": "approve | request_changes | reject | suspend",
  "note": "required for request_changes, reject, and suspend"
}
```

The endpoint calls the `review_business` database function. The API and database both
enforce the required-note rule. The business update and audit entry are one transaction,
so a failed audit cannot leave the business half-approved. The resulting states are:

The database also rejects duplicate decisions and rejects suspension unless the current
row is canonically approved. State conflicts return HTTP `409`; malformed JSON and invalid
request values return `400`; failed authorization returns `401` or `403`. These failures do
not change the business or append an audit entry.

| Decision          | Profile status | Verification | Public page | Published timestamp |
| ----------------- | -------------- | ------------ | ----------- | ------------------- |
| `approve`         | `published`    | `verified`   | enabled     | set once            |
| `request_changes` | `draft`        | `unverified` | disabled    | cleared             |
| `reject`          | `rejected`     | `rejected`   | disabled    | cleared             |
| `suspend`         | `suspended`    | `expired`    | disabled    | cleared             |

A business is publicly approved only when all three canonical fields agree: `profile_status = published`, `verification_status = verified`, and `public_profile_enabled = true`. Public reads of the business, its services, its property listings, and property media all apply this same parent-business rule. Owners can prepare draft services and properties before approval. After approval, they can publish services and submit properties for review; only Accountabul staff can publish a property listing.

The migration repairs existing `published` records left in a partial state by the previous console. This intentionally completes approval for businesses already approved by an operator, including the FlowRight Plumbing test record, rather than asking the operator to click Approve again.

## Content review contracts

`GET /api/internal/ops/properties`, `/services`, and `/credentials` return bounded review
records for their corresponding Operations Console queues. Each `PATCH` accepts a target
`id`, `decision`, and optional `note`, then delegates to one transactional database
function. Property and service decisions are `approve`, `request_changes`, `reject`, and
`suspend`. Credential decisions are `approve` and `reject`.

Property and service approval is valid only from `pending_review`; suspension is valid
only from `published`. A property or service cannot be approved unless its parent business
is canonically approved. Property approval results in `published`, requesting changes
results in `draft`, rejection results in `rejected`, and suspension results in `archived`.
Credential approval results in `approved` with public display enabled; credential
rejection results in `rejected` with public display disabled.

All decisions other than approval require a note, except credentials where rejection is
the only note-required decision. Notes are capped at 2,000 characters. State conflicts
return `409`, authorization failures return `401` or `403`, malformed requests return
`400`, and missing records return `404`. The database row lock, transition, and audit
insert occur together; failures change neither the record nor the audit log.

These content-review database functions are a server-only boundary. Migration
`20260901174957` revokes execution from `PUBLIC`, `anon`, and `authenticated` and grants
it only to `service_role`. The Operations API authenticates the console bearer before its
server-side Supabase client invokes the function; browser clients cannot call the
privileged transition directly.

The complete workflow ownership, sequencing, and acceptance matrix is documented in
[`OPERATIONS_CONSOLE_MIGRATION.md`](OPERATIONS_CONSOLE_MIGRATION.md).

`GET /api/internal/ops/community-rooms` returns `{ items }` of every room, including
inactive and soft-deleted rows, each with `grants` and `message_count`. Members never
receive this payload. `POST` creates a room (`name` required; `slug` optional and derived
from the name). `PATCH` updates the same fields and fully replaces grants, and `restore: true`
clears a previous deletion. `DELETE` requires `id` and sets `deleted_at` plus
`is_active = false`; messages are retained because `community_messages.room_id` is
`on delete restrict`. A slug already in use — including by a deleted room, which keeps
its slug — returns `409`. Access is `signed_in`, `verified_vendor`,
`role_allowlist`, or `user_allowlist`. Role grants use `app_role`. People grants accept
user UUIDs or `@handles`. Empty allowlists admit nobody. Audit actions are
`ops.community_room.created|updated|deleted`. Console screen handoff:
[`LOVABLE_COMMUNITY_CHAT_HANDOFF.md`](LOVABLE_COMMUNITY_CHAT_HANDOFF.md).

`GET /api/internal/ops/community-moderation` reads the chat moderation queue
(`?view=queue`, messages with open automated flags or member reports), active member
restrictions (`?view=restrictions`), or the append-only moderation history
(`?view=history`). `POST` performs one staff action: `hide_message`, `unhide_message`,
`delete_message`, `restore_message`, `dismiss_flags`, `mute_user`, `remove_from_room`,
`ban_user`, or `lift_restriction`. Removing content or restricting a member requires a
`reason`. Chat is publish-first: this queue never holds messages waiting for approval.
The full model is in [`COMMUNITY_CHAT_MODERATION.md`](COMMUNITY_CHAT_MODERATION.md).

`GET /api/internal/ops/audit` keeps audit entries in `items` and additionally returns
bounded migration history in `migrationBatches`. Existing console audit clients remain
compatible because the original `items` response is unchanged.

## Lovable project

- Project ID: `dc195de9-3c2b-4d8f-8013-785dc734f9ad`
- Editor: <https://lovable.dev/projects/dc195de9-3c2b-4d8f-8013-785dc734f9ad>
- Preview: <https://id-preview--dc195de9-3c2b-4d8f-8013-785dc734f9ad.lovable.app>
- Business-review commit: `59709ac9bab76f963ea0788bf048ba6b3501c90e`
- Managed Google consolidation and fail-closed session commit: `beeb3c46c4954452208b7c2be47eea91bd5081fa`

It contains the existing operations routes plus the `/businesses` review console,
type-safe API contracts, managed Google owner authentication, no fabricated records, and
server-only authorization. The allowlisted `owner@accountabul.example` owner session was verified
in the preview on 2026-09-01. Accountabul data remains unavailable until the protected API
base URL and shared bearer key are provisioned. Keep the project private and unpublished.
