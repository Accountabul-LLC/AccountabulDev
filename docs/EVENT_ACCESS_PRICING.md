# Live event access pricing

Extends the existing Stripe integration — one Stripe account, one customer per member
(`billing_customers`), one webhook, one payment ledger (`payment_records`). Nothing here
is a second payment system. See [OPERATIONS_API.md](./OPERATIONS_API.md) for how Ops sets
prices, and [COMMUNITY_CHAT_MODERATION.md](./COMMUNITY_CHAT_MODERATION.md) for how the
publish-first chat model this extends works.

## The model

```
Event → Access Type (watch / watch+chat / guest comment) → Stripe Price → Payment → EventAccess
```

Stripe takes the money. Accountabul's own tables say what that money bought. No Stripe
Product or Price is created per event: Checkout is built with inline `price_data` at the
moment of purchase (`createVariableAmountCheckout` in
[checkout.server.ts](../src/lib/billing/checkout.server.ts) — the same mechanism tips
already used), reading the amount fresh from the event row every time. Ops changes a
number in the database; nothing in Stripe needs to change.

Three independently configurable access types, each with its own toggle and price on
`events`:

| Access type      | Grants                                    | Record                          |
| ----------------- | ------------------------------------------ | -------------------------------- |
| `watch`            | The video, not the chat                     | `event_passes`, `access_type='watch'` |
| `watch_and_chat`   | The video and unlimited chat                | `event_passes`, `access_type='watch_and_chat'` |
| guest comment      | One comment, this event only                | `paid_comments`, one row per comment |

A purchase is scoped to one event. It is never a subscription and never carries forward
to another event — `payment_records.kind = 'event_pass'` uses `mode: 'payment'`, not
`'subscription'`.

## Where the logic lives

- **`src/lib/conference/event-pricing.ts`** — pure. Reads an event's configured columns
  and says what is actually for sale, at what price, and whether it's free. No I/O. This
  is the one place "is this free / is this offered" is decided; the event page, the
  composer, and every server handler call the same functions rather than each
  re-deriving it.
- **`src/lib/conference/chat-access.ts`** — pure. `decideChatSend()` is the
  `GetEventChatAccess`-equivalent the brief asked for: given chat-open state, who is
  asking, whether they're restricted, their resolved membership/pass entitlement, and
  this event's pricing, it returns exactly one of `publish`, `publish_free_comment`,
  `sign_in`, `payment_required`, `restricted`, or `closed`. Every caller — the send
  handler, the pay handler, the room UI — goes through this one function.
- **`src/lib/conference/entitlements.ts`** — `resolveEventEntitlement()` now takes
  `passAccessType: "watch" | "watch_and_chat" | null` instead of a boolean, so a
  watch-only pass unlocks the video but not the room. `highestPassAccessType()` picks
  the best of however many passes a user holds for one event (a watch+chat purchase
  after an earlier watch purchase upgrades them; it never regresses).
- **`src/lib/conference/event-access.server.ts`** — buying watch or watch+chat. Shared
  by the signed-in purchase (`billing.functions.ts::createEventPassCheckout`) and the
  anonymous/guest purchase (`routes/api/public/event-passes.ts`), so there is exactly
  one place that reads the price, one place that skips Stripe for a free event, and one
  shape of `payment_records` row for the webhook to reconcile.
- **`src/lib/conference/live-chat.server.ts`** — `publishFreeGuestComment()` (free,
  no Stripe) and `createPaidCommentCheckout()` (priced, via the shared checkout helper)
  for guest comments specifically, plus the publish-first message pipeline this already
  had.
- **`src/routes/api/public/webhooks/stripe.ts`** — unchanged endpoint, unchanged
  idempotency (`payment_events(provider, provider_event_id)` unique key, plus
  `payment_records.idempotency_key`). It now also reads `access_type` out of
  `payment_records.metadata` when activating an `event_passes` row, defaulting to
  `watch_and_chat` for anything checked out before this metadata existed.

## Free events

A price of `0` is a real, explicit choice by Ops — distinct from `null` ("not sold at
all"). A free purchase never reaches Stripe: `purchaseEventAccess()` and
`publishFreeGuestComment()` insert the access record directly (`event_passes.granted_free
= true`, or a `paid_comments` row with no `payment_record_id`) and return immediately.
The `event_passes.payment_record_id` column is nullable specifically for this — a
`granted_free` row is guaranteed by a check constraint to have no payment reference, and
every non-free row is guaranteed to have one.

## Anonymous buyers

A guest with no account is recognized afterward by a random token: hashed and stored on
the pending `event_passes` row, the raw value set as an `HttpOnly` cookie. This is
unchanged from before — `event-access.server.ts` just gives it a `buyer:
{ email, accessTokenHash }` shape alongside the signed-in `buyer: { userId }` shape,
so the same function handles both.

## What a member never has to retype

Guest-comment and account-required flows preserve the composer's text through sign-in,
signup, and the Stripe redirect (`src/lib/live/chat-draft.ts`, localStorage, cleared only
once the message is actually published). This predates the pricing work and is untouched
by it — the price a message costs to send changed; the "never lose what you typed"
guarantee didn't.

## Verifying in Stripe test mode

Not yet exercised end-to-end in this environment: `STRIPE_MEMBER_RESTRICTED_KEY` (and the
other checkout-purpose keys) are not set here, so `missingStripeCheckoutSecrets()` is
non-empty and every non-free checkout path returns "unavailable" rather than reaching
Stripe. The pure decision logic, the free-event bypass, the per-event amount plumbing,
and the webhook's `access_type` handling are covered by
[tests/live-chat-access.test.ts](../tests/live-chat-access.test.ts) and
[tests/conference.test.ts](../tests/conference.test.ts). Once test-mode keys are in
place, exercise: a $5 watch purchase, a $10 watch+chat purchase, a $1 guest comment, two
events with different prices, a free event (no Stripe redirect at all), a failed card, a
canceled Checkout, a duplicate webhook delivery (should not double-grant), and returning
from Stripe on a slow connection (the room should poll and land on "published" once the
webhook catches up).
