# Conference and Payments Launch Checklist

## Provisioning

- [ ] Stripe Accountabul account has the final legal entity, EIN, owners, bank, branding, support details, and live activation.
- [ ] Stripe sandbox mirrors production catalog and Portal settings.
- [ ] Restricted keys and account-specific webhook signing secrets are in protected deployments.
- [ ] Supabase migration has passed preview-branch reset, lint, grants/RLS review, and generated-type comparison.
- [ ] Operations Console is private, noindexed, authenticated, and cannot reach Supabase directly.
- [ ] Restream OAuth uses minimum scopes and refresh-token rotation is server-side.
- [ ] Restream plan includes the Website Video Player, or an approved alternative player strategy is documented.
- [ ] Restream bridge Worker secrets are set and no token appears in browser bundles or logs.
- [ ] Community Standards version is reviewed by Accountabul counsel/policy owner.

## Automated test matrix

- [x] Public, subscriber, pass-holder, denied, and failed-renewal grace calculations
- [x] Stripe signature tolerance and malformed event rejection
- [x] Matching amount/currency/Session requirement and terminal-state protection
- [x] Exact paid-comment hash and approval-expiry rules
- [x] Restream normalization and dedupe key
- [x] Restream official source-ID mapping and Event Chat History record normalization
- [x] Operations token missing/incorrect/correct behavior
- [x] Operations operator password hashing and verification
- [x] Generic payment partial-refund accounting and non-tip Checkout isolation
- [x] Deterministic fuzz/property testing for entitlements, authorization, moderation, Stripe bindings/signatures, Restream dedupe, and speaker-link tampering
- [x] Webhook retry preserves and replays idempotent paid-comment/pass side effects after a partial processing failure
- [ ] Subscription create/renew/fail/recover/cancel against Stripe sandbox
- [ ] Duplicate, delayed, out-of-order, and invalid-signature webhook fixtures against a preview database
- [ ] Event-pass activation/refund/revocation against Stripe sandbox
- [ ] Paid-comment approval/payment/failure/refund/publication against preview database
- [ ] Restream heartbeat loss/reconnect/history backfill against a real sandbox event
- [ ] Speaker approval, expired guest link, and unauthorized operations request end to end
- [ ] Moderation corpus for hate, harassment, threats, sexual content, self-harm, spam, obfuscation, and unsupported languages
- [ ] Palisade signatures, replay protection, confirmation, sweeping, and reconciliation in sandbox

## Dress rehearsal

- [ ] Schedule a non-public rehearsal event with the final Restream player.
- [ ] Join signed out, as active member, pass holder, expired pass holder, canceled member, and grace-period member.
- [ ] Confirm only the expected users receive playback and comment access.
- [ ] Disconnect Restream chat for at least 60 seconds; verify reconnect, backfill, and no duplicate messages.
- [ ] Confirm an OpenAI moderation outage quarantines every new message.
- [ ] Approve one exact $1 guest comment, change one character before checkout, and confirm checkout is refused.
- [ ] Deliver and expire a speaker guest link; confirm it cannot be reused.
- [ ] Review provider health, webhook failures, audit activity, refunds, metrics, and reconciliation in the operations console.
- [ ] Verify responsive layouts at 320, 375, 768, 1024, and 1440 pixels.
- [ ] Record the Stripe cutover timestamp, owners, rollback decision-maker, and legacy webhook retirement date.

## Launch gates

Production passes and paid comments remain disabled until Stripe readiness passes and at least one approved crypto rail passes fee, minimum-payment, confirmation-time, refund, sanctions, custody, treasury, and reconciliation testing. Crypto remains disabled in code by default.
