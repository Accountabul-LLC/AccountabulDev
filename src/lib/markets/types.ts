export type MarketProviderId = "coingecko" | "coinpaprika";

export type MarketCacheStatus = "fresh" | "stale" | "unavailable";

export interface CryptoMarket {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number;
  priceUsd: number;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  change1hPercent: number | null;
  change24hPercent: number;
  change7dPercent: number | null;
  updatedAt: string;
  featured?: boolean;
}

export interface CryptoMarketProvider {
  readonly id: MarketProviderId;
  getTopMarkets(limit: number): Promise<CryptoMarket[]>;
  getMarketsByIds?(ids: string[]): Promise<CryptoMarket[]>;
}

export type MarketSnapshot = {
  provider: MarketProviderId;
  lastUpdated: string;
  cacheAgeMs: number;
  status: MarketCacheStatus;
  markets: CryptoMarket[];
};

export type MarketTickerPayload = {
  assets: CryptoMarket[];
  lastUpdated: string;
  attribution: {
    text: string;
    href: string;
  };
};

export const MARKET_UNIVERSE_LIMIT = 100;
export const MARKET_TICKER_LIMIT = 50;
export const DEFAULT_FEATURED_ASSETS = ["ripple", "ripple-usd"] as const;
export const COINGECKO_ATTRIBUTION = {
  text: "Data provided by CoinGecko",
  href: "https://www.coingecko.com/en/api?utm_source=accountabul&utm_medium=referral",
} as const;
