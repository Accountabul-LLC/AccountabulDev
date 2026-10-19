# Census geography catalog (Property Intelligence)

Ported from the source app's `catalogs/geography/` (Slice 1 of
`docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md`'s nationwide ingestion work). This
directory holds a versioned, generated geography identity artifact. It
establishes canonical jurisdiction identity only -- it does not represent
property rows, auction sources, source qualification, ingestion, or
customer-visible data coverage. Nothing in this repo imports it into a live
database yet; see the "Status" note below.

`us_county_equivalents_2025.v1.json` is the same byte-for-byte file the
source app generated from the pinned U.S. Census Bureau 2025 national
counties Gazetteer archive. Version 1 contains the 3,144 county and
county-equivalent rows for all 50 states plus the District of Columbia. The
source archive also contains 78 Puerto Rico municipios, recorded in the
artifact as excluded because the v1 state catalog does not yet include
territories.

## Hash-verification approach (ported concept)

The file's own header fields are the integrity pin, checked by
`src/lib/property-intelligence/us-county-catalog.ts` every time the module
loads:

- `sourceArchiveSha256` -- SHA-256 of the exact Census Gazetteer zip archive
  the rows were generated from.
- `sourceEntrySha256` -- SHA-256 of the exact `.txt` entry inside that
  archive.
- `sourceRowCount` / `includedRowCount` / `excludedRows` -- the archive's
  total row count, how many rows made it into this catalog, and why any were
  excluded (Puerto Rico, in v1).

`us-county-catalog.ts` validates the document's identity fields (catalog
key/version/vintage/scope), the two hash fields' shape (64 lowercase hex
characters), the declared row counts, and then re-derives and checks every
row (FIPS format and state-prefix consistency, ANSI code format, ascending
sort order, no duplicate county FIPS or ANSI code, and full 50-states+DC
coverage) before exporting `CENSUS_COUNTY_CATALOG`. A corrupted, truncated,
or hand-edited catalog file fails to load at all rather than silently
serving bad geography.

**What this repo does not (yet) do**, unlike the source app: it does not ship
`county-catalog:generate` / `county-catalog:verify` npm scripts that
download the published Census archive and re-hash it against
`sourceArchiveSha256`/`sourceEntrySha256` -- that requires live network
access to census.gov, which is out of scope for this inert slice (see
"no live execution" in the task that produced this port). The hash fields are
carried in the file and validated for *shape*, but not re-derived from a
freshly downloaded archive in this repo. Porting the generate/verify scripts
themselves is left for a later slice, once live execution for this
subsystem is approved.

## Importing (still dormant)

`src/lib/property-intelligence/nationwide-geography-catalog.ts` ports the
source app's `importNationwideGeographyCatalog` function: it establishes 51
state-equivalent and 3,144 county-equivalent rows in `property_core.jurisdictions`
in one transaction, fingerprints the full catalog and every ordered row into
the `property_ingest.geography_catalog_imports` / `geography_catalog_entries`
ledger tables, and is replay-safe (an exact repeat returns the original
import and jurisdiction identities; conflicting FIPS, names, parents,
catalog bytes, or incomplete membership roll back the transaction).

It is **not wired into any cron, server function, or route** in this repo.
It is unit-tested against a fake in-memory transaction host in
`tests/property-intelligence-geography-import.test.ts` -- never against a
network or a real database. Running it against the live warehouse is a
manual, later, explicitly-approved operator action, matching the source
app's own "built but never deployed" state for this piece.
