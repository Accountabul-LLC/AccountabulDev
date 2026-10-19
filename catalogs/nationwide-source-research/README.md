# Nationwide source-research catalogs

This directory is the version-controlled intake boundary for reviewed source research. Each JSON file contains one complete `NationwideSourceResearchCatalog` document. It does not contain database credentials, import metadata, source responses, raw property values or executable parser code.

## File contract

- UTF-8 JSON without a byte-order mark, between 2 bytes and 5 MiB.
- One stable lowercase `catalogKey` and positive `catalogVersion`.
- One preparer and canonical UTC preparation time.
- Between 1 and 10,000 ordered entries.
- Every entry includes a complete Census-consistent jurisdiction, stable candidate key, discovery actor/time and one complete assessment draft.
- An assessment may include an ordered, value-free `fieldInventory`. Every entry names a canonical JSON-Pointer path, published label, observed value types, semantic role, mapping decision and either a private canonical destination or controlled extension key when required.
- Legacy `needs_review` assessments may omit `fieldInventory`; a `qualified` assessment must contain at least one path, persist the exact declared count and leave no path `unreviewed`.
- Unknown fields fail validation so a misspelled decision field cannot disappear during normalization.
- Candidate keys must be unique within their jurisdiction in one catalog.

Use `<catalogKey>.v<catalogVersion>.json` as the filename. Once a version has been reviewed or imported, do not edit it. Changed evidence, a new candidate, or a later assessment requires a new file and a higher catalog version; a changed assessment also uses the candidate's next sequential `assessmentVersion`.

The pinned first file is [`mississippi_initial_official_source_research.v1.json`](mississippi_initial_official_source_research.v1.json). Its three entries remain `needs_review` and predate the inventory extension, so their missing `fieldInventory` is intentional and fingerprint-compatible. A later reviewed version must append the exact inventories rather than editing version one.

[`mississippi_county_tax_sale_source_research.v1.json`](mississippi_county_tax_sale_source_research.v1.json) is a separate research batch for Rankin County's official 2025 delinquent-tax land-sale report. It records the observed common/core fields, county-form extensions, raw-only reconciliation fields, and exact retrieved-file hash without treating the local review copy as a deployed immutable archive. Its `sampled` and `needs_review` statuses are deliberate: terms approval, a production parser, complete record/amount reconciliation, and archived sample verification remain open.

[`mississippi_county_tax_sale_source_research.v2.json`](mississippi_county_tax_sale_source_research.v2.json) appends assessment two after the complete bounded parser run. It does not rewrite version one. The mapped inventory records observed nullability and the report's unusual count rule: 4,940 complete normalized parcel rows plus 31 `*CONTINUED` print fragments reconcile to the stated 4,971 published count, while only the complete rows carry amounts and those amounts reconcile exactly to the published total. Version two still remains `needs_review` because terms, deployed immutable archival, manifest promotion, and database execution are separate gates.

Neither file creates a manifest, schedule, promotion, property row or customer-visible coverage.

## Offline validation

```shell
npm run source-research:validate -- catalogs/nationwide-source-research/mississippi_initial_official_source_research.v1.json
npm run source-research:validate -- catalogs/nationwide-source-research/mississippi_county_tax_sale_source_research.v1.json
npm run source-research:validate -- catalogs/nationwide-source-research/mississippi_county_tax_sale_source_research.v2.json
```

Validation prints the normalized SHA-256 catalog identity and a value-free summary. It requires no database access.

## Authorized import

Run imports only from an approved operator machine or CI secret store. Supply the target PostgreSQL URL through the server-only `NATIONWIDE_DATABASE_URL` process environment; never place it in this directory, `.env.example`, a browser bundle, command arguments or logs.

```shell
npm run source-research:import -- catalogs/nationwide-source-research/mississippi_initial_official_source_research.v1.json accountabul-source-operator
```

An optional third operand is the canonical UTC import time. The command refuses an unmigrated warehouse before intake, then uses the shared all-or-nothing importer. An exact replay returns the original identities; changed content under an existing catalog version fails.

Importing research is not source activation. Qualification, immutable sample archival, inactive manifest registration, promotion, production reconciliation and search-coverage proof remain separate gates.
