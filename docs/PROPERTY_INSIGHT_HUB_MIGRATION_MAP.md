# property-insight-hub migration map

`docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md` referenced this file before it
existed (ACC-20260916-003-style drift: a doc citing a path that was never
committed). This is that file, written from the actual port done on
2026-09-24.

## What property-insight-hub actually is

`Accountabul-LLC/property-insight-hub` is **not** just "a second, more
advanced rebuild, reference only for nationwide ingestion" as the port plan
originally said. It is a **TanStack Start + Supabase app**, the same stack,
same file-route style, and same shadcn/ui component library as
`accountabul-final` — which makes its flagship UI directly, mechanically
portable, far more so than porting from the Next.js
`property-intelligence-app`. The plan's characterization of it as merely
"look at for Phase 3+" undersold it and is corrected here and in the plan
doc.

Its actual flagship UI is a `PropertyExplorer` shell
(`src/components/property-explorer.tsx`, 731 lines) composing:
`PortalHome`, `RecordsPortal`, `ApiAccess`, `PropertyAnalysis`,
`DealAnalyst`, `PropertyRecords`, `PropertyIntake`, `PropertyMemory`,
`ReportActions`, `ApiDocumentation`, `PropertyIntelligenceNotice`,
`VerificationBadge`. Before 2026-09-24 none of this had been ported into
`accountabul-final` — only shared backend lib modules had been (see below).
`accountabul-final`'s `/property-intelligence` page was a bespoke, single-file
936-line tab UI that shared logic but looked nothing like property-insight-hub.

## What was already ported before this pass (do not re-port)

Lib modules in `src/lib/property-intelligence/`: `deal-analysis.ts`,
`deal-autofill.ts`, `deal-input-format.ts`, `funding-products.ts`,
`google-maps.ts`, `property-data.ts`, `property-feed.server.ts`,
`property-record-search.ts`, `search.ts`, `parcel-search.ts`,
`workspace.server.ts`, `workspace-validation.ts`,
`property-workspace.functions.ts`, `property-intelligence.functions.ts`,
`analysis-types.ts`, `dossier-types.ts`, `verification.ts`,
`feed-cache.server.ts`, `access.ts`, `access.server.ts`.

These back real, working flows: property record search, deal-scenario
save/list/delete, and parcel workspace search/open/list/get/close.

## What this pass (2026-09-24) ported from property-insight-hub

**Lib** (`src/lib/property-intelligence/`, import paths adjusted from
property-insight-hub's flat `@/lib/foo` to this repo's
`@/lib/property-intelligence/foo` convention):

| property-insight-hub | accountabul-final | Changes |
| --- | --- | --- |
| `src/lib/address-display.ts` | `address-display.ts` | none (pure function) |
| `src/lib/property-selection.ts` | `property-selection.ts` | none (pure function) |
| `src/lib/property-record-location-filters.ts` | `property-record-location-filters.ts` | import path only |
| `src/lib/product-navigation.ts` | `product-navigation.ts` | page set changed — see below |

`product-navigation.ts`'s pages differ from the source: property-insight-hub's
`vault` page is a PDF report vault backed by `report-vault.server.ts` +
`pdf.server.ts` (new tables, not ported — see Phase 4 below, unchanged).
`accountabul-final`'s `vault`-equivalent page is instead named `workspace`
and lists the saved parcel workspaces that `property-workspace.functions.ts`
already persists — a real, working feature, just not called "vault".

`property-record-location-filters.ts` is ported but **not yet wired into any
component**: `search.ts`'s paginated `searchPropertyRecords` server function
does not expose the state/county facets that property-insight-hub's
full-payload client-side model does. Wiring it up would mean extending
`search.ts`'s validator and `searchRecords()` to return those facets — left
as a follow-up, not attempted in this pass to avoid touching that
already-tested function's contract without dedicated review.

**Components** (`src/components/property-intelligence/`, new directory):

| property-insight-hub | accountabul-final | Adaptation |
| --- | --- | --- |
| `property-explorer.tsx` | `property-explorer.tsx` | Orchestration/nav only. Data fetching rewritten from a single `/api/properties` Next.js route fetch to composing the sibling components below, each calling this repo's own server functions directly. |
| `verification-badge.tsx` | `verification-badge.tsx` | Restyled with Tailwind/shadcn tokens (`bg-secondary`, `text-muted-foreground`) instead of the source's bespoke CSS classes; same `verificationTiers` data. |
| `portal-home.tsx` | `portal-home.tsx` | Restyled with Tailwind; card copy/hrefs re-pointed at the pages this pass ported (`workspace`, `property-records`, `deal`, `api`) instead of a PDF vault. |
| `property-records.tsx` (+ the record-browsing half of `property-explorer.tsx`) | `property-records.tsx` | Rewritten to call `searchPropertyRecords` (paginated, server-validated) instead of a full in-memory payload; `formatAddress`/`VerificationBadge` reused. |
| `deal-analyst.tsx` | `deal-analyst.tsx` | Rewritten: source version is AI-chat-driven (`analysis-store.server.ts`/`property-chat.server.ts`, new tables); this instead keeps `accountabul-final`'s existing deterministic form + `listDealScenarios`/`saveDealScenario`/`deleteDealScenario`, restyled to the source's card layout. |
| `property-analysis.tsx` | `property-analysis.tsx` | Rewritten: source version is a full address workspace with AI chat, live nationwide sourcing, and owner/entity research; this instead keeps `accountabul-final`'s existing St. Louis Assessor parcel-workspace flow (`searchParcels`/`openPropertyWorkspace`/`listPropertyWorkspaces`/`getPropertyWorkspace`/`closePropertyWorkspace`), restyled to the source's detail-panel layout including `VerificationBadge`. |
| `api-access.tsx` + `api-documentation.tsx` | `api-access.tsx` | Rewritten as a static informational/contact page. The source tracks structured API access requests via `api-access-repository.ts`/`api-pending.ts` against a new table — not built (see Phase 5, unchanged). |

**Route**: `src/routes/property-intelligence.tsx` now renders the ported
`PropertyExplorer` shell in place of the previous 936-line bespoke inline tab
UI. Session/access gating (the ACC-20260923-004 members-only switch) stays
in the route exactly as before — `PropertyExplorer` has no opinion on who
may reach it. All three previously-working flows (deal scenario save/list/
delete, property record search, parcel workspace open/list/get/close) are
preserved, just moved into the equivalent ported components.

## What was deliberately not ported in this pass, and why

- **`property-memory.tsx` / owner document uploads** — needs new Storage
  bucket + `property_owner_documents` + `property_record_reviews` tables and
  RLS. This is Phase 3 in the port plan, unchanged and still not built.
- **`report-actions.tsx` / `records-portal.tsx` (PDF vault)** — needs
  `pdf-lib`/`pdfjs-dist` as new dependencies (an install, gated on the
  owner's sign-in per this repo's global installs rule) plus a
  `property_reports` table. Phase 4, unchanged and still not built.
- **`api-access-repository.ts` / `api-pending.ts` (self-serve API request
  queue)** — needs a `property_api_access_requests` table. Phase 5,
  unchanged and still not built; `api-access.tsx` above is a static page
  instead.
- **`property-intelligence-notice.ts` / `property-intelligence-notice.tsx`
  (the "read this before an offer" acknowledgment modal)** — needs a
  persisted acknowledgment-count table (`notice-store.server.ts`'s backing
  store). Not built; the route's existing static disclaimer paragraph stays
  in place instead.
- **`owner-research.ts` (owner/entity research chat launch)** and
  **`property-chat.server.ts` / `analysis-store.server.ts`** — AI-chat
  workspace backing DealAnalyst/PropertyAnalysis in the source. Not built;
  those components keep this repo's existing deterministic, non-chat flows.
- **`live-property-source.server.ts`, `parcel-record.server.ts`,
  `property-api.server.ts`, `property-api-repository.ts`,
  `property-record-feed.server.ts`, `property-dossier.ts`,
  `property-report.ts`, `report-types.ts`, `parcel-record-types.ts`,
  `error-capture.ts`, `error-page.ts`, `workspace-session.server.ts`,
  `property-activity-display.ts`, `property-record-summary.ts`,
  `address-search.ts` / `address-search.server.ts`** — all either back the
  features above, back the nationwide ingestion pipeline (out of scope,
  unchanged — see the plan doc), or are Lovable-runtime-specific
  (`lovable-error-reporting.ts`'s equivalents) with no accountabul-final gap
  to fill. Not ported.

## Nationwide ingestion pipeline — still explicitly out of scope

Unchanged from the original plan: the ~30 `supabase/migrations/*nationwide*`/
`property_ingest.*` migrations, ArcGIS/county scrapers, and
Cloudflare-Workers-shaped code in property-insight-hub are a standalone
data-acquisition project, not part of this UI-parity pass. Re-platforming
that pipeline onto Supabase would be its own initiative with its own design
review — not attempted here, and not implied by "port the flagship UI."
