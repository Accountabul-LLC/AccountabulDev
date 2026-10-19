import { asFiniteNumber, asIsoDate, asNonEmptyString, asPositiveInteger } from "./coerce.ts";
import { isDisplayableMarket } from "./format.ts";
import type { CryptoMarket, CryptoMarketProvider } from "./types.ts";

const COINGECKO_DEMO_URL = "https://api.coingecko.com/api/v3/coins/markets";

type CoinGeckoMarketRow = {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  image?: unknown;
  market_cap_rank?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  total_volume?: unknown;
  circulating_supply?: unknown;
  price_change_percentage_24h?: unknown;
  price_change_percentage_1h_in_currency?: unknown;
  price_change_percentage_24h_in_currency?: unknown;
  price_change_percentage_7d_in_currency?: unknown;
  last_updated?: unknown;
};

export class CoinGeckoProvider implements CryptoMarketProvider {
  readonly id = "coingecko" as const;

  async getTopMarkets(limit: number): Promise<CryptoMarket[]> {
    const params = new URLSearchParams({
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: String(Math.min(250, Math.max(1, limit))),
      page: "1",
      sparkline: "false",
      price_change_percentage: "1h,24h,7d",
    });
    return this.request(params);
  }

  async getMarketsByIds(ids: string[]): Promise<CryptoMarket[]> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!unique.length) return [];
    const params = new URLSearchParams({
      vs_currency: "usd",
      ids: unique.join(","),
      sparkline: "false",
      price_change_percentage: "1h,24h,7d",
    });
    return this.request(params);
  }

  private async request(params: URLSearchParams): Promise<CryptoMarket[]> {
    const apiKey = process.env["COINGECKO_API_KEY"]?.trim();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "AccountabulMarketService/1.0",
    };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    const response = await fetch(`${COINGECKO_DEMO_URL}?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`CoinGecko markets request failed (${response.status})`);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("CoinGecko markets response was not a list");
    }
    return payload
      .map((row) => mapCoinGeckoMarket(row as CoinGeckoMarketRow))
      .filter((market): market is CryptoMarket => Boolean(market));
  }
}

export function mapCoinGeckoMarket(row: CoinGeckoMarketRow): CryptoMarket | null {
  const id = asNonEmptyString(row.id);
  const symbol = asNonEmptyString(row.symbol)?.toUpperCase();
  const name = asNonEmptyString(row.name);
  const priceUsd = asFiniteNumber(row.current_price);
  const change24hPercent =
    asFiniteNumber(row.price_change_percentage_24h_in_currency) ??
    asFiniteNumber(row.price_change_percentage_24h);
  const rank = asPositiveInteger(row.market_cap_rank);
  if (!id || !symbol || !name || priceUsd === null || change24hPercent === null || rank === null) {
    return null;
  }
  const market: CryptoMarket = {
    id,
    symbol,
    name,
    image: httpsUrl(row.image),
    rank,
    priceUsd,
    marketCapUsd: asFiniteNumber(row.market_cap),
    volume24hUsd: asFiniteNumber(row.total_volume),
    circulatingSupply: asFiniteNumber(row.circulating_supply),
    change1hPercent: asFiniteNumber(row.price_change_percentage_1h_in_currency),
    change24hPercent,
    change7dPercent: asFiniteNumber(row.price_change_percentage_7d_in_currency),
    updatedAt: asIsoDate(row.last_updated) ?? new Date().toISOString(),
  };
  return isDisplayableMarket(market) ? market : null;
}

function httpsUrl(value: unknown) {
  const text = asNonEmptyString(value);
  return text?.startsWith("https://") ? text : null;
}
