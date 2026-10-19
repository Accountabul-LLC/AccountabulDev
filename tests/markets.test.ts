import assert from "node:assert/strict";
import test from "node:test";

import { MarketDataCache } from "../src/lib/markets/cache.server.ts";
import { mapCoinGeckoMarket } from "../src/lib/markets/coingecko.server.ts";
import { mapCoinPaprikaMarket } from "../src/lib/markets/coinpaprika.server.ts";
import { applyFeaturedPlacement, parseFeaturedAssetIds } from "../src/lib/markets/featured.ts";
import {
  formatChangePercent,
  formatUsdPrice,
  isDisplayableMarket,
} from "../src/lib/markets/format.ts";
import { createMarketService } from "../src/lib/markets/service.server.ts";
import type { CryptoMarket, CryptoMarketProvider } from "../src/lib/markets/types.ts";

function market(
  partial: Partial<CryptoMarket> & Pick<CryptoMarket, "id" | "symbol" | "rank" | "priceUsd">,
): CryptoMarket {
  return {
    name: partial.name ?? partial.symbol,
    image: partial.image ?? null,
    marketCapUsd: partial.marketCapUsd ?? partial.rank * 1_000_000,
    volume24hUsd: partial.volume24hUsd ?? 1_000,
    circulatingSupply: partial.circulatingSupply ?? 1_000,
    change1hPercent: partial.change1hPercent ?? 0.1,
    change24hPercent: partial.change24hPercent ?? 1.25,
    change7dPercent: partial.change7dPercent ?? 2.5,
    updatedAt: partial.updatedAt ?? "2026-09-04T18:00:00.000Z",
    ...partial,
  };
}

function rankedMarkets(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    const id = rank === 4 ? "ripple" : `coin-${rank}`;
    const symbol = rank === 4 ? "XRP" : `C${rank}`;
    return market({ id, symbol, rank, priceUsd: 1000 - rank });
  });
}

test("formats large, mid, and fractional USD prices without rendering $0.00", () => {
  assert.equal(formatUsdPrice(112482.31), "$112,482.31");
  assert.equal(formatUsdPrice(4238.12), "$4,238.12");
  assert.equal(formatUsdPrice(2.9134), "$2.9134");
  assert.equal(formatUsdPrice(0.0921), "$0.0921");
  assert.equal(formatUsdPrice(0.00004218), "$0.00004218");
  assert.equal(formatUsdPrice(0), null);
  assert.equal(formatUsdPrice(-3), null);
  assert.equal(formatUsdPrice(Number.NaN), null);
});

test("price bands keep their fraction digits at each boundary", () => {
  assert.equal(formatUsdPrice(1000), "$1,000.00");
  assert.equal(formatUsdPrice(999.99), "$999.99");
  assert.equal(formatUsdPrice(42.1), "$42.10");
  assert.equal(formatUsdPrice(10), "$10.00");
  assert.equal(formatUsdPrice(10.5), "$10.50");
  assert.equal(formatUsdPrice(9.99), "$9.99");
  assert.equal(formatUsdPrice(1), "$1.00");
  assert.equal(formatUsdPrice(0.01), "$0.0100");
  assert.equal(formatUsdPrice(0.0099), "$0.009900");
  assert.equal(formatUsdPrice(0.0001), "$0.000100");
  assert.equal(formatUsdPrice(0.00009999), "$0.00009999");
});

test("formats 24h change with direction markers", () => {
  assert.deepEqual(formatChangePercent(2.31), { text: "▲ +2.31%", direction: "up" });
  assert.deepEqual(formatChangePercent(-1.18), { text: "▼ -1.18%", direction: "down" });
  assert.deepEqual(formatChangePercent(0), { text: "0.00%", direction: "flat" });
  assert.deepEqual(formatChangePercent(0.001), { text: "0.00%", direction: "flat" });
  assert.equal(formatChangePercent(Number.NaN), null);
});

test("rejects markets that would render empty or zero prices", () => {
  assert.equal(isDisplayableMarket({ symbol: "BTC", priceUsd: 0, change24hPercent: 1 }), false);
  assert.equal(
    isDisplayableMarket({ symbol: "BTC", priceUsd: Number.NaN, change24hPercent: 1 }),
    false,
  );
  assert.equal(isDisplayableMarket({ symbol: "", priceUsd: 12, change24hPercent: 1 }), false);
  assert.equal(isDisplayableMarket({ symbol: "BTC", priceUsd: 12, change24hPercent: 1.2 }), true);
});

test("pins featured assets to the front without changing their ranks", () => {
  const rlusd = market({
    id: "ripple-usd",
    symbol: "RLUSD",
    name: "Ripple USD",
    rank: 80,
    priceUsd: 1.0001,
    change24hPercent: 0.01,
  });
  const universe = [...rankedMarkets(100), rlusd];
  const ticker = applyFeaturedPlacement(universe, ["ripple", "ripple-usd"], 50);

  assert.equal(ticker[0]?.id, "ripple");
  assert.equal(ticker[0]?.rank, 4);
  assert.equal(ticker[1]?.id, "ripple-usd");
  assert.equal(ticker[1]?.rank, 80);
  assert.equal(
    ticker.some((item) => item.id === "coin-1"),
    true,
  );
  assert.equal(ticker.filter((item) => item.id === "ripple").length, 1);
  assert.equal(ticker.length, 51);
});

test("omits featured assets that the provider did not return", () => {
  const ticker = applyFeaturedPlacement(rankedMarkets(50), ["ripple", "ripple-usd"], 50);
  assert.equal(ticker[0]?.id, "ripple");
  assert.equal(
    ticker.some((item) => item.id === "ripple-usd"),
    false,
  );
  assert.equal(ticker.length, 50);
});

test("empty featured config disables pinning", () => {
  assert.deepEqual(parseFeaturedAssetIds(""), []);
  assert.deepEqual(parseFeaturedAssetIds(undefined), ["ripple", "ripple-usd"]);
  const ticker = applyFeaturedPlacement(rankedMarkets(50), [], 50);
  assert.equal(ticker[0]?.id, "coin-1");
});

test("maps CoinPaprika rows into the internal market model and drops invalid prices", () => {
  const bitcoin = mapCoinPaprikaMarket({
    id: "btc-bitcoin",
    name: "Bitcoin",
    symbol: " btc ",
    rank: 1,
    circulating_supply: 19_800_000,
    last_updated: "2026-09-04T18:00:00.000Z",
    quotes: {
      USD: {
        price: 112482.31,
        volume_24h: 40_000_000_000,
        market_cap: 2_000_000_000_000,
        percent_change_1h: 0.12,
        percent_change_24h: 2.14,
        percent_change_7d: -1.4,
      },
    },
  });
  assert.equal(bitcoin?.symbol, "BTC");
  assert.equal(bitcoin?.name, "Bitcoin");
  assert.equal(bitcoin?.priceUsd, 112482.31);
  assert.equal(bitcoin?.marketCapUsd, 2_000_000_000_000);
  assert.equal(bitcoin?.volume24hUsd, 40_000_000_000);
  assert.equal(bitcoin?.change1hPercent, 0.12);
  assert.equal(bitcoin?.change24hPercent, 2.14);
  assert.equal(bitcoin?.change7dPercent, -1.4);
  assert.equal(bitcoin?.image, "https://static.coinpaprika.com/coin/btc-bitcoin/logo.png");
  assert.equal(bitcoin?.updatedAt, "2026-09-04T18:00:00.000Z");
  assert.equal(
    mapCoinPaprikaMarket({
      id: "broken",
      symbol: "x",
      name: "X",
      rank: 2,
      quotes: { USD: { price: 0, percent_change_24h: 1 } },
    }),
    null,
  );
  assert.equal(
    mapCoinPaprikaMarket({
      id: "broken",
      symbol: " ",
      name: "X",
      rank: 2,
      quotes: { USD: { price: 12, percent_change_24h: 1 } },
    }),
    null,
  );
  assert.equal(
    mapCoinPaprikaMarket({
      id: "broken",
      symbol: "x",
      name: "X",
      rank: 0,
      quotes: { USD: { price: 12, percent_change_24h: 1 } },
    }),
    null,
  );
});

test("maps CoinGecko rows into the internal market model and drops invalid prices", () => {
  const bitcoin = mapCoinGeckoMarket({
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
    market_cap_rank: 1,
    current_price: 112482.31,
    market_cap: 2_000_000_000_000,
    total_volume: 40_000_000_000,
    circulating_supply: 19_800_000,
    price_change_percentage_24h: 2.14,
    price_change_percentage_1h_in_currency: 0.12,
    price_change_percentage_7d_in_currency: -1.4,
    last_updated: "2026-09-04T18:00:00.000Z",
  });
  assert.equal(bitcoin?.symbol, "BTC");
  assert.equal(bitcoin?.priceUsd, 112482.31);
  assert.equal(bitcoin?.change1hPercent, 0.12);
  assert.equal(bitcoin?.change7dPercent, -1.4);
  assert.equal(
    mapCoinGeckoMarket({
      id: "broken",
      symbol: "x",
      name: "X",
      market_cap_rank: 2,
      current_price: 0,
    }),
    null,
  );
  assert.equal(
    mapCoinGeckoMarket({
      id: "broken",
      symbol: "x",
      name: "X",
      market_cap_rank: 2,
      current_price: null,
    }),
    null,
  );
});

test("serves cached markets while fresh and keeps the last good snapshot when the provider fails", async () => {
  const now = { value: 1_000 };
  let calls = 0;
  const provider: CryptoMarketProvider = {
    id: "coingecko",
    async getTopMarkets() {
      calls += 1;
      if (calls === 2) throw new Error("provider unavailable");
      return rankedMarkets(100);
    },
  };
  const service = createMarketService({
    provider,
    cache: new MarketDataCache(6 * 60_000, () => now.value),
    featuredIds: ["ripple", "ripple-usd"],
    freshnessMs: 6 * 60_000,
    now: () => now.value,
  });

  const first = await service.getSnapshot();
  assert.equal(first?.status, "fresh");
  assert.equal(first?.markets.length, 100);
  assert.equal(calls, 1);

  now.value += 10_000;
  const stillFresh = await service.getSnapshot();
  assert.equal(stillFresh?.status, "fresh");
  assert.equal(calls, 1);

  now.value += 6 * 60_000;
  const stale = await service.getSnapshot();
  assert.equal(stale?.status, "stale");
  assert.equal(stale?.markets.length, 100);
  assert.equal(calls, 2);

  const ticker = await service.getTickerPayload();
  assert.equal(ticker?.assets[0]?.id, "ripple");
  assert.ok((ticker?.assets.length ?? 0) >= 50);
});

test("returns nothing until a provider has produced at least one successful snapshot", async () => {
  const provider: CryptoMarketProvider = {
    id: "coingecko",
    async getTopMarkets() {
      throw new Error("provider unavailable");
    },
  };
  const service = createMarketService({
    provider,
    cache: new MarketDataCache(6 * 60_000, () => 1_000),
    featuredIds: ["ripple"],
  });
  assert.equal(await service.getSnapshot(), null);
  assert.equal(await service.getTickerPayload(), null);
});

test("merges featured assets that sit outside the top 100 without inventing prices", async () => {
  const rlusd = market({
    id: "ripple-usd",
    symbol: "RLUSD",
    rank: 180,
    priceUsd: 1.0002,
    change24hPercent: 0.01,
  });
  const provider: CryptoMarketProvider = {
    id: "coingecko",
    async getTopMarkets() {
      return rankedMarkets(100);
    },
    async getMarketsByIds(ids) {
      return ids.includes("ripple-usd") ? [rlusd] : [];
    },
  };
  const service = createMarketService({
    provider,
    cache: new MarketDataCache(6 * 60_000, () => 1_000),
    featuredIds: ["ripple", "ripple-usd"],
  });
  const universe = await service.getUniverse();
  assert.equal(universe.length, 101);
  assert.equal(
    universe.some((item) => item.id === "ripple-usd"),
    true,
  );

  const ticker = await service.getTickerPayload();
  assert.equal(ticker?.assets[0]?.id, "ripple");
  assert.equal(ticker?.assets[1]?.id, "ripple-usd");
  assert.equal(ticker?.assets[1]?.rank, 180);
});

test("does not activate CoinPaprika unless the commercial-use flag is set", async () => {
  const previousProvider = process.env["MARKET_DATA_PROVIDER"];
  const previousAllow = process.env["MARKET_DATA_ALLOW_COINPAPRIKA"];
  process.env["MARKET_DATA_PROVIDER"] = "coinpaprika";
  delete process.env["MARKET_DATA_ALLOW_COINPAPRIKA"];
  const { createMarketProviderFromEnv } = await import("../src/lib/markets/service.server.ts");
  try {
    assert.equal(createMarketProviderFromEnv().id, "coingecko");
    process.env["MARKET_DATA_ALLOW_COINPAPRIKA"] = "true";
    assert.equal(createMarketProviderFromEnv().id, "coinpaprika");
  } finally {
    if (previousProvider === undefined) delete process.env["MARKET_DATA_PROVIDER"];
    else process.env["MARKET_DATA_PROVIDER"] = previousProvider;
    if (previousAllow === undefined) delete process.env["MARKET_DATA_ALLOW_COINPAPRIKA"];
    else process.env["MARKET_DATA_ALLOW_COINPAPRIKA"] = previousAllow;
  }
});
