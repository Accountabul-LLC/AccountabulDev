# Conference Room and Payments Release-Readiness Audit

Audit date: August 26, 2026

This is the authoritative handoff checklist for the conference-room and payments foundation. It distinguishes four states that must not be conflated:

- **Landed** — present on `main`.
- **Implemented** — present on `codex/conference-room-payments` but not yet on `main`.
- **Provisioned** — created in an external provider account.
- **End-to-end verified** — exercised through deployed Accountabul APIs, provider webhooks, and the database.

Pull request [#2](https://github.com/Accountabul-LLC/accountabul-final/pull/2) was merged into `main` as commit `304e332`. The conference foundation is therefore **landed in source control**. Direct SQL against the backend bound to this application confirms that migrations `20260826083651`, `20260826084327`, `20260826084415`, and the forward-only privilege correction `20260826091538` are each recorded exactly once. Migration `20260826032843` was an unapplied duplicate and has been removed from the repository; it was not applied and does not appear in the ledger.

## Evidence summary

| Area                               | Implemented           | Externally provisioned         | End-to-end verified               | Current evidence                                                                                                                      |
| ---------------------------------- | --------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Conference access and entitlements | Yes                   | Not applicable                 | Unit/property tests only          | Public, subscriber, pass, denial, cancellation, and three-day grace invariants pass                                                   |
| Public conference UI               | Yes                   | Preview exists                 | Empty-state responsive QA only    | `/live` renders without horizontal overflow at 320, 375, 768, 1024, and 1440 pixels                                                   |
| Stripe account foundation          | Yes                   | Partial                        | Partial API verification          | Account and sandbox exist; paid-comment Product/Price and three restricted-key roles were verified                                    |
| Membership billing                 | Yes                   | No approved tier catalog       | No                                | Checkout, Portal, subscription, invoice, grace, and webhook code exists; no approved tier names/prices or sandbox lifecycle rehearsal |
| Event passes                       | Yes                   | Dynamic catalog API only       | No                                | Checkout and webhook-derived entitlement/refund code exists; no migrated database or sandbox event                                    |
| Tips                               | Yes                   | Stripe sandbox available       | No full application flow          | Variable-amount Checkout and reconciliation code exists; no deployed test tip through Accountabul                                     |
| Paid guest comments                | Yes                   | `$1.00 USD` Price exists       | No full application flow          | Screening, moderator approval, hash lock, Checkout, webhook publication, refund, and retry-safe side effects exist                    |
| Stripe webhook destination         | Yes                   | Prepared, not created          | No                                | Eleven events and preview URL are filled; final persistent destination and signing secret remain uncreated                            |
| Operations console                 | Yes                   | Private Lovable project exists | Lock boundary verified only       | Unconfigured preview fails closed; server credentials and deployed API are absent                                                     |
| Restream OAuth                     | Yes                   | Developer app exists           | No                                | Client ID, callback, and four read-only scopes verified; secret is not stored and OAuth has not been authorized                       |
| Restream website player            | UI contract only      | No Embed Player channel        | No                                | The current Free plan does not include the Website Video Player; Restream documents it as Business/Enterprise                         |
| Restream chat bridge               | Yes                   | No Cloudflare deployment       | Unit tests only                   | WebSocket, heartbeat, reconnect, history paging, normalization, and broker code exists                                                |
| Moderation                         | Yes                   | OpenAI secret not configured   | Deterministic/property tests only | Fails closed in code; real moderation corpus and outage rehearsal remain                                                              |
| Database schema                    | Landed and applied    | Not applicable                 | Direct schema/security proof      | Applied chain and forward privilege correction are recorded once; generated types match the bound backend                              |
| Crypto checkout                    | Adapter boundary only | No                             | No                                | Disabled by default; no checkout/quote provider selected                                                                              |
| Palisade/Ripple treasury           | Pilot contract only   | No                             | No                                | Candidate treasury/custody layer; no Accountabul sandbox organization, wallets, credentials, policies, or sweep                       |

## Implemented feature checklist

### Access, playback, and participation

- [x] `public`, `subscriber`, and `subscriber_or_pass` event modes.
- [x] Any active/trialing paid membership unlocks member events.
- [x] Three-day failed-renewal grace handling.
- [x] Event-specific pass entitlement.
- [x] Pass holders may watch and comment but cannot submit speaker requests.
- [x] Signed-out public viewers can watch, read chat, tip, buy a pass, and submit a paid comment.
- [x] Member, Event Guest, Moderator, Paid Guest, and external-source badge contracts.
- [x] Server-only playback URL resolution.
- [ ] Real Restream player rendered in a scheduled or live Accountabul event.
- [ ] Full role matrix rehearsed against migrated preview data.

### Stripe and accounting

- [x] Account-scoped `StripeClient` integration using the current SDK/API contract.
- [x] Dynamic payment methods; no hard-coded card list.
- [x] Stable Checkout integration identifier.
- [x] Separate member, operations, and webhook restricted-key contracts.
- [x] One Product per membership tier with monthly/annual Price variants in the catalog contract.
- [x] Dynamic event-pass Product/Price creation contract.
- [x] Fixed paid-comment catalog validation at exactly `$1.00 USD`.
- [x] Variable one-time tips.
- [x] Provider IDs for catalog, customers, subscriptions, Checkout, payments, refunds, and webhook events in the schema.
- [x] Raw-body signature verification, five-minute tolerance, idempotent event ledger, and account checks.
- [x] Duplicate, delayed, and out-of-order transition protection in pure reconciliation tests.
- [x] Retry-safe idempotent payment side effects: publication/entitlement work is retried if a prior delivery updated payment state and then failed.
- [x] Full versus partial refund accounting; only a full refund revokes a pass.
- [ ] Stripe destination created and signing secret stored in protected deployment configuration.
- [ ] Approved membership tier Products/Prices and Customer Portal settings created.
- [ ] Subscription create/renew/fail/recover/cancel rehearsed against the sandbox.
- [ ] Event-pass purchase/refund/revocation rehearsed against the sandbox and preview database.
- [ ] Paid-comment submit/approve/pay/publish/refund rehearsed through the deployed app.
- [ ] Variable tip paid through the deployed app and reconciled by webhook.

### Chat, moderation, and speaker workflow

- [x] Normalized first-party and Restream message contract.
- [x] Supabase Realtime client subscription plus history recovery query.
- [x] Deterministic screening and `omni-moderation-latest` integration.
- [x] Fail-closed quarantine when moderation is unavailable or malformed.
- [x] Versioned Community Standards acceptance.
- [x] Paid-comment human approval, immutable SHA-256 text lock, approval expiry, and edit invalidation.
- [x] Protected, expiring, encrypted Restream speaker links restricted to HTTPS Restream hosts.
- [x] Accountabul comments are not relayed to external platforms.
- [ ] Community Standards approved by the policy/legal owner.
- [ ] Real moderation corpus and provider-outage rehearsal completed.
- [ ] Speaker approval, delivery, expiry, and reuse rejection completed end to end.

### Restream

- [x] OAuth authorization-code flow with one-time ten-minute state.
- [x] AES-256-GCM token storage, refresh, and tamper rejection.
- [x] Developer application **Accountabul Conference Room**.
- [x] Redirect URI targets the stable Accountabul preview callback.
- [x] Only `profile.read`, `channels.read`, `stream.read`, and `chat.read` are enabled.
- [x] WebSocket, 60-second heartbeat timeout, reconnect, and Event Chat History backfill code.
- [x] Composite duplicate suppression because Restream warns `eventIdentifier` is not globally unique.
- [ ] Client secret placed in protected Accountabul deployment configuration.
- [ ] OAuth authorization completed after the callback and private token tables are deployed.
- [ ] Website Embed Player channel purchased/configured, or a separately approved player strategy selected.
- [ ] Cloudflare Worker/Durable Object deployed with protected secrets.
- [ ] Real event disconnect, heartbeat-loss, backfill, and duplicate-suppression rehearsal.

### Operations application

- [x] Separate private Lovable project and eight requested interface areas.
- [x] Server-only API contracts for events, catalog, payments, moderation, providers, speakers, metrics, and audit.
- [x] Constant-time bearer credential comparison and salted operator password verification.
- [x] Preview fails closed when operations credentials are absent.
- [x] Operations project remains private and unpublished.
- [ ] Accountabul API base URL, operations key, session secret, operator email, and password hash configured.
- [ ] Managed staff identity and per-human audit claims added before more than one operator receives production access.
- [ ] All operations screens exercised against the deployed Accountabul API.

### Database

- [x] Applied migrations `20260826083651`, `20260826084327`, and `20260826084415` are restored byte-for-byte from commit `0632593422196db76f96450f2e3a0d7ef2f7513d`.
- [x] Forward-only migration `20260826091538_713ec23d-44cf-4258-ba78-357d41aa95bb.sql` removes broad member reads while retaining approved column-level access.
- [x] Nine new public tables explicitly enable RLS.
- [x] Six new `SECURITY DEFINER` functions pin `search_path`.
- [x] Four provider RPCs revoke PUBLIC/`anon`/`authenticated` and grant only `service_role`.
- [x] Migration changes only the `supabase_realtime` publication; it does not modify the managed `realtime` schema.
- [x] Direct ledger verification confirms `20260826083651`, `20260826084327`, `20260826084415`, and `20260826091538` exactly once and no `20260826032843` entry.
- [x] Security review rerun after the correction; the remaining warning concerns six pre-existing authenticated RLS helper functions, not the six service-only functions corrected here.
- [x] Generated types were refreshed automatically from the bound backend after migration application; the migration produced no generated-type diff.

Post-migration privilege proof:

- The five sensitive tables expose no table-wide member read grant. Every approved safe column remains readable, while provider identifiers, purchaser email, payment metadata, pass token hashes, and speaker-link ciphertext remain inaccessible.
- `paid_comments` and `stripe_catalog_items` grant no anonymous or member access.
- `has_active_membership`, `has_event_pass`, and all four private provider functions are executable by `service_role` only.
- Public Community Standards reads and operations-role-filtered provider health reads are preserved.

Post-correction advisor result:

- Security linter: four informational RLS-without-policy notices for intentionally service-only tables and six warnings for pre-existing authenticated `SECURITY DEFINER` RLS helpers. The six corrected entitlement/provider functions are confirmed unavailable to anonymous and authenticated roles.
- Performance: no schema or query-performance changes were introduced by this grant-only migration; the existing low-traffic unused-index baseline remains informational and no indexes were removed.

### Crypto and treasury

- [x] Provider-neutral `CryptoCheckoutAdapter` and `TreasuryAdapter` boundaries.
- [x] Disabled-by-default crypto implementation.
- [x] Palisade/Ripple sandbox acceptance plan for signed webhooks, replay protection, wallet policy, sweeping, and reconciliation.
- [ ] Written confirmation that Ripple/Palisade supports Accountabul's US third-party payment and treasury model.
- [ ] Separate viewer-facing crypto checkout/quote processor selected. Palisade is currently treated as treasury/wallet custody, not merchant checkout.
- [ ] Palisade sandbox organization, MPC devices, roles, API credentials, webhook key, wallets, policies, allowlists, and sweep configured.
- [ ] Legal, AML/KYT, sanctions, custody, money-transmission, tax, refund, and consumer-disclosure approval.

## Test evidence

- `npm ci` — passed from a clean installation after aligning `package-lock.json` with the pinned Workers types version in `package.json` and `bun.lock`.
- `npm run typecheck` — passed during migration reconciliation.
- `npm run typecheck:worker` — passed during migration reconciliation.
- `npm test` — 29 tests passed during migration reconciliation, including deterministic fuzz/property suites.
- Changed-file ESLint — passed.
- `npm audit` — could not complete because the configured package registry returned `404 operation is not supported` for its audit endpoint; the dedicated dependency scan reported no high or critical vulnerabilities.
- Production build — passed during migration reconciliation; the existing large client-chunk warning remains.
- Secret scan — no Stripe, Restream, or webhook secret values committed.
- Responsive deployed-preview QA — no horizontal overflow or off-screen controls at 320, 375, 768, 1024, or 1440 pixels; mobile and desktop visual inspection passed for the empty `/live` state.
- Full-repository ESLint — not green: 1,106 pre-existing formatting errors plus ten warnings, concentrated in generated Supabase types, Lovable preview storage, and existing UI files. This was not mechanically rewritten because those files are Lovable-owned and broad formatting churn would create an unsafe overlap.

## Owner's exact next actions

### 1. Conference migration reconciliation

1. Keep migrations `20260826083651`, `20260826084327`, `20260826084415`, and `20260826091538` in source control.
2. Do not restore or apply duplicate migration `20260826032843`.
3. Preserve the verified least-privilege grants in future database changes.

### 2. Continue deployment preparation

Use `docs/LOVABLE_CONFERENCE_HANDOFF.md` for the remaining deployment preparation. The conference migration chain is already applied and verified; future work must not replay or repair it.

### 3. Finish the Accountabul Stripe business account

Provide or confirm:

- Accountabul LLC legal name and EIN.
- Formation address and operating/business address.
- Authorized representative and beneficial-owner details required by Stripe.
- Confirmation that Chase ending `2595` is authorized for Accountabul proceeds, or the correct replacement account.
- Support email, support phone, public support URL, receipt text, brand logo/colors, and accepted statement descriptor.
- Approved membership tier names, benefits, monthly prices, and annual prices.
- Customer Portal rules for cancellation, upgrades/downgrades, payment methods, and invoices.
- Tax advisor decision, registrations, and product tax codes. Do not enable Stripe Tax merely by toggling it on.

Rotate the three temporary sandbox restricted keys and store the replacements only in protected deployment secrets. Do not paste them into Lovable chat, GitHub, or this document.

### 4. Decide the Restream player path

The API/chat developer app is already created. The missing video embed is commercial, not a coding gap:

- Upgrade the existing Restream workspace to a plan that includes the Website Video Player (currently documented as Business or custom Enterprise), **or** approve a different embedded-player strategy.
- If upgrading, create one Embed Player channel and provide the generated iframe source through protected event configuration.
- Create a non-public rehearsal event and its Restream event ID.
- After Accountabul deploys the callback, authorize the existing OAuth app. Store the client secret only through protected deployment secrets.

Do not purchase the previously displayed `$940` additional-workspace checkout unless Accountabul separately approves that expense; a second workspace is not required for the v1 architecture.

### 5. Establish Cloudflare deployment ownership

Either create/identify the Accountabul Cloudflare account for Workers/Durable Objects or approve another runtime with equivalent single-owner WebSocket state, alarms, and durable history cursor behavior. For Cloudflare, provide the deployer with:

- Account ID and target Worker name.
- A least-privilege deployment API token through a protected secret channel.
- The deployed Accountabul origin.
- `OPERATIONS_API_KEY` and `RESTREAM_BRIDGE_API_KEY` as independent Worker secrets.

### 6. Start the Palisade/Ripple treasury pilot

Palisade is the proposed wallet/custody and treasury-control layer; it is not yet verified as the viewer checkout. Ask Ripple/Palisade for:

- An Accountabul sandbox organization and named technical/compliance contacts.
- Written eligibility for Accountabul's US third-party tips, paid comments, passes, and treasury flow.
- Sandbox API base URL, least-privilege credentials, webhook public verification key, and network/asset identifiers.
- MPC/CloudSign setup requirements for at least two devices.
- Owner, proposer, approver, and auditor role assignments.
- Wallet creation policy, approved destination allowlist, transaction limits, freeze controls, recovery procedure, and sweep policy.
- Pricing, SLA, RTO/RPO, insurance, production limits, credential rotation, and vendor-exit process.

Separately select a crypto checkout/quote processor that can produce USD-first expiring quotes, QR codes, confirmations, payer compliance handling, refunds, and settlement into Palisade-managed wallets.

### 7. Run the controlled rehearsal

After merge, migration, deployment, secrets, and the Restream player are ready:

1. Create a sandbox live event with pass pricing.
2. Run subscription creation, renewal, failed renewal, grace, recovery, cancellation, and Portal tests.
3. Submit a guest comment, approve its exact text, attempt a one-character edit, then complete the `$1` Stripe test Checkout only after action-time approval.
4. Verify the signed webhook publishes exactly one Paid Guest message; then refund it and verify reconciliation.
5. Complete one guest tip and one event pass, including full and partial refund behavior.
6. Disconnect Restream for more than 60 seconds and verify reconnect, history backfill, and duplicate suppression.
7. Approve and expire a speaker link and confirm it cannot be reused.
8. Run the moderation corpus and a forced moderation outage.
9. Review operations health, audit events, provider failures, refunds, metrics, and reconciliation.
10. Record the Stripe cutover timestamp, rollback owner, and legacy webhook retirement date.

No real funds, live keys, production crypto, or unverified tax collection should be used during this rehearsal.
