# Conference Room Architecture

> **Shelved for Accountabul Live.** Restream playback, guest/speaker links, and this v1 speaker-request path are frozen. The live conference product (green room, countdown, same-page stage invite, hop-on alerts) is specified in [ACCOUNTABUL_LIVE_DESIGN_SPEC.md](ACCOUNTABUL_LIVE_DESIGN_SPEC.md). Do not delete this document or Restream history.

## Scope

Version 1 supports one live Accountabul conference room, one company Restream account, Stripe memberships and one-time payments, moderated Accountabul chat, imported external chat, event passes, tips, paid guest comments, and subscriber speaker requests.

The three deployment boundaries are:

1. **Accountabul member application** — playback, access, chat, purchases, billing, and speaker requests.
2. **Accountabul Operations Console** — private Lovable project `dc195de9-3c2b-4d8f-8013-785dc734f9ad`; it never holds a Supabase service-role key and calls only `/api/internal/ops/*` with a server-only bearer credential.
3. **Restream chat bridge** — Cloudflare Worker/Durable Object in `workers/restream-chat-bridge`; it owns the Restream WebSocket, heartbeat recovery, history backfill, and normalized ingestion.

## End-to-end data flows

### Playback and access

1. The public event query returns only safe event columns. Provider identifiers and playback URLs are denied at the PostgreSQL column-grant boundary.
2. `getConferencePlayback` reads the current user if present, checks subscription and event-pass state server-side, and applies the event access mode.
3. Only the server function returns the currently eligible live or replay URL.
4. Public events are watchable while signed out. Subscriber events require an active/trialing membership or a `past_due` membership whose three-day grace deadline has not passed. `subscriber_or_pass` also accepts an active, unexpired event pass.

Passes grant playback and first-party comments for their event. They never grant speaker-request permission. Only an active subscription grants speaker requests.

### Chat

```text
Restream authenticated WebSocket
  → Cloudflare Durable Object
  → protected /api/internal/ops/restream-ingest
  → deterministic + omni-moderation-latest screening
  → normalized chat_messages row
  → Supabase Realtime
  → Accountabul clients
```

Restream uses an authorization-code OAuth flow with a one-time, ten-minute state stored in the private schema. Access and refresh tokens are AES-256-GCM encrypted at rest. Private tables are not exposed through the Data API; narrowly scoped `private_*` RPCs are revoked from PUBLIC, `anon`, and `authenticated`, and granted only to `service_role`. The bridge has a distinct secret for the token broker and never stores a long-lived Restream access token.

Stripe uses independent restricted keys for member checkout, operations catalog/refunds, and webhook processing. All Checkout Sessions use the stable Accountabul integration identifier. Membership catalog records enforce one Product per tier with distinct monthly/annual Prices; payment and entitlement state remains webhook-derived.

The client subscribes to PostgreSQL changes and retains a 30-second history query as recovery. The bridge treats a missing Restream heartbeat for 60 seconds as a broken connection, reconnects, and requests Event Chat History starting at the last stored timestamp. A composite SHA-256 key plus the database unique index suppress duplicates.

All external and first-party comments fail closed. If automated moderation is unavailable or uncertain, the row is quarantined and has no `published_at`, so the public RLS policy cannot expose it. Accountabul comments are not sent to Restream or external platforms.

### Paid guest comments

1. Viewer submits the exact text, display name, and email.
2. Deterministic and OpenAI moderation run. The request remains non-payable if the provider is unavailable.
3. Staff approve or reject the exact stored text in the operations queue.
4. Approval stores the same SHA-256 body hash and expires after 30 minutes.
5. The checkout endpoint rechecks status, expiry, and exact hash, then creates the $1 Stripe Checkout Session.
6. Only a verified, idempotently processed Stripe webhook can create the published `paid_guest` chat message.
7. A rejected, edited, expired, failed, or hash-mismatched comment cannot reach publication.

### Stripe

The Stripe webhook event ledger has a unique provider/event identifier. It validates signatures against the raw body and applies monotonic transitions for tips and generic payment records. Checkout Session IDs, amounts, currencies, and exact-text hashes must match Accountabul records before an entitlement or comment is created. Subscription and invoice webhooks—not redirects—derive membership status, renewal payment records, recovery, and grace deadlines. Full and partial refund totals are recorded; only a full refund revokes an event pass.

Checkout Sessions omit `payment_method_types`, allowing Stripe to determine eligible methods dynamically. Every Session carries `integration_identifier=accountabul_web` and Accountabul record identifiers in metadata.

## Security boundaries

- Browser clients never receive Stripe, Supabase service-role, Restream OAuth, operations, or Palisade secrets.
- New tables enable RLS, use explicit grants, and give the service role the write boundary for provider-derived state.
- Operations endpoints require a constant-time compared server bearer token. The Lovable console sends it only from its server runtime.
- Restream OAuth must request only the scopes required for the enabled features, beginning with `chat.read`.
- The migration adds `chat_messages` to the `supabase_realtime` publication but never modifies the managed `realtime` schema.
- Provider tokens and links must use protected deployment secrets or encrypted private storage; public-table metadata stores references only.

## Deployment order

1. Review and apply the migration to a Supabase preview branch.
2. Generate Supabase types from the preview database and compare them with the checked-in contract additions.
3. Provision Stripe sandbox keys, restricted roles, catalog, and webhook endpoint.
4. Deploy Accountabul APIs with production-safe secrets.
5. Configure the private Lovable Operations Console with the Accountabul API base URL, operations key, and session secret.
6. Complete Restream OAuth and deploy the bridge with its three Worker secrets.
7. Run the dress-rehearsal matrix in `docs/LAUNCH_CHECKLIST.md`.
8. Apply the migration and cutover only after rollback and monitoring are ready.

## Non-goals for v1

- More than one concurrent room
- Relaying Accountabul comments to external platforms
- Tokenized stocks or real estate
- Hyperliquid
- Enabling Stripe Tax without verified registrations and tax codes
- Enabling crypto checkout before the Palisade/provider sandbox gates pass. Named USDC tips exist on `conference-room-tips` behind `CIRCLE_USDC_TIPS_ENABLED` and stay off by default. See `docs/CONFERENCE_ROOM_USDC_TIPS.md`.
