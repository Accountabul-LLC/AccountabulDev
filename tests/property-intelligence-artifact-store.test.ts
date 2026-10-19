// Slice 2 of the nationwide multi-state ingestion port. Ported behavioral
// contract from the source's tests/nationwide-r2-artifact-store.test.mjs
// ("create-only, an exact retry is an idempotent success"; "key reuse with
// different evidence is rejected"), retargeted at this repo's Supabase
// Storage-backed store (nationwide-supabase-artifact-store.ts) with an
// in-memory fake standing in for @supabase/storage-js's bucket client.
import assert from "node:assert/strict";
import test from "node:test";

import { archiveNationwideSourceBytes } from "../src/lib/property-intelligence/nationwide-artifact-store.ts";
import {
  stableSerialize,
  stableSha256,
} from "../src/lib/property-intelligence/nationwide-fingerprint.ts";
import {
  createNationwideSupabaseArtifactStore,
  type SupabaseStorageBucket,
  type SupabaseStorageObjectInfo,
} from "../src/lib/property-intelligence/nationwide-supabase-artifact-store.ts";

function fakeBucket(): SupabaseStorageBucket & {
  uploadCalls: number;
  objects: Map<string, { bytes: Uint8Array; info: SupabaseStorageObjectInfo }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; info: SupabaseStorageObjectInfo }>();
  let uploadCalls = 0;
  return {
    objects,
    get uploadCalls() {
      return uploadCalls;
    },
    async upload(path, body, options) {
      uploadCalls += 1;
      if (objects.has(path)) {
        return { error: { message: "The resource already exists", statusCode: "409" } };
      }
      objects.set(path, {
        bytes: new Uint8Array(body),
        info: { path, size: body.byteLength, metadata: { ...options.metadata } },
      });
      return { error: null };
    },
    async info(path) {
      const object = objects.get(path);
      return { data: object ? object.info : null, error: object ? null : new Error("not found") };
    },
  };
}

async function artifact(key: string, value: unknown) {
  return {
    objectStorageKey: key,
    canonicalJson: stableSerialize(value),
    sha256: await stableSha256(value),
    mimeType: "application/json" as const,
  };
}

test("Supabase Storage artifacts are create-only and an exact retry is an idempotent success", async () => {
  const bucket = fakeBucket();
  const store = createNationwideSupabaseArtifactStore(bucket);
  const input = await artifact("nationwide/ms-sos/2026-08-19/discovery.json", {
    ids: [3, 1, 2],
    count: 3,
  });
  await store.putCanonicalJson(input);
  await store.putCanonicalJson(input);
  assert.equal(bucket.uploadCalls, 2);
  assert.equal(bucket.objects.size, 1);
  const stored = bucket.objects.get(input.objectStorageKey)!;
  assert.equal(new TextDecoder().decode(stored.bytes), input.canonicalJson);
  assert.deepEqual(stored.info.metadata, {
    sha256: input.sha256,
    mimeType: "application/json",
    immutable: "true",
    byteSize: String(new TextEncoder().encode(input.canonicalJson).byteLength),
    artifactContract: "accountabul-nationwide-json-v1",
  });
});

test("Supabase Storage rejects key reuse when the existing artifact has different evidence", async () => {
  const bucket = fakeBucket();
  const store = createNationwideSupabaseArtifactStore(bucket);
  const key = "nationwide/ms-sos/2026-08-19/batch-00001.json";
  await store.putCanonicalJson(await artifact(key, { records: [1] }));
  await assert.rejects(
    store.putCanonicalJson(await artifact(key, { records: [2] })),
    /immutable artifact key collision/i,
  );
  assert.equal(
    new TextDecoder().decode(bucket.objects.get(key)!.bytes),
    stableSerialize({ records: [1] }),
  );
});

test("raw PDF bytes use the same immutable evidence contract and reject a changed retry", async () => {
  const bucket = fakeBucket();
  const store = createNationwideSupabaseArtifactStore(bucket);
  const pdf = new TextEncoder().encode("%PDF-1.7\nfixture");
  const archived = await archiveNationwideSourceBytes(store, {
    objectStorageKey: "nationwide/ms/desoto/2025-tax-sale.pdf",
    bytes: pdf,
    mimeType: "application/pdf",
  });
  assert.equal(archived.byteSize, pdf.byteLength);
  assert.match(archived.sha256, /^[0-9a-f]{64}$/);
  const stored = bucket.objects.get(archived.objectStorageKey)!;
  assert.equal(stored.info.metadata?.artifactContract, "accountabul-nationwide-bytes-v1");
  await archiveNationwideSourceBytes(store, {
    objectStorageKey: archived.objectStorageKey,
    bytes: pdf,
    mimeType: archived.mimeType,
  });
  await assert.rejects(
    archiveNationwideSourceBytes(store, {
      objectStorageKey: archived.objectStorageKey,
      bytes: new TextEncoder().encode("%PDF-1.7\nchanged"),
      mimeType: archived.mimeType,
    }),
    /immutable artifact key collision/i,
  );
});

test("Supabase Storage validates canonical bytes, hash, MIME type, and safe keys before writing", async () => {
  const bucket = fakeBucket();
  const store = createNationwideSupabaseArtifactStore(bucket);
  const valid = await artifact("nationwide/ms-sos/discovery.json", { a: 1, b: 2 });
  await assert.rejects(
    store.putCanonicalJson({ ...valid, canonicalJson: '{"b":2, "a":1}' }),
    /stable serialization/i,
  );
  await assert.rejects(
    store.putCanonicalJson({ ...valid, sha256: "0".repeat(64) }),
    /does not match/i,
  );
  await assert.rejects(
    store.putCanonicalJson({ ...valid, objectStorageKey: "../discovery.json" }),
    /unsafe path/i,
  );
  await assert.rejects(
    store.putCanonicalJson({ ...valid, objectStorageKey: "https://example.com/discovery.json" }),
    /unsafe path/i,
  );
  assert.equal(bucket.uploadCalls, 0);
  assert.equal(bucket.objects.size, 0);
});
