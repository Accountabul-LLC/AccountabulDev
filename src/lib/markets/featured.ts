import { DEFAULT_FEATURED_ASSETS, MARKET_TICKER_LIMIT, type CryptoMarket } from "./types.ts";

export function parseFeaturedAssetIds(value: string | undefined): string[] {
  if (value === undefined) return [...DEFAULT_FEATURED_ASSETS];
  return value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

export function findMarket(markets: CryptoMarket[], featuredId: string): CryptoMarket | undefined {
  const needle = featuredId.toLowerCase();
  return markets.find((market) => market.id.toLowerCase() === needle);
}

export function applyFeaturedPlacement(
  markets: CryptoMarket[],
  featuredIds: string[],
  displayLimit = MARKET_TICKER_LIMIT,
): CryptoMarket[] {
  const ranked = [...markets].sort((a, b) => a.rank - b.rank);
  const top = ranked.slice(0, displayLimit);
  const featured = featuredIds
    .map((id) => findMarket(markets, id))
    .filter((market): market is CryptoMarket => Boolean(market))
    .map((market) => ({ ...market, featured: true }));
  const featuredIdsSeen = new Set(featured.map((market) => market.id));
  const rest = top
    .filter((market) => !featuredIdsSeen.has(market.id))
    .map((market) => ({ ...market, featured: false }));
  return [...featured, ...rest];
}
