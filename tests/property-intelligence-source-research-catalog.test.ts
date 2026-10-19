// Contract for the source research catalog importer, which had no test in
// this repository although the source app tests it directly
// (tests/nationwide-source-research-catalog.test.mjs).
//
// A catalog import records which official sources a human reviewed and what
// they concluded, so the property that matters most is IMMUTABILITY: once
// (catalogKey, catalogVersion) is imported, re-importing that version with
// different content must fail rather than quietly rewrite the reviewed
// record. A reviewer's conclusions are evidence; silently replacing them
// would make the audit trail fiction.
//
// The fixture is the real shipped catalog, so the fingerprints under test
// are the ones the system actually computes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  importNationwideSourceResearchCatalog,
  validateNationwideSourceResearchCatalog,
  validateNationwideSourceResearchCatalogDocument,
} from "../src/lib/property-intelligence/nationwide-source-research-catalog.ts";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "catalogs",
  "nationwide-source-research",
  "mississippi_initial_official_source_research.v1.json",
);

async function catalog() {
  return JSON.parse(await readFile(CATALOG_PATH, "utf8"));
}

const METADATA = {
  importedBy: "accountabul-source-contract-review",
  importedAt: "2026-09-24T12:00:00.000Z",
};

// A database whose catalog_research_imports table already holds a row for
// this (catalogKey, catalogVersion) -- the on-conflict path.
function existingImportDatabase(existing: {
  fingerprint: string;
  entryCount: number;
  entryFingerprints?: string[];
}) {
  return {
    transaction: async <Result>(
      callback: (transaction: {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<Result>,
    ) =>
      callback({
        query: async (sql: string) => {
          if (/insert into property_ingest\.source_research_catalog_imports/.test(sql)) {
            return { rows: [] }; // conflict: nothing returned
          }
          if (/from property_ingest\.source_research_catalog_imports/.test(sql)) {
            return {
              rows: [
                {
                  id: "11111111-2222-4333-8444-555555555555",
                  catalog_fingerprint: existing.fingerprint,
                  entry_count: existing.entryCount,
                },
              ],
            };
          }
          if (/from property_ingest\.source_research_catalog_entries/.test(sql)) {
            return {
              rows: (existing.entryFingerprints ?? []).map((entry_fingerprint, entry_index) => ({
                entry_index,
                candidate_id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
                assessment_id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
                entry_fingerprint,
              })),
            };
          }
          return { rows: [] };
        },
      }),
  };
}

test("the real shipped catalog validates and fingerprints deterministically", async () => {
  const first = await validateNationwideSourceResearchCatalog({
    catalog: await catalog(),
    ...METADATA,
  });
  const second = await validateNationwideSourceResearchCatalog({
    catalog: await catalog(),
    ...METADATA,
  });
  assert.match(first.catalogFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    first.catalogFingerprint,
    second.catalogFingerprint,
    "the same document must fingerprint identically, or immutability cannot be checked",
  );
  assert.equal(first.entryFingerprints.length, first.catalog.entries.length);
});

test("changing any reviewed content changes the catalog fingerprint", async () => {
  const baseline = await validateNationwideSourceResearchCatalog({
    catalog: await catalog(),
    ...METADATA,
  });
  const edited = await catalog();
  edited.entries[0].assessment.decisionNotes += " (edited)";
  const changed = await validateNationwideSourceResearchCatalog({ catalog: edited, ...METADATA });
  assert.notEqual(baseline.catalogFingerprint, changed.catalogFingerprint);
});

test("re-importing an identical catalog version is accepted as a no-op", async () => {
  const normalized = await validateNationwideSourceResearchCatalog({
    catalog: await catalog(),
    ...METADATA,
  });
  const database = existingImportDatabase({
    fingerprint: normalized.catalogFingerprint,
    entryCount: normalized.catalog.entries.length,
    entryFingerprints: normalized.entryFingerprints,
  });
  const result = await importNationwideSourceResearchCatalog(database as never, {
    catalog: await catalog(),
    ...METADATA,
  });
  assert.ok(result, "an identical re-import must not fail");
});

test("re-importing the same version with different content is refused", async () => {
  const database = existingImportDatabase({
    fingerprint: "0".repeat(64),
    entryCount: 3,
    entryFingerprints: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
  });
  await assert.rejects(
    importNationwideSourceResearchCatalog(database as never, {
      catalog: await catalog(),
      ...METADATA,
    }),
    /catalog version is immutable/,
    "silently rewriting a reviewer's conclusions would make the audit trail fiction",
  );
});

test("stored entries that disagree with the immutable catalog are refused", async () => {
  const normalized = await validateNationwideSourceResearchCatalog({
    catalog: await catalog(),
    ...METADATA,
  });
  const database = existingImportDatabase({
    fingerprint: normalized.catalogFingerprint,
    entryCount: normalized.catalog.entries.length,
    // Right count, right catalog fingerprint, wrong entry content.
    entryFingerprints: normalized.entryFingerprints.map(() => "d".repeat(64)),
  });
  await assert.rejects(
    importNationwideSourceResearchCatalog(database as never, {
      catalog: await catalog(),
      ...METADATA,
    }),
    /do not match their immutable catalog/,
  );
});

test("the import envelope rejects unknown keys and missing provenance", async () => {
  const base = await catalog();
  await assert.rejects(
    validateNationwideSourceResearchCatalog({ catalog: base, ...METADATA, extra: 1 }),
    /source research catalog import/,
  );
  await assert.rejects(
    validateNationwideSourceResearchCatalog({ catalog: base, importedAt: METADATA.importedAt }),
    /importedBy/,
  );
});

test("a document that is not a catalog is refused", async () => {
  await assert.rejects(validateNationwideSourceResearchCatalogDocument(null), /catalog/);
  await assert.rejects(validateNationwideSourceResearchCatalogDocument([]), /catalog/);
  await assert.rejects(
    validateNationwideSourceResearchCatalogDocument({ catalogKey: "only-a-key" }),
    /catalog/,
  );
});
