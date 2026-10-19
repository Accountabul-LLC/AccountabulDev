import type {
  PropertyRecord,
  PropertyRecordCategory,
  PropertySearchAmountFilter,
  PropertySearchSort,
} from "./property-data.ts";
import { propertyHasRecordCategory, propertyMatchesQuery } from "./property-record-search.ts";

export type RecordSearchInput = {
  query: string;
  category: PropertyRecordCategory | null;
  amountFilter: PropertySearchAmountFilter;
  sort: PropertySearchSort;
  page: number;
};

export const PAGE_SIZE = 25;
const CATEGORIES = new Set<PropertyRecordCategory>([
  "City-owned",
  "Public inventory",
  "Tax sale",
  "Assessor record",
  "Property record",
]);
const AMOUNTS = new Set<PropertySearchAmountFilter>([
  "all",
  "under_5000",
  "5000_15000",
  "over_15000",
  "offer_required",
]);
const SORTS = new Set<PropertySearchSort>(["record_order", "amount_asc", "amount_desc", "address"]);

/** Boundary validation for the search server function: unknown values fall back to safe defaults. */
export function parseRecordSearchInput(value: unknown): RecordSearchInput {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const query = typeof input["query"] === "string" ? input["query"].slice(0, 120) : "";
  const category = CATEGORIES.has(input["category"] as PropertyRecordCategory)
    ? (input["category"] as PropertyRecordCategory)
    : null;
  const amountFilter = AMOUNTS.has(input["amountFilter"] as PropertySearchAmountFilter)
    ? (input["amountFilter"] as PropertySearchAmountFilter)
    : "all";
  const sort = SORTS.has(input["sort"] as PropertySearchSort)
    ? (input["sort"] as PropertySearchSort)
    : "record_order";
  const page = Math.min(Math.max(Math.trunc(Number(input["page"]) || 0), 0), 1000);
  return { query, category, amountFilter, sort, page };
}

function matchesAmount(record: PropertyRecord, filter: PropertySearchAmountFilter) {
  // A missing price means "offer required", never $0.
  if (filter === "all") return true;
  if (filter === "offer_required") return record.price === null;
  if (record.price === null) return false;
  if (filter === "under_5000") return record.price < 5000;
  if (filter === "5000_15000") return record.price >= 5000 && record.price <= 15000;
  return record.price > 15000;
}

export function searchRecords(records: PropertyRecord[], input: RecordSearchInput) {
  const matched = records.filter(
    (record) =>
      (!input.query.trim() || propertyMatchesQuery(record, input.query)) &&
      (!input.category || propertyHasRecordCategory(record, input.category)) &&
      matchesAmount(record, input.amountFilter),
  );
  if (input.sort === "address") matched.sort((a, b) => a.address.localeCompare(b.address));
  if (input.sort === "amount_asc" || input.sort === "amount_desc") {
    const direction = input.sort === "amount_asc" ? 1 : -1;
    // Unpriced records always sort last so "cheapest" never surfaces an offer-only parcel as free.
    matched.sort((a, b) =>
      a.price === null ? 1 : b.price === null ? -1 : (a.price - b.price) * direction,
    );
  }
  const start = input.page * PAGE_SIZE;
  return {
    total: matched.length,
    page: input.page,
    pageSize: PAGE_SIZE,
    records: matched.slice(start, start + PAGE_SIZE),
  };
}
