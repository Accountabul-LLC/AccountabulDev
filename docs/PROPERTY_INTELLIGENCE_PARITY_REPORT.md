# Property Intelligence port — parity and verification report

Generated at the close of the porting session on 2026-09-24, against source
`Accountabul-LLC/property-intelligence-app` @ `785747d`.

This reports what was measured, how, and what remains. It is deliberately
specific about the limits of each measurement, because a parity number that
hides its own method is worse than no number.

## Measured parity

Name-level sweep of exported source symbols against this repository
(`src/**`, `tests/**`, `supabase/**`):

| Surface                      | Resolved | Total | Note                                        |
| ---------------------------- | -------- | ----- | ------------------------------------------- |
| `app/lib` runtime symbols    | 267      | 311   | remaining 44 all machine-mapped — see below |
| `app/api` route handlers     | 6        | 6     |                                             |
| `packages` (first-party SDK) | 2        | 2     |                                             |
| `db/schema` tables           | 23       | 23    | by SQL table name, not Drizzle identifier   |
| Source test subjects         | 75       | 75    | every subject has target coverage           |

Two figures need their method stated or they mislead:

- **`db/schema` reads 33% on a naive symbol sweep.** That is an artifact: the
  source declares tables as camelCase Drizzle identifiers (`propertyAliases`),
  this repository uses SQL (`property_intel_parcel_aliases`). Checking the 23
  actual `sqliteTable("…")` names against the migrations gives 23/23. Two
  source tables (`report_snapshots`, `report_documents`) are consolidated into
  one `property_reports` row carrying both the snapshot JSON and the PDF hash.
- **The 44 unresolved runtime symbols are renames, not gaps**, and that claim
  is machine-checked rather than asserted:
  `tests/property-intelligence-parity-map.test.ts` maps each to the target
  symbol and file that replaced it and fails if any target symbol disappears.
  The map covers four kinds of change: repository modules split into
  `.server.ts`/`.functions.ts`; six per-source adapters collapsed into one
  `createNationwideSourceAdapterBindings` registry; seven `report-pdf`
  builders consolidated into `buildReportPdf`; and Cloudflare/D1/R2 replaced
  by Supabase and ops routes.

**What that test does not do:** it checks the target half only. The source
repository is not vendored here, so CI cannot re-derive the 44. That half is
re-measured by hand when the source moves.

## Feature areas

| Area                                                     | State                        | Evidence                                                                        |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| Canonical parcel identity, FIPS, jurisdiction resolution | ported                       | `nationwide-geography-catalog`, `us-county-catalog`, Census cross-check         |
| Property search / resolution                             | ported                       | `nationwide-property-search`, `parcel-search`, `property-record-search`         |
| Property Records, Analysis, Dossier, Intake              | ported + wired               | `property-dossier.server`, `property-intake-notice.*`, `property-analysis-qa.*` |
| Deal Analyst (deterministic calculations)                | ported                       | `deal-analysis`, `deal-autofill`, `arv-analysis`                                |
| PDF Vault, reports, document workflows                   | ported                       | `report-vault.*`, `report-pdf.server`, `pdf-vault.tsx`                          |
| Owner records and verification workflows                 | ported                       | `property-records-upload.*`, `property-owner-documents.tsx`                     |
| Audit trails, provenance, source verification            | ported                       | append-only Q&A trail, `ingestion_health_outbox`, artifact fingerprints         |
| LRA / Sheriff / DeSoto / Rankin / MS SOS                 | ported, live fetch for all 6 | `nationwide-*-live-fetch.server.ts`                                             |
| Nationwide architecture + geography catalog              | ported                       | 14 migrations applied                                                           |
| Source discovery, research, mappings, reconciliation     | ported                       | `nationwide-source-{discovery,research-catalog,mapping-release}`                |
| Ingestion, workers, orchestration, health                | ported                       | dispatch worker tick, health query + observe, production worker tick            |
| R2/D1 storage                                            | replaced by Supabase         | `nationwide-supabase-artifact-store`, documented platform swap                  |
| Lovable/Supabase migration + backfill                    | ported                       | `nationwide-legacy-backfill`, `nationwide-lovable-public-export`                |
| Mississippi pilot infrastructure                         | ported                       | `nationwide-source-discovery-bootstrap` + shipped catalog                       |
| Property Intelligence API + SDK                          | ported                       | `property-api-*`, `property-intelligence-sdk`                                   |

## Defects found and fixed during this session

Both were in code that already looked complete, and neither was visible to
symbol-level parity:

1. **`normalizedJurisdiction` added four keys unconditionally as `null`**
   (`countyName`, `countyLegalName`, `placeFips`, `gnisId`). The source adds
   each only when non-null or supplied. The extra keys changed a
   jurisdiction's canonical JSON, so the Mississippi bootstrap's cross-check
   against its reviewed catalog failed on **every** call and
   `bootstrapMississippiSourceDiscovery` could never run. Likely introduced
   adapting the copy to `exactOptionalPropertyTypes`.
2. **Six subsystems were implemented and tested but unreachable** — nothing
   called them. Found at three successive layers: module (dispatch worker,
   health reader, health commit), server function (intake/notice, dossier/Q&A),
   and component (notice, keys, intake). Two sweeps are now enforced as tests
   so this class fails CI rather than waiting to be noticed.

## Test suite

707 tests across ~90 files, spanning the whole application rather than one
namespace: property intelligence (62 files) plus security hardening, security
fuzzing, RLS grants, Stripe, payments, auth, conference, community and
operations.

**703 pass in a cloud session. The 4 failures are environmental, not
regressions**: `property-intelligence-postgres-client` and one case in
`property-intelligence-st-louis-lra-live` need `pg`; `stripe-config` and
`stripe-runtime` need the Stripe SDK. Per `AGENTS.md` this session cannot
install `node_modules`, and **CI is the authority on a green build** — a cloud
session must never claim one.

## Seeding (done, 2026-09-24)

`property_core.jurisdictions` (5 rows) and `property_ingest.source_definitions`
(6 rows, one per pilot manifest) are seeded against the live project at the
owner's explicit authorization. Full row IDs and detail are in
`PROPERTY_INTELLIGENCE_PORT_PLAN.md`'s "Seeding" section. Every row's data —
`mapping_schema`, `schedule_policy`, `known_limitations` — is copied exactly
from `nationwide-source-catalog.ts`'s `NATIONWIDE_PILOT_SOURCE_MANIFESTS`,
including `active: false`, which is the manifests' own declared state and
does not gate the live ingestion path (only health-monitoring counts read
it). The St. Louis LRA row now unblocks the ops route's 503 once its two IDs
are configured as env vars on the host — see "Not done, and why" below.

## Not done, and why

1. **The ops route's two env vars, and `NATIONWIDE_DATABASE_URL`, are not
   set.** These are host-platform deployment secrets this session has no
   access to and won't fabricate; the row IDs they need are now real and
   recorded in the port plan.
2. **Five migrations applied to the live project have not been reviewed**, and
   the security posture they encode — service-role-write-only on the
   intake/notice/Q&A tables, an append-only Q&A trail with no UPDATE/DELETE
   policies — has not been ratified. Per `AGENTS.md`, _"the chat that
   implements a fix cannot declare it closed — verification is a fresh
   session."_ These were written in this session, so this session cannot
   close them.

Given that this session found two real defects in already-ported code before
seeding, and the seeding itself is now real production data, the
fresh-session migration review is the sensible next step before any of these
sources are activated.
