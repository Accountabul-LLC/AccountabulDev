import type { PropertyPayload } from "./property-data";
import { getLivePropertyPayload } from "./property-feed.server";

// Matches the source app's 15-minute shared cache. One in-flight fetch is shared so a
// burst of searches can't fan out into many requests against the city GIS service.
const TTL_MS = 15 * 60_000;
let cached: { payload: PropertyPayload; expiresAt: number } | null = null;
let inflight: Promise<PropertyPayload> | null = null;

export async function getCachedPropertyPayload(nowMs = Date.now()) {
  if (cached && cached.expiresAt > nowMs) return cached.payload;
  inflight ??= getLivePropertyPayload()
    .then((payload) => {
      // Never cache a fully-failed live pull for the whole TTL; retry after a minute.
      const live = payload.sources.some((source) => source.mode === "live");
      cached = { payload, expiresAt: Date.now() + (live ? TTL_MS : 60_000) };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
