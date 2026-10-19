// Slice 5 (final) of the nationwide multi-state ingestion port. Covers
// nationwide-lovable-public-export.ts, matching property-intelligence-app's
// tests/nationwide-lovable-public-export.test.mjs contract ("two stable
// reads become one archived deterministic export"). No literal Supabase
// project reference is used here -- `approvedProjectRef` is supplied by the
// test fixture, exactly as a real caller would have to (see that module's
// header) -- and `fetchImpl` is always injected, so nothing in this file
// reaches a network.
import assert from "node:assert/strict";
import test from "node:test";

import { captureStabilizedLovablePublicExport } from "../src/lib/property-intelligence/nationwide-lovable-public-export.ts";

const config = {
  supabaseUrl: "https://fixturelegacyproj01.supabase.co",
  anonKey: "public-anon-key-fixture",
  approvedProjectRef: "fixturelegacyproj01",
};

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `id-${String(index).padStart(5, "0")}`,
    parcel_id: String(100_000_000_00 + index),
    address: `${index + 1} TEST ST`,
    parcel_status: "Available",
  }));
}

function stableFetch(
  sourceRows: Array<Record<string, unknown>>,
  mutate:
    | ((input: { current: Array<Record<string, unknown>>; pass: number; offset: number }) => void)
    | null = null,
): typeof fetch {
  let requestNumber = 0;
  return (async (url: string | URL) => {
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get("offset"));
    const limit = Number(parsed.searchParams.get("limit"));
    const pass = Math.floor(requestNumber / Math.ceil(sourceRows.length / limit));
    requestNumber += 1;
    const current = structuredClone(sourceRows);
    mutate?.({ current, pass, offset });
    const page = current.slice(offset, offset + limit);
    const end = offset + page.length - 1;
    return new Response(JSON.stringify(page), {
      status: 206,
      headers: { "content-range": `${offset}-${end}/${current.length}` },
    });
  }) as typeof fetch;
}

function memoryStore() {
  const artifacts: Array<{ objectStorageKey: string; canonicalJson: string; sha256: string }> = [];
  return {
    artifacts,
    async putCanonicalJson(input: {
      objectStorageKey: string;
      canonicalJson: string;
      sha256: string;
    }) {
      artifacts.push(input);
    },
  };
}

test("two complete stable public reads become one archived deterministic export", async () => {
  const sourceRows = rows(1_001);
  const store = memoryStore();
  const snapshot = await captureStabilizedLovablePublicExport({
    config,
    table: "lra_properties",
    artifactStore: store,
    fetchImpl: stableFetch(sourceRows),
    now: () => "2026-08-20T12:00:00.000Z",
  });
  assert.equal(snapshot.reportedCount, 1_001);
  assert.equal(snapshot.rows.length, 1_001);
  assert.equal(snapshot.rows[0]?.rowNumber, 1);
  assert.equal(snapshot.rows.at(-1)?.rowNumber, 1_001);
  assert.equal(snapshot.stabilizationPasses, 2);
  assert.equal(store.artifacts.length, 1);
  assert.equal(store.artifacts[0]?.sha256, snapshot.document.sha256);
  assert.equal(store.artifacts[0]?.canonicalJson, snapshot.canonicalJson);
  assert.equal(
    snapshot.sourceArtifact.byteSize,
    new TextEncoder().encode(snapshot.canonicalJson).byteLength,
  );
  assert.match(
    snapshot.sourceArtifact.objectStorageKey,
    /^nationwide\/lovable-public\/lra_properties\/[0-9a-f]{64}\.json$/,
  );
  assert.doesNotMatch(snapshot.canonicalJson, /public-anon-key-fixture/);
  assert.equal(JSON.parse(snapshot.canonicalJson).rowSetFingerprint, snapshot.rowSetFingerprint);
});

test("a changed row between complete reads fails before archival", async () => {
  const store = memoryStore();
  await assert.rejects(
    captureStabilizedLovablePublicExport({
      config,
      table: "tax_sale_properties",
      artifactStore: store,
      fetchImpl: stableFetch(rows(3), ({ current, pass }) => {
        if (pass === 1) {
          const row = current[1];
          if (row) row.address = "CHANGED BETWEEN PASSES";
        }
      }),
      now: () => "2026-08-20T12:00:00.000Z",
    }),
    /changed between complete reads/i,
  );
  assert.equal(store.artifacts.length, 0);
});

test("count drift inside one pass and duplicate ordering fail closed", async () => {
  const store = memoryStore();
  await assert.rejects(
    captureStabilizedLovablePublicExport({
      config,
      table: "lra_properties",
      artifactStore: store,
      fetchImpl: stableFetch(rows(1_001), ({ current, offset }) => {
        if (offset === 1_000) {
          const last = current.at(-1);
          if (last) current.push({ ...last, id: "id-01001" });
        }
      }),
      now: () => "2026-08-20T12:00:00.000Z",
    }),
    /count changed during/i,
  );
  const duplicated = rows(2);
  const first = duplicated[0];
  const second = duplicated[1];
  if (first && second) second.id = first.id;
  await assert.rejects(
    captureStabilizedLovablePublicExport({
      config,
      table: "lra_properties",
      artifactStore: store,
      fetchImpl: stableFetch(duplicated),
      now: () => "2026-08-20T12:00:00.000Z",
    }),
    /duplicated or not strictly ordered/i,
  );
});

test("the public export refuses arbitrary Supabase targets and one-pass snapshots", async () => {
  const store = memoryStore();
  await assert.rejects(
    captureStabilizedLovablePublicExport({
      config: { ...config, supabaseUrl: "https://someotherproject00.supabase.co" },
      table: "lra_properties",
      artifactStore: store,
      fetchImpl: stableFetch(rows(1)),
      now: () => "2026-08-20T12:00:00.000Z",
    }),
    /restricted to the reviewed legacy Supabase project/i,
  );
  await assert.rejects(
    captureStabilizedLovablePublicExport({
      config,
      table: "lra_properties",
      artifactStore: store,
      stabilizationPasses: 1,
      fetchImpl: stableFetch(rows(1)),
      now: () => "2026-08-20T12:00:00.000Z",
    }),
    /between two and five/i,
  );
});
