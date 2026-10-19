# Architecture Decision Record — Accountabul Platform Production

Status: accepted, in effect for the live application.

## ADR-001 — New standalone application

A brand-new application is created. No existing Lovable project or GitHub repository is
reused, remixed, connected, or modified. Neither paid source repository becomes the
production application.

## ADR-002 — Runtime and framework

The master prompt recommends Next.js App Router. This build runs on the platform's
supported stack: **TanStack Start v1 (React 19, Vite 7, TypeScript), deployed to an edge
worker runtime**. This satisfies every requirement the recommendation existed to serve:

| Requirement                                   | TanStack Start equivalent                      |
| --------------------------------------------- | ---------------------------------------------- |
| Server Components for initial reads           | Route loaders executing server-side during SSR |
| Server Actions / route handlers for mutations | `createServerFn` typed RPC                     |
| Public HTTP endpoints and webhooks            | Server routes under `src/routes/api/public/*`  |
| File-based routing                            | `src/routes/` with generated route tree        |
| Per-route metadata                            | Route `head()`                                 |

Consequence: no `next/*` APIs, no `react-router-dom`. All page modules live in
`src/routes/`.

## ADR-003 — Data platform

Postgres, Auth, Storage, and Realtime are provided by the Accountabul-owned Supabase
project (`PRODUCTION_PROJECT_REF`, us-west-2). Schema is applied from
`supabase/migrations/`. Lovable Cloud is no longer the backend.

## ADR-004 — Trust boundary

The browser may receive public content, the signed-in user's permitted rows, short-lived
upload permissions, and safe public identifiers. It must never receive: service-role
credentials, Restream secrets or private pull keys, Stripe secret or webhook secrets,
wallet secrets or private keys, full EIN or identity documents, private verification
notes, or raw provider webhook payloads.

All privileged provider calls occur inside `createServerFn().handler()` or a server route
handler. Secrets are read from `process.env` **inside the handler only** — never at module
scope, never with a `VITE_` prefix.

## ADR-005 — Authorization

Supabase Auth supplies authentication identity only. Product identity lives in
`profiles`. Global roles live in a protected `user_roles` table; business-level
permissions come from `business_members`. Editable user metadata is never used for
authorization. Every server function re-derives the caller's authority; the client never
asserts a role.

## ADR-006 — Provider adapters

Restream, payments, and chat transport sit behind server-side adapters so provider
specifics never reach page components. Payments are provider-neutral with Stripe as the
first rail; XRPL/Xaman remains a later-phase adapter.

## ADR-007 — Validation and contracts

Zod validates every untrusted boundary: server-function inputs, webhook payloads, and
search params. Response contracts return only the columns the audience is allowed to see.

## ADR-008 — Money and time

Money is `bigint` minor units plus an uppercase ISO currency code — never floating point.
Time is `timestamptz` in UTC.

## ADR-009 — Migrations

All schema changes ship as committed, forward-only migrations. No dashboard-only schema
edits. The committed migration versions must match the live migration ledger. Destructive
operations require an explicit approved plan and a rollback runbook.

## ADR-010 — Observability

Structured logs carry a request ID and never carry secrets or sensitive personal
information. Analytics and audit events are defined per feature (see
the feature contracts in `docs/BUSINESS_EXPERIENCE.md` and `docs/CONFERENCE_ROOM_ARCHITECTURE.md`).

## ADR-011 — Public visual-system migration

The public presentation layer adapts the approved Accountabul Sites reference into a
centralized semantic token system documented in `docs/ACCOUNTABUL_UI_PORT.md`. The
migration may change typography, color, spacing, shared presentation components, and
homepage composition. It must not replace route ownership, client/server boundaries,
authentication, authorization, provider adapters, or data contracts.

The campaign and donation surfaces shown in the visual reference remain excluded from
this product scope. Existing Accountabul routes are mapped into the same visual rhythm
instead of introducing parallel or non-functional product workflows.

Property spotlights must follow `docs/FEATURED_PROPERTY_REQUIREMENTS.md`. The public UI
must render an explicit empty or illustrative state until a server-approved listing has a
verified address and parcel match, property-matched media, documented authorization, and
reviewed deal facts. Participation language for pooled acquisitions is additionally gated
by legal/compliance approval.

## ADR-012 — Standalone administration boundary

This application has no administrative page or administrative route. Administrative
operations belong to a separate standalone project. Any future metrics integration must
use a narrowly scoped, authenticated API and must not introduce an `/admin` surface or
administrative navigation into this application.
