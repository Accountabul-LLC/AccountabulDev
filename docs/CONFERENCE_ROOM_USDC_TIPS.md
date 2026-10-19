# Conference Room USDC Tips

Status: the adapters (`src/lib/crypto/adapters.ts`, `circle-wallets.server.ts`) are on `main`, flag-gated. Crypto stays disabled unless `CIRCLE_USDC_TIPS_ENABLED=true` and Circle sandbox secrets are set — the flag defaults off in production. The production gates below still apply before flipping it on live.

Date: 2026-09-04.

Live-stream tips can be paid in USDC, treated as USD. Named speech is required before a quote. Crypto remains disabled until the launch gates in this document and in `docs/PALISADE_PILOT.md` pass.

## Decision

Live tips are a **named, spoken payment**.

A viewer may not send USDC (or complete Stripe checkout) until Accountabul already holds:

- a display name
- a message
- a USD amount (`amount_minor`, currency `USD`)
- an idempotent attempt id

USDC is **$1.00 USD**. Store cents, not token decimals, on `tips`. Convert to USDC base units (6 decimals) only inside the checkout adapter.

Do not use a shared always-on tip-jar address. Each accepted intent gets a **one-time quote**: unique deposit address or memo bound to `tips.id`. Unmatched inbound USDC is held, never shown as a named tip.

Circle is the USDC rail (quote, inbound transfer, webhook). Palisade remains the later treasury/sweep layer, not the live-room checkout UI.

Stripe card tips stay the first live rail. The same lock (name + message + webhook → chat) applies to both rails so the room does not behave differently by payment method.

## Why this shape

Paid guest comments already do the hard part: lock exact text, refuse checkout without it, publish to chat only from a verified webhook. Tips today do not:

- Message is optional; guests send email, not a display name.
- Paid tips update `tips.status` and never insert a `chat_messages` row, even though the live room styles `kind === "tip"`.
- `DisabledCryptoCheckoutAdapter` still throws until Palisade sandbox gates pass.
- Palisade webhooks currently record health only. They do not reconcile a tip or publish chat.

A raw wallet address cannot carry a name. The speech has to be collected before the transfer. Matching “some USDC arrived” by amount will collide on a live show.

## Viewer flow

```text
live /:slug
  → name + message + USD amount (required)
  → server creates tips row status=created (and payment_records)
  → Stripe Checkout  OR  USDC quote (address / QR / expiry)
  → signed provider webhook
  → tips.status=paid
  → chat_messages kind=tip (name, amount, message)
  → ops payments list + host dashboard
```

Rules:

1. The browser never marks a tip paid.
2. Submit without name or message is `400`. Empty whitespace does not count.
3. Retrying the same `attemptId` must not create a second tip or a second quote.
4. Changing name, message, or amount on retry of the same attempt is rejected.
5. The on-stream line is published only after `paid`, from the stored name and message, not from the webhook payload’s optional memo.
6. Tip message copy is moderated the same way as paid comments: fail closed. If automated moderation is unavailable, do not issue checkout or a USDC quote.

## USDC quote (Circle)

USD $10.00 → `amount_minor = 1000` → Circle transfer `10_000_000` (6 decimals). Native Circle USDC only. No USDT, USDC.e, or wrapped variants.

The `CryptoCheckoutAdapter.createQuote` input is:

- `referenceId` = `tips.id`
- `usdAmountMinor`
- `asset` = `USDC`
- `network` = the single v1 network (open decision below)
- `expiresInSeconds`

The quote returns deposit address, optional memo, QR payload, exact asset amount, and expiry. The live panel shows that quote. After expiry the intent cannot be paid; the viewer starts a new attempt.

Webhook matching key is `tips.id` (and the provider quote/transaction id stored on `provider_record_id` / `payment_records`). Never match on amount alone.

Unmatched deposits (no prior intent, wrong amount, expired quote) stay in the tip wallet and surface in ops as unmatched. They do not appear in chat.

## Data

Reuse `tips`, `payment_records`, `payment_events`, and `chat_messages`. Prefer columns over a new table.

Likely additions (migration on this branch only, when build starts):

- `tips.guest_display_name` (required for guests; signed-in users may default from profile but can override)
- `tips.message` required (non-empty, max 280, stored exact text + sha256)
- `tips.provider` = `stripe` | `circle` (or the checkout adapter name)
- `payment_records.crypto_transaction_id` already exists — use it for the inbound USDC tx hash
- `chat_messages.kind = 'tip'`, `author_display_name` from the locked name, `external_id` = payment record id, `published_at` set only when paid

Idempotency stays `idempotency_key` unique. Guest key remains email-scoped; signed-in key remains `userId:attemptId`.

Money stays `bigint` minor units + `USD` (ADR-008). Do not store `USDC` as `tips.currency`.

## Backend and ops

- Signed-in: extend `createTipIntent` in `src/lib/tips.functions.ts`.
- Guest: extend `src/routes/api/public/tips.ts`.
- Stripe paid path: `src/routes/api/public/webhooks/stripe.ts` must insert the tip chat row the same way paid comments insert `paid_guest` rows.
- Circle (later phase): new webhook route next to `src/routes/api/public/webhooks/palisade.ts`. Verify signature, ledger `payment_events`, monotonic tip transition, then the same chat publish helper.
- Ops: `src/routes/api/internal/ops/payments.ts` already lists payments. Add provider, display name, unmatched-crypto flag. Do not add an `/admin` page (ADR-012).
- Live UI: `TipPanel` in `src/routes/live.$slug.tsx` — required name + message, then Stripe redirect or USDC quote panel.

Secrets stay server-only. The browser may receive a public deposit address, QR payload, expiry, and amount. It must never receive Circle/Palisade keys.

## Stripe vs USDC

| | Stripe (v1 live rail) | USDC (this branch, after gates) |
|---|---|---|
| Denomination | USD cents | USD cents, paid as USDC 1:1 |
| Lock | name + message before Checkout | name + message before quote |
| Confirmation | Stripe webhook | Circle (or Palisade) webhook |
| Chat | publish on `paid` | publish on `paid` |
| Guest receipt | email required | email required |

Do not block Stripe tips on Circle. Ship the lock + chat publish on Stripe first so the room behavior is real before any wallet is funded.

## Circle vs Palisade

```text
viewer
  → Circle USDC quote + inbound webhook     (checkout)
  → Accountabul ledger + chat
  → optional sweep
  → Palisade treasury wallet                (custody)
```

Circle does not replace Palisade. Circle does not accept BTC, ETH, XRP, SOL, or USDT. Those assets stay on the approved list in `src/lib/crypto/adapters.ts` and stay out of v1.

`docs/PALISADE_PILOT.md` still applies: no production crypto until written eligibility and counsel approval for Accountabul’s US third-party tipping/treasury model.

## Phases

### Phase 0 — this document (done on this branch)

Plan only. No adapter enablement. No main merge.

### Phase 1 — named Stripe tips on the live room

Buildable without Circle.

- Require display name + message on guest and signed-in tip intents.
- Hash the message; refuse retries that change locked fields.
- Run the same fail-closed moderation as paid comments before Checkout.
- On Stripe `paid`, insert `chat_messages` `kind=tip` with name, formatted USD amount, and message.
- Show that line in the live room; list it in ops payments.
- Tests: missing name/message rejected; webhook without matching session does not publish; duplicate webhook does not double-post chat.

### Phase 2 — USDC quote adapter (sandbox)

- Implement `CryptoCheckoutAdapter` for USDC only; keep `DisabledCryptoCheckoutAdapter` as default.
- Feature-flag / env gate. Ops `crypto_checkout` stays offline until the flag is on in sandbox.
- Unique deposit per `tips.id`; expiry; QR; 6-decimal conversion.
- Circle webhook: signature, idempotent `payment_events`, amount/currency/reference bind, unmatched deposit handling.
- Same chat publish helper as Phase 1.
- Tests: expired quote cannot pay; wrong amount does not pay; replay is idempotent.

### Phase 3 — Palisade treasury

- Sweep confirmed USDC from the tip wallet into Palisade under policy.
- Trace `tip id → Circle tx → Palisade tx/wallet → chain hash`.
- Kill switch for sweep. Unmatched deposits do not auto-sweep into “tips revenue” without an ops action.

### Phase 4 — production gate

Do not merge to `main` or enable live USDC until:

- Phase 1 is on a rehearsal event and chat lines match paid Stripe tips.
- At least one USDC sandbox path meets `docs/LAUNCH_CHECKLIST.md` crypto criteria (fees, minimums, confirmation time, refunds, sanctions, custody, treasury, reconciliation).
- Counsel / policy sign-off on name+message public display, guest email, and USDC tipping.
- Palisade written eligibility still required before any sweep of real funds.
- `DisabledCryptoCheckoutAdapter` remains the default in production config until that gate is recorded.

## Non-goals (v1)

- Accepting “any crypto”
- USDT, BTC, ETH, XRP, SOL checkout
- Shared public tip-jar address
- Client-declared paid tips
- Relaying tip chat to Restream / YouTube / Facebook
- Changing membership, event-pass, or paid-comment money flows
- Enabling Stripe Tax
- Mainnet Circle or Palisade keys on this branch

## Open decisions (need the project owner)

Resolved for this branch:

1. First USDC network: Base (Sepolia unless `CIRCLE_LIVE_MODE=true`).
2. Inbound wallet: Circle developer-controlled EOA per tip; Palisade sweep is still Phase 3.
3. Signed-in members still type a name (no silent profile skip).
4. Tip messages use automated moderation only; paid comments keep the human queue.
5. On-stream line: `{name} tipped {$amount} — {message}`.

## Files this branch will touch when build starts

Do not edit these until Phase 1 is approved:

- `src/routes/live.$slug.tsx` — TipPanel lock + USDC quote UI later
- `src/lib/tips.functions.ts` / `src/routes/api/public/tips.ts` — require name + message
- `src/routes/api/public/webhooks/stripe.ts` — publish tip chat on paid
- `src/lib/conference/moderation.ts` (+ server) — tip message screening
- `src/routes/api/internal/ops/payments.ts` — name / unmatched deposit
- `src/lib/crypto/adapters.ts` — USDC Circle adapter behind the disabled default
- new `src/routes/api/public/webhooks/circle.ts` (Phase 2)
- `docs/CONFERENCE_ROOM_ARCHITECTURE.md` — add this flow; keep Palisade crypto non-goal until Phase 4
- tests next to `tests/stripe-webhook.test.ts` and `tests/conference.test.ts`

## Rollback

Phase 1: revert the tip-intent validation and chat insert; Stripe checkout still works as today.

Phase 2: leave `DisabledCryptoCheckoutAdapter` as default; Circle webhook returns 503 without secrets; unmatched USDC stays in the sandbox wallet.

Never enable production USDC from this branch by flipping an env var on `main`.
