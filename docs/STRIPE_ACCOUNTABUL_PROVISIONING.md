# Accountabul Stripe Provisioning Record

## Created account

- Display name: **Accountabul**
- Stripe account ID: `acct_YOUR_ACCOUNT_ID`
- Stripe organization: `org_6UzpDxNOSQt1B8AD5mWFKSG`
- Country: United States
- Created: August 25, 2026
- Status at handoff: created, **not activated for live payments**
- Temporary legal-management selection: Center Connect LLC
- Payout account selected during creation: Chase ending in `2595`

The legal entity and payout configuration must be independently reviewed in Stripe before activation. Center Connect LLC is a temporary setup choice and is not a representation that it should remain the merchant of record. Replace or confirm it with the correct Accountabul LLC legal name, EIN, ownership, address, support details, and bank authorization before live processing.

No public business description or unrelated website was copied. No live keys, webhook secrets, tax registrations, or unapproved membership prices were created. The Accountabul test-mode sandbox is active and was provisioned through the signed-in Stripe Dashboard on August 26, 2026.

## Verified sandbox resources

- Paid-comment Product: `prod_V8si1t3BGOviVr`
- Paid-comment one-time USD Price: `price_YOUR_PRICE_ID` (`$1.00`)
- Product and Price metadata: `accountabul_kind=paid_comment`
- Member restricted key: created as **Accountabul member app — temporary sandbox** with Customers write, Products read, Prices read, Customer Portal write, Subscriptions read, and Checkout Sessions write.
- Operations restricted key: created as **Accountabul operations — temporary sandbox** with Products write, Prices write, Charges and Refunds write, and Payment Intents read.
- Webhook restricted key: created as **Accountabul webhook processor — temporary sandbox** with Events read only.

Permission verification succeeded without exposing key values: the member key retrieved the approved Price, created a test Customer, and created a `$1.00` Checkout Session with integration identifier `accountabul_web_kqrmvznp`; the operations key updated Product/Price metadata and reached the refund API (the deliberate nonexistent Payment Intent returned `resource_missing`, not a permissions error); the webhook key read Events and was correctly denied Product access with `more_permissions_required`.

All three restricted keys are temporary test credentials and must be rotated within 24 hours, as authorized by Accountabul. Their values were not committed or written to documentation. The temporary verification Customer and uncompleted Checkout Session remain isolated test data.

The sandbox webhook destination form is prepared for the stable Lovable preview endpoint with these eleven events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, and `invoice.payment_failed`. The final **Create destination** action has not been submitted. Creating it produces persistent webhook access and its signing secret; complete that step only after explicit action-time approval and then store the secret as `STRIPE_WEBHOOK_SECRET` in protected deployment configuration.

## Required human provisioning gates

- [ ] Confirm the final merchant-of-record entity and obtain the Accountabul EIN.
- [ ] Replace/verify Center Connect LLC information and beneficial ownership in Stripe.
- [ ] Confirm the Chase account ending `2595` is authorized for Accountabul proceeds.
- [ ] Complete Stripe identity/business verification and activate the account.
- [ ] Configure Accountabul branding, support email/phone/URL, receipt text, and accepted `ACCOUNTABUL` statement descriptor.
- [ ] Require passkeys or equivalent strong authentication for every Dashboard user.
- [ ] Grant least-privilege Dashboard roles.
- [x] Provision and verify the Accountabul test-mode sandbox.
- [x] Create separate temporary restricted keys for the member app, operations service, and webhook processor.
- [ ] Rotate the temporary restricted keys within 24 hours and store replacements only in protected secrets.
- [ ] Set `STRIPE_ACCOUNT_ID=acct_YOUR_ACCOUNT_ID` in both sandbox and production environments with their matching keys.
- [ ] Create membership Products and monthly/annual Prices from approved pricing.
- [x] Create and API-verify the $1 paid-comment Product/Price.
- [ ] Set `STRIPE_PAID_COMMENT_PRICE_ID=price_YOUR_PRICE_ID` in protected sandbox configuration.
- [ ] Configure event-pass Product/Price creation permissions for the operations backend.
- [ ] Submit the prepared Accountabul sandbox webhook destination after explicit action-time approval and verify delivery after the preview contains the webhook route.
- [ ] Store the account-specific signing secret as `STRIPE_WEBHOOK_SECRET`.
- [ ] Configure Customer Portal cancellation, plan-change, invoice, and payment-method rules.
- [ ] Obtain tax-advisor approval before enabling Stripe Tax or setting registrations/product tax codes.

The application now requires `STRIPE_MEMBER_RESTRICTED_KEY`, `STRIPE_OPERATIONS_RESTRICTED_KEY`, and `STRIPE_WEBHOOK_RESTRICTED_KEY`; the former broad `STRIPE_SECRET_KEY` contract was removed. Catalog and refund writes also require the explicit server-side `STRIPE_OPERATIONS_MUTATIONS_ENABLED=true` gate. Keep it false in production until sandbox verification is recorded.

## Historical payments and cutover

Historical transactions stay in the Stripe account where they originated. Do not migrate charge objects. Keep the legacy webhook/refund/dispute path available until every historical refund and dispute window has closed.

Record the production cutover as:

```text
Accountabul Stripe cutover timestamp: __________________ UTC
New account: acct_YOUR_ACCOUNT_ID
Approved by: __________________________________________
Legacy webhook retirement date: _______________________
```

All Checkout Sessions created after the cutover must be in the Accountabul account. Reconciliation rejects account-mismatched events when Stripe supplies the account field, and every internal payment record stores its provider account ID.
