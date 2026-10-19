const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number | null | undefined, currency = "USD") {
  if (minor === null || minor === undefined) return "Price on request";
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(minor / 100);
}

export function parseMoneyToMinor(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function uniqueSlug(value: string) {
  const base = slugify(value) || "item";
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Time to be announced";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function locationLabel(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ");
}
