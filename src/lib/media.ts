import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const BUSINESS_MEDIA_BUCKET = "business-media";
export const PROPERTY_MEDIA_BUCKET = "property-media";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type MediaBucket = typeof BUSINESS_MEDIA_BUCKET | typeof PROPERTY_MEDIA_BUCKET;

/** Legacy rows may store a full URL instead of a storage path. */
export function isExternalUrl(value: string | null | undefined) {
  return Boolean(value && /^(https?:)?\/\//i.test(value));
}

function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1]!.toLowerCase() : "jpg";
}

export function validateImage(file: File) {
  if (!file.type.startsWith("image/")) {
    return "Choose an image file (JPG, PNG, WebP, or GIF).";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "Images must be 5 MB or smaller.";
  }
  return null;
}

/**
 * Uploads an image into `<businessId>/<folder>/<random>.<ext>` and returns the storage path.
 * Storage policies only allow writes inside a business folder the user manages.
 */
export async function uploadImage(options: {
  bucket: MediaBucket;
  businessId: string;
  folder: string;
  file: File;
}) {
  const { bucket, businessId, folder, file } = options;
  const problem = validateImage(file);
  if (problem) throw new Error(problem);

  const path = `${businessId}/${folder}/${crypto.randomUUID()}.${extensionOf(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeImage(bucket: MediaBucket, path: string | null | undefined) {
  if (!path || isExternalUrl(path)) return;
  await supabase.storage.from(bucket).remove([path]);
}

const SIGNED_URL_TTL = 60 * 60;

// Buckets are private. Public object URLs bypass storage SELECT policies.

export async function resolveMediaUrl(bucket: MediaBucket, path: string | null | undefined) {
  if (!path) return null;
  if (isExternalUrl(path)) return path;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Resolves a storage path (or passthrough URL) to something an <img> can render. */
export function useMediaUrl(bucket: MediaBucket, path: string | null | undefined) {
  const query = useQuery({
    queryKey: ["media-url", bucket, path],
    enabled: Boolean(path),
    staleTime: (SIGNED_URL_TTL - 300) * 1000,
    queryFn: () => resolveMediaUrl(bucket, path),
  });
  return query.data ?? (isExternalUrl(path) ? (path ?? null) : null);
}

/** Resolves several paths at once; returns a path -> url map. */
export function useMediaUrls(bucket: MediaBucket, paths: (string | null | undefined)[]) {
  const clean = paths.filter((p): p is string => Boolean(p));
  const key = clean.join("|");
  const query = useQuery({
    queryKey: ["media-urls", bucket, key],
    enabled: clean.length > 0,
    staleTime: (SIGNED_URL_TTL - 300) * 1000,
    queryFn: async () => {
      const entries = await Promise.all(
        clean.map(async (path) => [path, await resolveMediaUrl(bucket, path)] as const),
      );
      return Object.fromEntries(entries) as Record<string, string | null>;
    },
  });
  return query.data ?? {};
}
