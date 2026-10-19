// Contract for the source research catalog FILE path, which had no test in
// this repository although the source app tests it directly
// (tests/nationwide-source-research-file.test.mjs).
//
// This is the boundary where an operator-supplied file becomes warehouse
// rows, so the cases that matter are the ones where a malformed or hostile
// file must be rejected before any import runs -- and the schema-readiness
// check that refuses to import into a warehouse missing the tables.
//
// The fixture is the real checked-in catalog
// (catalogs/nationwide-source-research/mississippi_initial_official_source_research.v1.json),
// not a hand-written stand-in, so the happy path is pinned against the
// document the system actually ships with.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  NATIONWIDE_SOURCE_RESEARCH_FILE_MAXIMUM_BYTES,
  assertNationwideSourceResearchCatalogSchemaReady,
  parseNationwideSourceResearchCatalogFile,
} from "../src/lib/property-intelligence/nationwide-source-research-file.ts";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "catalogs",
  "nationwide-source-research",
  "mississippi_initial_official_source_research.v1.json",
);

async function catalogText() {
  return readFile(CATALOG_PATH, "utf8");
}

const REQUIRED_RELATIONS = [
  "property_core.jurisdictions",
  "property_ingest.source_candidates",
  "property_ingest.source_candidate_assessments",
  "property_ingest.source_candidate_assessment_fields",
  "property_ingest.source_research_catalog_imports",
  "property_ingest.source_research_catalog_entries",
];

function schemaHost(installed: string[]) {
  const queries: unknown[][] = [];
  return {
    queries,
    host: {
      transaction: async <Result>(
        callback: (transaction: {
          query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        }) => Promise<Result>,
      ) =>
        callback({
          query: async (_sql: string, params: unknown[] = []) => {
            queries.push(params);
            return {
              rows: REQUIRED_RELATIONS.map((relation) => ({
                relation_name: relation,
                installed_name: installed.includes(relation) ? relation : null,
              })),
            };
          },
        }),
    },
  };
}

test("the real shipped catalog parses and validates", async () => {
  const parsed = await parseNationwideSourceResearchCatalogFile(await catalogText());
  assert.equal(parsed.catalog.entries.length, 3);
  assert.deepEqual(parsed.catalog.entries.map((entry) => entry.candidateKey).sort(), [
    "ms_desoto_official_preliminary_landroll",
    "ms_desoto_official_tax_sale_reports",
    "ms_sos_official_tax_forfeited_inventory",
  ]);
});

test("the same bytes parse identically whether given as text or as Uint8Array", async () => {
  const text = await catalogText();
  const fromText = await parseNationwideSourceResearchCatalogFile(text);
  const fromBytes = await parseNationwideSourceResearchCatalogFile(new TextEncoder().encode(text));
  assert.deepEqual(fromBytes.catalog, fromText.catalog);
});

test("a byte-order mark is refused rather than silently stripped", async () => {
  const text = await catalogText();
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
  await assert.rejects(
    parseNationwideSourceResearchCatalogFile(withBom),
    /without a byte-order mark/,
  );
});

test("invalid UTF-8 is refused before any JSON parsing", async () => {
  // A lone continuation byte: not valid UTF-8 in any position.
  const bytes = new Uint8Array([0x7b, 0x80, 0x7d, 0x20, 0x20]);
  await assert.rejects(parseNationwideSourceResearchCatalogFile(bytes), /must contain valid UTF-8/);
});

test("a file that is not one JSON document is refused", async () => {
  await assert.rejects(
    parseNationwideSourceResearchCatalogFile("{not json at all"),
    /one valid JSON document/,
  );
});

test("the file size boundary is enforced at both ends", async () => {
  await assert.rejects(parseNationwideSourceResearchCatalogFile("{"), /between 2 and/);
  const oversized = "x".repeat(NATIONWIDE_SOURCE_RESEARCH_FILE_MAXIMUM_BYTES + 1);
  await assert.rejects(parseNationwideSourceResearchCatalogFile(oversized), /between 2 and/);
});

test("an unknown top-level key is rejected rather than ignored", async () => {
  const document = JSON.parse(await catalogText());
  document.unexpectedKey = "surprise";
  await assert.rejects(
    parseNationwideSourceResearchCatalogFile(JSON.stringify(document)),
    /catalog/,
  );
});

test("a catalog with no entries is refused", async () => {
  const document = JSON.parse(await catalogText());
  document.entries = [];
  await assert.rejects(
    parseNationwideSourceResearchCatalogFile(JSON.stringify(document)),
    /entries must contain between/,
  );
});

test("a fully migrated warehouse reports every required relation", async () => {
  const db = schemaHost(REQUIRED_RELATIONS);
  const result = await assertNationwideSourceResearchCatalogSchemaReady(db.host as never);
  assert.deepEqual(result.requiredRelations, REQUIRED_RELATIONS);
  assert.deepEqual(db.queries[0], [REQUIRED_RELATIONS]);
});

test("a warehouse missing a catalog table refuses the import and names what is missing", async () => {
  const partial = REQUIRED_RELATIONS.filter(
    (relation) => relation !== "property_ingest.source_research_catalog_entries",
  );
  const db = schemaHost(partial);
  await assert.rejects(
    assertNationwideSourceResearchCatalogSchemaReady(db.host as never),
    /missing property_ingest\.source_research_catalog_entries/,
  );
});
