// Ported from property-intelligence-app's app/lib/ingestion-policy.ts.
// Pure freshness policy for automatic intelligence refresh: six hours, and a
// record that has never been ingested always needs a refresh.
export const INTELLIGENCE_FRESHNESS_MS = 6 * 60 * 60 * 1000;

export function intelligenceNeedsRefresh(
  lastSyncedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!lastSyncedAt) return true;
  const timestamp = new Date(lastSyncedAt).valueOf();
  return Number.isNaN(timestamp) || now - timestamp >= INTELLIGENCE_FRESHNESS_MS;
}

export function intelligenceFreshness(lastSyncedAt: string | null, now = Date.now()) {
  if (!lastSyncedAt) {
    return { state: "not-ingested" as const, lastSyncedAt: null, nextRefreshAt: null };
  }
  const timestamp = new Date(lastSyncedAt).valueOf();
  if (Number.isNaN(timestamp)) {
    return { state: "stale" as const, lastSyncedAt, nextRefreshAt: null };
  }
  return {
    state: now - timestamp < INTELLIGENCE_FRESHNESS_MS ? ("fresh" as const) : ("stale" as const),
    lastSyncedAt,
    nextRefreshAt: new Date(timestamp + INTELLIGENCE_FRESHNESS_MS).toISOString(),
  };
}
