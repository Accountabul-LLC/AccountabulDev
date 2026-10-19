import { asFiniteNumber, asIsoDate, asNonEmptyString, asPositiveInteger } from "./coerce.ts";
import { isDisplayableMarket } from "./format.ts";
import type { CryptoMarket, CryptoMarketProvider } from "./types.ts";

const COINPAPRIKA_TICKERS_URL = "https://api.coinpaprika.com/v1/tickers";

type CoinPaprikaTicker = {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  rank?: unknown;
  circulating_supply?: unknown;
  last_updated?: unknown;
  quotes?: {
    USD?: {
      price?: unknown;
      volume_24h?: unknown;
      market_cap?: unknown;
      percent_change_1h?: unknown;
      percent_change_24h?: unknown;
      percent_change_7d?: unknown;
    };
  };
};

export class CoinPaprikaProvider implements CryptoMarketProvider {
  readonly id = "coinpaprika" as const;

  async getTopMarkets(limit: number): Promise<CryptoMarket[]> {
    const params = new URLSearchParams({
      quotes: "USD",
      limit: String(Math.min(1000, Math.max(1, limit))),
    });
    const response = await fetch(`${COINPAPRIKA_TICKERS_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "AccountabulMarketService/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`CoinPaprika tickers request failed (${response.status})`);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("CoinPaprika tickers response was not a list");
    }
    return payload
      .map((row) => mapCoinPaprikaMarket(row as CoinPaprikaTicker))
      .filter((market): market is CryptoMarket => Boolean(market));
  }
}

export function mapCoinPaprikaMarket(row: CoinPaprikaTicker): CryptoMarket | null {
  const usd = row.quotes?.USD;
  const id = asNonEmptyString(row.id);
  const symbol = asNonEmptyString(row.symbol)?.toUpperCase();
  const name = asNonEmptyString(row.name);
  const priceUsd = asFiniteNumber(usd?.price);
  const change24hPercent = asFiniteNumber(usd?.percent_change_24h);
  const rank = asPositiveInteger(row.rank);
  if (!id || !symbol || !name || priceUsd === null || change24hPercent === null || rank === null) {
    return null;
  }
  const market: CryptoMarket = {
    id,
    symbol,
    name,
    image: `https://static.coinpaprika.com/coin/${encodeURIComponent(id)}/logo.png`,
    rank,
    priceUsd,
    marketCapUsd: asFiniteNumber(usd?.market_cap),
    volume24hUsd: asFiniteNumber(usd?.volume_24h),
    circulatingSupply: asFiniteNumber(row.circulating_supply),
    change1hPercent: asFiniteNumber(usd?.percent_change_1h),
    change24hPercent,
    change7dPercent: asFiniteNumber(usd?.percent_change_7d),
    updatedAt: asIsoDate(row.last_updated) ?? new Date().toISOString(),
  };
  return isDisplayableMarket(market) ? market : null;
}
