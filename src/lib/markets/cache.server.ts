import type { CryptoMarket, MarketCacheStatus, MarketProviderId, MarketSnapshot } from "./types.ts";

export const DEFAULT_MARKET_CACHE_MS = 6 * 60_000;

type CacheEntry = {
  provider: MarketProviderId;
  lastUpdated: string;
  fetchedAt: number;
  markets: CryptoMarket[];
};

export class MarketDataCache {
  private entry: CacheEntry | null = null;
  readonly freshnessMs: number;
  private now: () => number;

  constructor(freshnessMs: number, now: () => number = Date.now) {
    this.freshnessMs = freshnessMs;
    this.now = now;
  }

  read(): MarketSnapshot | null {
    if (!this.entry) return null;
    const cacheAgeMs = Math.max(0, this.now() - this.entry.fetchedAt);
    return {
      provider: this.entry.provider,
      lastUpdated: this.entry.lastUpdated,
      cacheAgeMs,
      status: cacheAgeMs < this.freshnessMs ? "fresh" : "stale",
      markets: this.entry.markets,
    };
  }

  write(provider: MarketProviderId, markets: CryptoMarket[], fetchedAt = this.now()) {
    this.entry = {
      provider,
      lastUpdated: new Date(fetchedAt).toISOString(),
      fetchedAt,
      markets,
    };
  }
}

export function snapshotStatus(snapshot: MarketSnapshot | null): MarketCacheStatus {
  return snapshot?.status ?? "unavailable";
}
