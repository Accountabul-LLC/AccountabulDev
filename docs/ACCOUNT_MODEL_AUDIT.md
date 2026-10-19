# Architecture Audit — Account Model and Access Boundaries

Date: 2026-08-14. Scope: account separation, business context, route protection.
Read-only audit. No code changed.

## Headline finding

The **database models personal and business accounts correctly. The application does not.**

Postgres already has the right shape:

- `profiles` — the person (1:1 with `auth.users`)
- `user_roles` — platform-wide roles (`member`, `moderator`, `admin`, …)
- `businesses` — the organization, an entity of its own
- `business_members` — junction table, `(business_id, user_id, membership_role,
  invitation_status)`, so a person can belong to many businesses and a business can have
  many people, each with a different role (`owner|manager|listing_manager|lead_manager|viewer`)

The frontend collapses all of that back into "one user = one business". Every business
lookup in the app is literally:

```ts
.eq("user_id", userId).eq("invitation_status", "active").limit(1).maybeSingle()
```

`.limit(1)` is an arbitrary pick. A person who owns two businesses sees exactly one of
them — and there is no UI anywhere to discover, create, or switch to the other.

## Defects, prioritized

### D1 — No active-business context (High)

Three independent, copy-pasted single-business queries:

- `src/hooks/use-business.tsx:15-24`
- `src/routes/dashboard.business.tsx:46-59`
- `src/routes/dashboard.index.tsx:28-41`

Downstream, `src/routes/dashboard.leads.tsx:36-37` (and by inheritance properties,
services, billing) scopes all data to that arbitrary business. Result: silent data
hiding, not an error message.

**Fix:** a `useMyBusinesses()` (plural) hook plus an active-business selector held in a
provider and reflected in the URL, with `useMyBusiness()` becoming a derived selector.
Dashboard header gets a business switcher; personal-only pages (`/saved`, profile) stay
outside business scope so the two account contexts are visually distinct.

### D2 — No members management (High)

Schema and RLS fully support inviting members, assigning `membership_role`, and revoking
access (`business_members_insert/update/delete`). There is **no product surface for any of
it**. A business is permanently a single-person entity in practice.

Also note `business_members_insert` RLS only permits self-insert as `owner` when the
business has zero members — a bootstrap-only policy. Real invitations need a separate
server-function path that verifies the inviter is an `owner`/`manager`.

### D3 — `membership_role` never gates the UI (Medium)

`membership_role` is fetched and then ignored. A `viewer` is shown the same edit,
publish, and credential-submission controls as an `owner`. RLS blocks the write, so this
is not a data breach — it is broken UX that presents actions that always fail.

### D4 — No route-level auth guards (Medium)

No route in the app uses `beforeLoad`. `src/routes/dashboard.tsx` — the shared dashboard
layout — has no auth check at all; each child re-implements
`if (!session) return <SignedOut/>` by hand (`dashboard.index.tsx:44-45`,
`dashboard.business.tsx:135-136`, `dashboard.leads.tsx:100-101`), and `admin.tsx:79-104`
adds its own client-side `isModerator` check.

Consequences: any new dashboard route is unprotected by default unless someone remembers
the boilerplate; SSR always ships an unauthenticated shell instead of redirecting. Data
is still safe — RLS is the real boundary and it is correctly configured — but the routing
layer contributes nothing.

**Fix:** one shared guard on the `dashboard` layout route and one on `admin`, both
`beforeLoad` redirects, then delete the per-page boilerplate.

### D5 — Two unreconciled role systems (Low)

`user_roles.role` (platform) and `business_members.membership_role` (per-business) coexist
with no documented relationship. The `business_owner` and `business_staff` values in the
`app_role` enum are never granted anywhere — dead values left from an earlier, simpler
model. Either wire them up or drop them.

## What is actually correct

- **RLS** on businesses, properties, services, inquiries, and tips is properly scoped
  through `is_business_member` / `can_manage_business` / `is_business_owner`.
- **Payments.** `createTipIntent` runs server-side behind `requireSupabaseAuth`, writes
  with the service role, enforces an idempotency key, and only a signature-verified
  Stripe webhook can move a tip `created → paid`. Clients hold `SELECT` on `tips` only.
- **Chat moderation** visibility and admin overrides are enforced in RLS, not the client.

## Recommended order of work

1. D4 — shared route guards (small, removes a whole class of future mistakes)
2. D1 — active-business provider + switcher, refactor the three duplicate queries
3. D2 — members list, invite, role change, revoke
4. D3 — capability helpers derived from `membership_role`
5. D5 — decide and clean up the dead `app_role` values
