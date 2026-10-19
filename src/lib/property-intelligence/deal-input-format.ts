const dealMoneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatDealMoneyInput(value: number) {
  return Number.isFinite(value) && value > 0 ? dealMoneyFormatter.format(value) : "";
}

export function normalizeDealMoneyText(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const [rawWhole = "", ...rawFractionParts] = cleaned.split(".");
  const hasDecimal = cleaned.includes(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (!hasDecimal) return groupedWhole;
  return `${groupedWhole}.${rawFractionParts.join("").slice(0, 2)}`;
}

export function parseDealMoneyInput(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
