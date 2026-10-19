// Ported from property-intelligence-app's app/lib/nationwide-r2-artifact-store.ts
// (Slice 2 of the nationwide multi-state ingestion port), retargeted from
// Cloudflare R2 onto Supabase Storage (see the migration
// 20260924150000_property_intelligence_ingestion_pipeline.sql's
// "nationwide-source-artifacts" private bucket). Content-addressed storage
// for scraped source documents/PDFs and discovery/batch response JSON:
// create-only, SHA-256-verified, and idempotent on an exact retry -- the same
// contract the source's R2 test (nationwide-r2-artifact-store.test.mjs)
// exercises, ported here in
// tests/property-intelligence-artifact-store.test.ts.
//
// This module is DORMANT LIBRARY CODE: no route, server function, or cron in
// this repo constructs a real Supabase Storage client and passes it here.
// `SupabaseStorageBucket` is a small injected interface (a functional subset
// of @supabase/storage-js's bucket client), not the real SDK type, so this
// module never itself opens a network connection -- the caller supplies the
// binding, matching how nationwide-r2-artifact-store.ts takes an injected
// `NationwideR2Bucket` rather than constructing one.
import { stableSerialize, stableSha256 } from "./nationwide-fingerprint.ts";
import {
  sha256ArtifactBytes,
  type ImmutableArtifactStore,
  type ImmutableByteArtifactInput,
  type ImmutableJsonArtifactInput,
} from "./nationwide-artifact-store.ts";
import { SHA256_HEX as SHA256_PATTERN } from "../validation/patterns.ts";

export type SupabaseStorageObjectMetadata = {
  sha256?: string;
  mimeType?: string;
  immutable?: string;
  byteSize?: string;
  artifactContract?: string;
};

export type SupabaseStorageObjectInfo = {
  path: string;
  size: number;
  metadata: SupabaseStorageObjectMetadata | null;
};

export type SupabaseStorageUploadError = {
  message: string;
  statusCode?: string;
};

export type SupabaseStorageBucket = {
  upload(
    path: string,
    body: Uint8Array,
    options: {
      contentType: string;
      upsert: false;
      metadata: SupabaseStorageObjectMetadata;
    },
  ): Promise<{ error: SupabaseStorageUploadError | null }>;
  info(path: string): Promise<{ data: SupabaseStorageObjectInfo | null; error: unknown }>;
};

const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function safeObjectStorageKey(value: string) {
  const key = value.trim();
  const hasControlCharacter = Array.from(key).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!key || key !== value || key.startsWith("/") || key.endsWith("/")) {
    throw new Error("objectStorageKey must be a trimmed relative object key");
  }
  if (
    key.includes("\\") ||
    key.includes("://") ||
    key.includes("?") ||
    key.includes("#") ||
    /(^|\/)\.\.?(\/|$)/.test(key) ||
    hasControlCharacter
  ) {
    throw new Error(
      "objectStorageKey contains an unsafe path, URL, query, fragment, or control character",
    );
  }
  return key;
}

function verifiedIdentity(input: { objectStorageKey: string; sha256: string; mimeType: string }) {
  const key = safeObjectStorageKey(input.objectStorageKey);
  if (!SHA256_PATTERN.test(input.sha256)) {
    throw new Error("artifact sha256 must be 64 lowercase hexadecimal characters");
  }
  if (!MIME_TYPE_PATTERN.test(input.mimeType)) {
    throw new Error("artifact mimeType must be a lowercase media type");
  }
  return key;
}

async function verifiedJsonInput(input: ImmutableJsonArtifactInput) {
  const key = verifiedIdentity(input);
  if (input.mimeType !== "application/json") {
    throw new Error("nationwide JSON artifacts must use application/json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.canonicalJson);
  } catch {
    throw new Error("canonicalJson must be valid JSON");
  }
  if (stableSerialize(parsed) !== input.canonicalJson) {
    throw new Error("canonicalJson must use the nationwide stable serialization contract");
  }
  const computedSha256 = await stableSha256(parsed);
  if (computedSha256 !== input.sha256)
    throw new Error("artifact sha256 does not match canonicalJson");
  const bytes = new TextEncoder().encode(input.canonicalJson);
  return { key, bytes, byteSize: bytes.byteLength };
}

async function verifiedByteInput(input: ImmutableByteArtifactInput) {
  const key = verifiedIdentity(input);
  if (!(input.bytes instanceof Uint8Array)) throw new Error("artifact bytes must be a Uint8Array");
  const computedSha256 = await sha256ArtifactBytes(input.bytes);
  if (computedSha256 !== input.sha256) throw new Error("artifact sha256 does not match bytes");
  return { key, bytes: input.bytes, byteSize: input.bytes.byteLength };
}

function matchesExistingArtifact(
  object: SupabaseStorageObjectInfo | null,
  input: { sha256: string; mimeType: string },
  byteSize: number,
  artifactContract: string,
) {
  return (
    object !== null &&
    object.size === byteSize &&
    object.metadata?.sha256 === input.sha256 &&
    object.metadata?.mimeType === input.mimeType &&
    object.metadata?.immutable === "true" &&
    object.metadata?.artifactContract === artifactContract
  );
}

function isAlreadyExistsError(error: SupabaseStorageUploadError) {
  return error.statusCode === "409" || /already exists|duplicate/i.test(error.message);
}

async function putImmutableArtifact(
  bucket: SupabaseStorageBucket,
  input: { sha256: string; mimeType: string },
  key: string,
  bytes: Uint8Array,
  artifactContract: string,
) {
  const byteSize = bytes.byteLength;
  const metadata: SupabaseStorageObjectMetadata = {
    sha256: input.sha256,
    mimeType: input.mimeType,
    immutable: "true",
    byteSize: String(byteSize),
    artifactContract,
  };
  const { error } = await bucket.upload(key, bytes, {
    contentType: input.mimeType,
    upsert: false,
    metadata,
  });
  if (!error) return;
  if (!isAlreadyExistsError(error)) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }
  const { data: existing } = await bucket.info(key);
  if (!matchesExistingArtifact(existing, input, byteSize, artifactContract)) {
    throw new Error(
      "immutable artifact key collision: existing storage object has different integrity evidence",
    );
  }
}

export function createNationwideSupabaseArtifactStore(
  bucket: SupabaseStorageBucket,
): ImmutableArtifactStore {
  return {
    async putCanonicalJson(input) {
      const { key, bytes } = await verifiedJsonInput(input);
      await putImmutableArtifact(bucket, input, key, bytes, "accountabul-nationwide-json-v1");
    },
    async putBytes(input) {
      const { key, bytes } = await verifiedByteInput(input);
      await putImmutableArtifact(bucket, input, key, bytes, "accountabul-nationwide-bytes-v1");
    },
  };
}
