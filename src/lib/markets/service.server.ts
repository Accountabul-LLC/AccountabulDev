import { DEFAULT_MARKET_CACHE_MS, MarketDataCache } from "./cache.server.ts";
import { CoinGeckoProvider } from "./coingecko.server.ts";
import { CoinPaprikaProvider } from "./coinpaprika.server.ts";
import { applyFeaturedPlacement, parseFeaturedAssetIds } from "./featured.ts";
import {
  COINGECKO_ATTRIBUTION,
  MARKET_TICKER_LIMIT,
  MARKET_UNIVERSE_LIMIT,
  type CryptoMarket,
  type CryptoMarketProvider,
  type MarketSnapshot,
  type MarketTickerPayload,
} from "./types.ts";

type MarketServiceOptions = {
  provider: CryptoMarketProvider;
  cache: MarketDataCache;
  featuredIds: string[];
  universeLimit?: number;
  tickerLimit?: number;
};

export class MarketDataService {
  private inflight: Promise<MarketSnapshot | null> | null = null;
  private options: MarketServiceOptions;

  constructor(options: MarketServiceOptions) {
    this.options = options;
  }

  async getSnapshot(): Promise<MarketSnapshot | null> {
    const cached = this.options.cache.read();
    if (cached?.status === "fresh") return cached;
    const refreshed = await this.refresh();
    return refreshed ?? cached ?? null;
  }

  async getUniverse(): Promise<CryptoMarket[]> {
    const snapshot = await this.getSnapshot();
    return snapshot?.markets ?? [];
  }

  async getTickerPayload(): Promise<MarketTickerPayload | null> {
    const snapshot = await this.getSnapshot();
    if (!snapshot?.markets.length) return null;
    const assets = applyFeaturedPlacement(
      snapshot.markets,
      this.options.featuredIds,
      this.options.tickerLimit ?? MARKET_TICKER_LIMIT,
    );
    if (!assets.length) return null;
    return {
      assets,
      lastUpdated: snapshot.lastUpdated,
      attribution:
        snapshot.provider === "coingecko"
          ? COINGECKO_ATTRIBUTION
          : { text: "Market data", href: "https://coinpaprika.com" },
    };
  }

  private refresh() {
    if (this.inflight) return this.inflight;
    this.inflight = this.loadFromProvider()
      .catch((error) => {
        const cached = this.options.cache.read();
        console.warn("market data stale", {
          provider: this.options.provider.id,
          providerUnavailable: true,
          lastSuccessfulRefresh: cached?.lastUpdated ?? null,
          reason: error instanceof Error ? error.message : "unknown",
        });
        return cached;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async loadFromProvider(): Promise<MarketSnapshot | null> {
    const universeLimit = this.options.universeLimit ?? MARKET_UNIVERSE_LIMIT;
    const top = await this.options.provider.getTopMarkets(universeLimit);
    const missingFeatured = this.options.featuredIds.filter(
      (id) => !top.some((market) => market.id.toLowerCase() === id.toLowerCase()),
    );
    const extras = missingFeatured.length
      ? ((await this.options.provider.getMarketsByIds?.(missingFeatured)) ?? [])
      : [];
    const byId = new Map<string, CryptoMarket>();
    for (const market of [...top, ...extras]) {
      byId.set(market.id, market);
    }
    const markets = [...byId.values()].sort((a, b) => a.rank - b.rank);
    if (!markets.length) return this.options.cache.read();
    this.options.cache.write(this.options.provider.id, markets);
    return this.options.cache.read();
  }
}

export function createMarketProviderFromEnv(): CryptoMarketProvider {
  const requested = process.env["MARKET_DATA_PROVIDER"]?.trim().toLowerCase();
  if (requested === "coinpaprika") {
    if (process.env["MARKET_DATA_ALLOW_COINPAPRIKA"] === "true") {
      return new CoinPaprikaProvider();
    }
    console.warn("CoinPaprika requested but MARKET_DATA_ALLOW_COINPAPRIKA is not true");
  }
  return new CoinGeckoProvider();
}

export function createMarketService(options: {
  provider?: CryptoMarketProvider;
  cache?: MarketDataCache;
  featuredIds?: string[];
  freshnessMs?: number;
  now?: () => number;
  universeLimit?: number;
  tickerLimit?: number;
}) {
  const provider = options.provider ?? createMarketProviderFromEnv();
  const cache =
    options.cache ??
    new MarketDataCache(options.freshnessMs ?? DEFAULT_MARKET_CACHE_MS, options.now);
  return new MarketDataService({
    provider,
    cache,
    featuredIds:
      options.featuredIds ?? parseFeaturedAssetIds(process.env["MARKET_FEATURED_ASSETS"]),
    ...(options.universeLimit === undefined ? {} : { universeLimit: options.universeLimit }),
    ...(options.tickerLimit === undefined ? {} : { tickerLimit: options.tickerLimit }),
  });
}

let sharedService: MarketDataService | undefined;

export function getSharedMarketService() {
  sharedService ??= createMarketService({
    freshnessMs: parseCacheMs(process.env["MARKET_DATA_CACHE_MS"]),
    featuredIds: parseFeaturedAssetIds(process.env["MARKET_FEATURED_ASSETS"]),
  });
  return sharedService;
}

function parseCacheMs(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 60_000) return DEFAULT_MARKET_CACHE_MS;
  return parsed;
}
