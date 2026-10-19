# Property Intelligence full-port plan

Status: Phases 1–5 and the nationwide ingestion phase are built. Per-phase
status is in the table below; the honest summary is that everything is
implemented, integrated and tested, and that two items are NOT closed —
seeding the live jurisdiction/source_definition rows, and sign-off on five
migrations applied to the live project. See "Not closed" at the end.

Phases 1 and 2 were independently verified — see
`docs/security/2026-09-23-verification.md` (ACC-20260923-001, -002, -003,
-006, -007 all Closed). Property Intelligence is live at
`/property-intelligence`, with a members-only access switch. As of
2026-09-24, its flagship UI (the `PropertyExplorer` shell and its component
tree) has also been ported from `property-insight-hub` in place of the
previous bespoke inline tab UI — see `docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md`
for exactly what moved and what didn't.

Phases 3–5 below are **built and security-reviewed**, not design-only — owner
document uploads, the PDF vault, and the API-access queue all ship on branch
`claude/lucid-planck-hj3c5i` (PR #25), together with the nationwide ingestion
port, the public Property Intelligence API and its first-party SDK. Their
migrations (`supabase/migrations/2026092411*`–`2026092418*`) were applied to
the live Supabase project `PRODUCTION_PROJECT_REF` on 2026-09-24. The sections
below describe those phases as originally designed; read them as the design
of record, not as an open backlog.

Source for the original Phase 1/2 design:
[Accountabul-LLC/property-intelligence-app](https://github.com/Accountabul-LLC/property-intelligence-app)
(Next.js + Cloudflare D1/R2 app, `README.md`/`DESIGN.md` there are the
authoritative product spec for what these phases port). This plan ports its
product surface into `accountabul-final` (TanStack Start + Supabase), not
its runtime.

**Corrected characterization of property-insight-hub:** earlier revisions of
this plan described `Accountabul-LLC/property-insight-hub` as merely "a
second, independent, more advanced rebuild... reference only, look at for
Phase 3+ (nationwide ingestion)." That undersold it. property-insight-hub is
a **TanStack Start + Supabase app**, the same stack and file-route/shadcn-ui
conventions as `accountabul-final` — not a Next.js app like
`property-intelligence-app` above. That makes its UI directly, mechanically
portable, which is exactly what the 2026-09-24 pass did for its flagship
`PropertyExplorer` shell. Its nationwide multi-state ingestion pipeline
remains a separate, out-of-scope concern for the same reason it always
was (see "Explicitly out of scope" below) — being on the same stack doesn't
change that a ~30-migration scraper pipeline is its own project.
`docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md` has the full before/after
mapping of what was ported from it and what was deliberately left out.

## Phase status

| Phase                                     | State                | Evidence                                                                         |
| ----------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| 1 — Property Records + Deal Analyst       | shipped, verified    | `docs/security/2026-09-23-verification.md`                                       |
| 2 — Address-first Analysis workspace      | shipped, verified    | same                                                                             |
| UI-parity pass — PropertyExplorer shell   | shipped              | `docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md`                                     |
| 3 — Your Property Records (owner uploads) | shipped              | `property-records-upload.*`, `property-owner-documents.tsx`                      |
| 4 — PDF Vault                             | shipped              | `report-vault.*`, `report-pdf.server.ts`, `pdf-vault.tsx`                        |
| 5 — Property Intelligence API access      | shipped              | `api-access-requests.*`, `property-api-keys.*`, `api-access.tsx`, `api-keys.tsx` |
| Nationwide ingestion                      | built; not activated | see below, and `docs/PROPERTY_INTELLIGENCE_PARITY_REPORT.md`                     |

"Built; not activated" for nationwide means: every module, all six live
fetch implementations, the dispatch worker, the health reader and observation
commit, and the production registry and tick are ported and tested, and the
14 migrations are applied — but no jurisdiction or source_definition rows are
seeded, so the ops route answers 503 and no ingestion has run against real
data.

## Why a phased plan, not a single PR

The source app is ~27k lines across property search, an address-first
analysis workspace, a 7-step Deal Analyst, a PDF vault, an owner-document
review pipeline, an API-access request queue, and a nationwide multi-state
ingestion pipeline (Cloudflare Workers, D1, R2, ArcGIS/PDF scrapers for many
counties). Porting all of it in one pass would violate `AGENTS.md`'s
"never build before you plan" rule and produce an unreviewable diff. Each
phase below is independently shippable and independently verifiable by the
scout → red-team → blue-team → verifier chain.

## Runtime mapping (source → Accountabul)

| Source app                                   | Accountabul equivalent                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js App Router pages                     | TanStack Start file routes (`src/routes/`)                                                                                                           |
| Cloudflare D1 (SQLite)                       | Supabase Postgres (`supabase/migrations/`)                                                                                                           |
| Cloudflare R2 (PDF/image bytes)              | Supabase Storage buckets                                                                                                                             |
| Cloudflare Workers (ingestion cron)          | Supabase `pg_cron` + server functions, or a `src/routes/api/internal/ops/*` endpoint polled by the existing ops cron pattern                         |
| `app/api/*/route.ts` (Next API routes)       | `createServerFn` in `src/lib/property-intelligence/*.functions.ts` (server functions are called directly from React; no separate fetch layer needed) |
| ChatGPT/Actions auth (`app/chatgpt-auth.ts`) | Out of scope — Accountabul has no equivalent external-agent surface; drop unless the owner asks for it explicitly                                    |

## Shipped: Phase 1 — Property Records + Deal Analyst

- `src/routes/property-intelligence.tsx` — Property Records search (live St.
  Louis LRA/LCRA + Sheriff tax-sale 239 snapshot) and a one-page Deal Analyst
  ported from `app/lib/deal-analysis.ts` unchanged.
- `src/lib/property-intelligence/*` — ported pure modules: `deal-analysis.ts`,
  `deal-autofill.ts`, `deal-input-format.ts`, `funding-products.ts`,
  `google-maps.ts`, `property-data.ts`, `property-feed.server.ts`,
  `property-record-search.ts`, `search.ts`.
- `supabase/migrations/20260923140000_property_deal_scenarios.sql` +
  `20260923150000_property_deal_scenario_quota.sql` — saved scenarios, owner
  RLS, 100/account quota.
- Nav entry in `site-header.tsx`; unpriced-record fix (offer-required never
  defaults to $0 in the calculator).

This is a genuine subset of the source app's "Deal analyst and voice" and
"Property Records" sections — not the address-first workspace, which is the
app's actual entry point (that's Phase 2, below).

## Shipped: Phase 2 — Address-first Property Analysis workspace

`README.md`'s "Address-first property analysis" section: type an address or
ASR parcel ID, resolve to the official Assessor parcel, open a **permanent
named workspace** for that address, as an "Address lookup" tab on the same
`/property-intelligence` page (not a separate route, unlike the original
plan below this line — kept for context, not as an open task):

- Tables `property_intel_parcels` (canonical, shared across all accounts),
  `property_intel_profiles` (1:1 Assessor dossier, refreshed when stale
  (>6h), never on every page view), `property_analysis_threads` (per-user
  named workspace, 200/account quota) —
  `supabase/migrations/20260923160000_property_intelligence_workspaces.sql`.
- `src/lib/property-intelligence/parcel-search.ts`,
  `workspace.server.ts`, `workspace-validation.ts`,
  `property-workspace.functions.ts` (server functions: search, open, list,
  get-with-refresh, close).
- Three-tier verification badge in the UI, matching the source app's design.
- Voice entry (`SpeechRecognition`) was not built — still a straightforward
  future addition if wanted, not core to the workspace.

## Shipped: UI-parity pass — PropertyExplorer shell (2026-09-24)

Ported property-insight-hub's flagship `PropertyExplorer` shell and its
component tree into `src/components/property-intelligence/`, replacing the
previous bespoke 936-line inline tab UI in `src/routes/property-intelligence.tsx`
with that shell. Full mapping, adaptations and what was deliberately left out:
`docs/PROPERTY_INSIGHT_HUB_MIGRATION_MAP.md`. In short: the shell, navigation,
`PortalHome`, `PropertyRecords`, `DealAnalyst`, `PropertyAnalysis` and a static
`ApiAccess` page are ported and wired to this repo's existing, already-working
server functions; `PropertyMemory`, the PDF vault, the AI-chat-driven deal/
analysis workspace, the API-access request queue, and the acknowledgment
notice modal are not — each maps onto a Phase 3/4/5 item below that is still
unbuilt, or a chat/nationwide-sourcing dependency this repo has no equivalent
for yet.

## Phase 3 — Your Property Records (owner document uploads)

Source: `app/property-memory.tsx`, `app/lib/property-intelligence-notice.ts`,
`docs/property-owner-records.md` (source repo).

- Supabase Storage bucket `property-owner-records` (private, signed URLs only,
  mirroring the `PROPERTY_MEDIA_BUCKET` pattern in `src/lib/media.ts`).
- Table `property_owner_documents`: parcel link, event date, amount, vendor,
  reference number, explanation, `status` enum (`submitted`/`verified`/
  `rejected`), SHA-256 integrity hash, byte count, MIME type.
- Table `property_record_reviews` (append-only, admin/moderator role) —
  mirrors the source app's review ledger.
- RLS: owner can insert/read their own rows; only `admin`/`moderator` can
  write a review or flip `status`. Only `verified` rows surface in the
  Property Intelligence timeline, labeled "Accountabul-verified owner record"
  and kept visually separate from official Assessor facts (source app's
  explicit non-negotiable: owner claims must never look like sourced city
  data).

## Phase 4 — PDF Vault

Source: `app/lib/report-pdf.ts`, `app/report-actions.tsx`,
`app/records-portal.tsx`, `docs/records-portal.md`.

- Reuses `pdf-lib`/`pdfjs-dist` (already in the source app's dependency list;
  would need adding to `accountabul-final`'s `package.json` — an install, so
  this needs the owner's sign-in per the global installs rule before Phase 4
  starts).
- Table `property_reports`: immutable JSON snapshot, content hash (excludes
  capture time/status, so an unchanged scenario reuses its PDF instead of
  duplicating), Storage path for the rendered PDF, action history.
- Generation triggered by a server function, not a client-side render, so the
  content hash and the stored bytes can never diverge.

## Phase 5 — Property Intelligence API access requests

Source: `app/api-access.tsx`, `app/lib/api-access-repository.ts`.

- Table `property_api_access_requests`: account, organization, use case,
  expected volume, `status` (`pending`/`approved`/`denied`). Submitting a
  request does not grant credentials — matches source app's explicit rule.
- Low priority: this is an internal ops queue, not a customer-facing feature.
  Build only if the owner wants external API consumers.

## Explicitly out of scope (not "the app" — infrastructure)

- ~~**Nationwide multi-state ingestion pipeline**~~ — **no longer out of
  scope.** The owner greenlit it and it has since been ported in full: the
  source catalog and field-mapping review workflow, the geography catalog,
  the orchestrator, the Postgres writer/resolver/run-store, and live fetch
  for all six pilot sources. The Cloudflare Workers this section worried
  about were not re-platformed as Workers at all — they became
  `nationwide-production-worker.ts` (a tick driven by an ops route or cron)
  and Supabase-backed artifact storage, which is why the "~15 Workers"
  estimate did not materialise. What remains is activation, not porting:
  see "Not closed" below.
- `app/chatgpt-auth.ts`, `app/api-documentation.tsx`: external-agent access
  surface with no current Accountabul equivalent or stated need. Still not
  ported, deliberately — the API itself, its keys and its access-request
  queue are all built; what is absent is a human-readable docs page.

## Design system

Per the user's global rule, before any further UI work: load the
`accountabul-design-studio` skill and check whether `property-intelligence-app`
has its own Design Studio profile (the source repo's own `DESIGN.md` claims to
be "the visual source of truth" for that standalone app — the studio profile
takes precedence if one exists; if none is captured, treat the source app's
own `DESIGN.md` as informative only, and Property Intelligence pages inherit
Accountabul's own design language since they're accountabul-final routes, not
a separate branded property).

## Deployment path (this repo's actual meaning of "deploy")

`accountabul-final` has no Vercel/Cloudflare project wired in this checkout —
"deploy" here means the repo's own release process: `release-steward` —
gate clean, push the branch, open a draft PR, drive CI green. There is no
separate "prod push" button in this repo; merging to `main` after CI is green
and Ready-for-verification findings are verified is the deployment.

## Verification chain ("skill book") for each phase

1. **scout** — reconcile the phase's claims against the filesystem/migrations
   before red-team starts.
2. **red-team** — adversarial pass, report-only, committed report.
3. **blue-team** — fixes only what red-team named, one regression test per
   finding, migrations committed, marks Ready-for-verification (never
   Closed).
4. **verifier** — fresh session, independently re-derives and closes.

This ran for both Phase 1 (`docs/security/2026-09-23-red-team.md`/
`-blue-team.md`) and Phase 2 (`-red-team-phase2.md`/`-blue-team-phase2.md`),
closed by `docs/security/2026-09-23-verification.md`. Phase 3+ each get
their own dated report when built.

## Not closed

One item is outstanding and it is not implementation work:

1. **Five migrations applied to the live project have not been reviewed**, and
   the security posture they encode — service-role-write-only on the
   intake/notice/Q&A tables, an append-only Q&A trail with no UPDATE/DELETE
   policies — has not been ratified. Per `AGENTS.md`, the session that writes
   a change cannot close it; verification is a fresh session.

The porting session that built the nationwide phase found three real defects
in code that already looked complete — a jurisdiction normalization bug that
broke the Mississippi bootstrap outright, six subsystems that were tested but
unreachable, and a snapshot ingestion failure path that could publish a
partial ingest as a complete snapshot. That is the argument for doing the
fresh-session verification pass before any further activation, not after.

## Seeding (done, 2026-09-24)

`property_core.jurisdictions` and `property_ingest.source_definitions` are
seeded against the live project (`PRODUCTION_PROJECT_REF`) from the pilot
manifests in `nationwide-source-catalog.ts`, at the owner's explicit
authorization ("seed with row IDs"). Row data (`mapping_schema`,
`schedule_policy`, `known_limitations`) matches each manifest's own values
exactly, including `active: false` — seeding registers the contract, it does
not flip anything live. Nothing in the live ingestion path gates on
`source_definitions.active`; that flag only affects health-monitoring counts
(see `nationwide-ingestion-health-query.ts`), so leaving it `false` was a
faithful copy of the manifests, not a cautious downgrade.

5 jurisdictions: Missouri, Mississippi (states); St. Louis City MO, DeSoto
County MS, Rankin County MS. 6 source definitions, one per pilot manifest:

| Source key | Contract | Jurisdiction | `source_definitions.id` |
| --- | --- | --- | --- |
| `mo_st_louis_lra_inventory_v1` | 3 | St. Louis City | `c037bf9f-b2db-4053-b26f-6dbb346fde7c` |
| `mo_st_louis_sheriff_tax_sale_v1` | 3 | St. Louis City | `5df7d6ea-a0b9-44a6-ade2-53e1ffef1d83` |
| `ms_county_tax_sale_report_v1` | 1 | DeSoto County | `08769e80-d5d2-467c-a61e-bc24691b1835` |
| `ms_desoto_county_landroll_2026_prelim_v1` | 1 | DeSoto County | `a914c0e2-9800-4a3b-a842-b8b7f4d2e7cd` |
| `ms_rankin_county_tax_sale_report_v1` | 1 | Rankin County | `a28c7225-a917-41c7-a154-0d8e01cfd89f` |
| `ms_sos_active_tax_forfeited_inventory_v1` | 1 | Mississippi | `ee0a5148-8b57-4fa3-8a52-556e601f10be` |

`property_core.jurisdictions.id` for St. Louis City: `3f438ad1-0584-413b-aaba-7ec5545a2a80`.

**Not done here, deliberately:** the deployment env vars
(`NATIONWIDE_ST_LOUIS_LRA_SOURCE_DEFINITION_ID` = the LRA row above,
`NATIONWIDE_ST_LOUIS_LRA_JURISDICTION_ID` = the St. Louis City row above,
and `NATIONWIDE_DATABASE_URL`) are host-platform secrets this session has no
access to and won't fabricate. Setting them, and any decision to flip a
source's `active` flag or schedule a real cron tick against
`nationwide-production-worker.ts`, is the next owner action — and per the
finding above, worth sequencing after the migration review, not before.
