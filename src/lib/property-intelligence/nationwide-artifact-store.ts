// Ported verbatim from property-intelligence-app's app/lib/nationwide-artifact-store.ts
// (Slice 2 of the nationwide multi-state ingestion port; see Slice 1's
// nationwide-geography-catalog.ts for the port's conventions). Storage-backend
// agnostic types + helpers shared by whichever concrete artifact store is
// wired in (the source uses Cloudflare R2; this repo uses Supabase Storage,
// see nationwide-supabase-artifact-store.ts).
export type ImmutableJsonArtifactInput = {
  objectStorageKey: string;
  canonicalJson: string;
  sha256: string;
  mimeType: "application/json";
};

export type ImmutableByteArtifactInput = {
  objectStorageKey: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: string;
};

export type ImmutableJsonArtifactStore = {
  putCanonicalJson(input: ImmutableJsonArtifactInput): Promise<void>;
};

export type ImmutableArtifactStore = ImmutableJsonArtifactStore & {
  putBytes(input: ImmutableByteArtifactInput): Promise<void>;
};

export type ArchivedSourceArtifact = {
  sha256: string;
  objectStorageKey: string;
  mimeType: string;
  byteSize: number;
};

export async function sha256ArtifactBytes(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function archiveNationwideSourceBytes(
  store: ImmutableArtifactStore,
  input: Omit<ImmutableByteArtifactInput, "sha256">,
): Promise<ArchivedSourceArtifact> {
  const sha256 = await sha256ArtifactBytes(input.bytes);
  await store.putBytes({ ...input, sha256 });
  return {
    sha256,
    objectStorageKey: input.objectStorageKey,
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
  };
}
