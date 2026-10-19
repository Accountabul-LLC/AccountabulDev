# Auth / RLS Threat Model — Accountabul Platform Production

Every new table, RLS policy, and privileged server function is checked against this
threat model — see the red-team/blue-team/verifier skills under `.claude/skills/` and
`docs/security/ROLES.md` for the ongoing assessment process.

## Principals

| Principal              | Source of authority                               |
| ---------------------- | ------------------------------------------------- |
| Anonymous              | No session                                        |
| Member                 | Supabase Auth session + `profiles` row            |
| Business owner / staff | `business_members` row for that specific business |
| Moderator              | Active `user_roles` row                           |
| Admin                  | Active `user_roles` row                           |

Authority is never taken from client input, JWT user metadata, localStorage, or a query
parameter. Global roles resolve through the `security definer` `has_role()` function;
business authority resolves through `business_members`.

## Threats and controls

| #   | Threat                                                                  | Control                                                                                                                                      |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Privilege escalation by editing user metadata                           | Roles live in `user_roles`; policies never read `raw_user_meta_data`                                                                         |
| T2  | Horizontal escalation across businesses                                 | Every business-scoped policy joins `business_members` on the row's `business_id`                                                             |
| T3  | Draft/suspended data leaking into public reads                          | Public policies filter `status = 'published'` and `profile_status = 'published'`; anon `GRANT`s only where a public policy exists            |
| T4  | Private PII exposure (email, phone, EIN, documents, verification notes) | Not selectable by `anon`; public surfaces read a narrow view of approved columns only                                                        |
| T5  | Service-role key reaching the browser                                   | Admin client imported dynamically inside handlers only, after the caller is verified; never used to decide who the caller is                 |
| T6  | Forged chat role or ban bypass                                          | Chat writes go through a server function that re-derives role and ban state; provider chat credentials stay server-side                      |
| T7  | Client-declared payment success                                         | Paid state only set by a signature-verified webhook or provider reconciliation; unique `(provider, provider_event_id)` and `idempotency_key` |
| T8  | Replayed or reordered webhooks                                          | Idempotent upsert on provider event ID; processing is retryable and order-independent                                                        |
| T9  | Role/membership removed mid-session                                     | Authorization re-derived on every server call, not cached in the session                                                                     |
| T10 | Storage object enumeration                                              | Private buckets, path-scoped policies, short-lived signed URLs only                                                                          |
| T11 | Missing table grants                                                    | Every `CREATE TABLE` migration includes explicit `GRANT`s; anon grants only for genuinely public tables                                      |
| T12 | Recursive RLS on `user_roles`                                           | `security definer` `has_role()` with `set search_path = public`                                                                              |
| T13 | Secret leakage into the client bundle                                   | No `VITE_` prefix on secrets; `process.env` read inside handlers only; secret scanning in CI                                                 |
| T14 | Unauthenticated prerender of protected loaders                          | Protected reads run from components via `useServerFn`, or from loaders only under an authenticated route gate                                |

## Policy patterns

- **Owner-scoped**: `using (user_id = auth.uid())` for `profiles`, `saved_properties`,
  `business_follows`, `event_reminders`.
- **Business-scoped**: `using (public.is_business_member(auth.uid(), business_id))` for
  properties, services, leads, credentials.
- **Public-read**: `to anon, authenticated using (status = 'published')` on published
  properties, published businesses, and public event metadata only.
- **Admin**: `using (public.has_role(auth.uid(), 'admin'))`.
- **Append-only**: `audit_log` allows insert from privileged server functions and select
  for admins only; no update or delete policy exists.

## Test matrix

Anonymous, member, owner, staff, moderator, and admin against every table; cross-business
horizontal escalation; role/membership removal during an active session; draft vs
published visibility; banned-user chat write; duplicate webhook delivery.

## Secret rotation checklist

1. Inventory: Supabase service role, Restream API secret and pull keys, Stripe secret and
   webhook secret, internal signing secret, notification provider keys.
2. Rotate quarterly and immediately on suspected exposure or contributor offboarding.
3. Issue the new secret, add it alongside the old one, deploy, verify, then revoke the old.
4. Re-verify webhook signature validation after every webhook-secret rotation.
5. Publish the app after rotating a secret used by server functions — preview picks it up
   immediately, production requires a deploy.
6. Record the rotation in `audit_log` and confirm no secret appears in logs, error
   reports, analytics, or the client bundle.
