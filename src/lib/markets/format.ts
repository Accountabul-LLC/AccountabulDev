export function formatUsdPrice(price: number): string | null {
  if (!Number.isFinite(price) || price <= 0) return null;

  if (price >= 10) return formatCurrency(price, 2, 2);
  if (price >= 1) return formatCurrency(price, 2, 4);
  if (price >= 0.01) return formatCurrency(price, 4, 4);
  if (price >= 0.0001) return formatCurrency(price, 6, 8);

  const leadingZeros = Math.floor(-Math.log10(price));
  const digits = Math.min(10, Math.max(8, leadingZeros + 2));
  return formatCurrency(price, digits, digits);
}

export function formatChangePercent(change: number): {
  text: string;
  direction: "up" | "down" | "flat";
} | null {
  if (!Number.isFinite(change)) return null;
  const rounded = Math.round(change * 100) / 100;
  const magnitude = `${Math.abs(rounded).toFixed(2)}%`;
  if (rounded > 0) return { text: `▲ +${magnitude}`, direction: "up" };
  if (rounded < 0) return { text: `▼ -${magnitude}`, direction: "down" };
  return { text: magnitude, direction: "flat" };
}

export function isDisplayableMarket(market: {
  priceUsd: number;
  change24hPercent: number;
  symbol: string;
}): boolean {
  return (
    Boolean(market.symbol.trim()) &&
    Number.isFinite(market.priceUsd) &&
    market.priceUsd > 0 &&
    Number.isFinite(market.change24hPercent)
  );
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function formatCurrency(price: number, min: number, max: number) {
  const key = `${min}:${max}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(price);
}
