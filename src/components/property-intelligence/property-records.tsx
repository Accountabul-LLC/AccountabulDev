// Ported/adapted from Accountabul-LLC/property-insight-hub src/components/property-records.tsx
// (and the record-browsing half of its property-explorer.tsx). property-insight-hub fetches a
// full, client-filterable payload from a Next.js /api/properties route; accountabul-final
// instead already has a paginated, server-validated search function
// (searchPropertyRecords in property-intelligence.functions.ts, backed by search.ts) that this
// component calls directly, matching the "prefer accountabul-final's existing, already-working
// server functions" instruction. State/county location facets from
// property-record-location-filters.ts are not wired here: search.ts's paginated model does not
// expose those facets the way property-insight-hub's full in-memory payload did.

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAddress } from "@/lib/property-intelligence/address-display";
import { buildGoogleMapsUrl } from "@/lib/property-intelligence/google-maps";
import type {
  PropertyRecord,
  PropertyRecordCategory,
  PropertySearchAmountFilter,
  PropertySearchSort,
} from "@/lib/property-intelligence/property-data";
import { searchPropertyRecords } from "@/lib/property-intelligence/property-intelligence.functions";
import { VerificationBadge } from "@/components/property-intelligence/verification-badge";

const money = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

function Select<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function PropertyRecords({
  onAnalyze,
}: {
  onAnalyze: (record: PropertyRecord) => void;
}) {
  const search = useServerFn(searchPropertyRecords);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PropertyRecordCategory | "">("");
  const [amountFilter, setAmountFilter] = useState<PropertySearchAmountFilter>("all");
  const [sort, setSort] = useState<PropertySearchSort>("record_order");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ["property-records", query, category, amountFilter, sort, page],
    queryFn: () =>
      search({ data: { query, category: category || null, amountFilter, sort, page } }),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
  const records = results.data?.records ?? [];
  const selected = records.find((record) => record.id === selectedId) ?? records[0] ?? null;
  const pages = results.data
    ? Math.max(Math.ceil(results.data.total / results.data.pageSize), 1)
    : 1;
  const resetPage =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(0);
    };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="surface-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="pi-query">Search address, parcel, owner or ZIP</Label>
            <Input
              id="pi-query"
              value={query}
              placeholder="e.g. Maffitt, 63113, LRA"
              onChange={(event) => resetPage(setQuery)(event.target.value)}
            />
          </div>
          <Select
            id="pi-category"
            label="Record type"
            value={category}
            onChange={resetPage(setCategory)}
            options={[
              ["", "All records"],
              ["City-owned", "City-owned"],
              ["Tax sale", "Tax sale"],
            ]}
          />
          <Select
            id="pi-amount"
            label="Amount"
            value={amountFilter}
            onChange={resetPage(setAmountFilter)}
            options={[
              ["all", "Any amount"],
              ["under_5000", "Under $5,000"],
              ["5000_15000", "$5,000 – $15,000"],
              ["over_15000", "Over $15,000"],
              ["offer_required", "Offer required"],
            ]}
          />
          <Select
            id="pi-sort"
            label="Sort"
            value={sort}
            onChange={resetPage(setSort)}
            options={[
              ["record_order", "Newest records"],
              ["amount_asc", "Lowest amount"],
              ["amount_desc", "Highest amount"],
              ["address", "Address A–Z"],
            ]}
          />
        </div>

        <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
          {results.isLoading
            ? "Loading official records…"
            : results.isError
              ? "Records could not be loaded. Try again shortly."
              : `${results.data?.total.toLocaleString() ?? 0} matching records`}
        </p>

        <ul className="mt-2 max-h-[520px] divide-y divide-border overflow-y-auto">
          {records.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => setSelectedId(record.id)}
                aria-current={selected?.id === record.id}
                className={`flex w-full items-start justify-between gap-3 px-2 py-3 text-left text-sm ${
                  selected?.id === record.id ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                <span>
                  <span className="block font-medium">{formatAddress(record.address)}</span>
                  <span className="text-xs text-muted-foreground">
                    {record.recordCategory} · {record.agency ?? record.source} · {record.city},{" "}
                    {record.stateCode}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 text-right text-sm font-semibold">
                  <VerificationBadge tier="trusted-provider" />
                  {record.price === null ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      Offer required
                    </span>
                  ) : (
                    money(record.price)
                  )}
                </span>
              </button>
            </li>
          ))}
          {records.length === 0 && !results.isLoading ? (
            <li className="px-2 py-6 text-sm text-muted-foreground">
              No property records match these filters.
            </li>
          ) : null}
        </ul>

        <div className="mt-3 flex items-center justify-between text-xs">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </section>

      <section className="surface-card p-5">
        {selected ? (
          <RecordDetail record={selected} onAnalyze={onAnalyze} />
        ) : (
          <p className="text-sm text-muted-foreground">Select a record to see its details.</p>
        )}
      </section>
    </div>
  );
}

function RecordDetail({
  record,
  onAnalyze,
}: {
  record: PropertyRecord;
  onAnalyze: (record: PropertyRecord) => void;
}) {
  const mapUrl = buildGoogleMapsUrl(record);
  const facts: Array<[string, string]> = [
    [record.priceLabel, record.price === null ? "Offer required" : money(record.price)],
    ["Parcel ID", record.parcelId ?? "Not published"],
    ["Record number", record.recordNumber],
    ["Status", record.status],
    ["Owner of record", record.owner ?? "Not published"],
    ["Property type", record.propertyType ?? "Not published"],
    [
      "Lot size",
      record.squareFeet ? `${record.squareFeet.toLocaleString()} sq ft` : "Not published",
    ],
    [
      "Assessor total",
      record.assessorValue === null ? "Not published" : money(record.assessorValue),
    ],
    ["Ward / neighborhood", `${record.ward ?? "—"} / ${record.neighborhood ?? "—"}`],
    ["County", `${record.countyName} (${record.countyFips})`],
  ];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {record.recordCategory}
        </p>
        <VerificationBadge tier="trusted-provider" />
      </div>
      <h2 className="mt-1 font-display text-2xl font-semibold">{formatAddress(record.address)}</h2>
      <p className="text-sm text-muted-foreground">
        {record.city}, {record.stateName} {record.zipCode ?? ""}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {record.description ? <p className="mt-4 text-sm">{record.description}</p> : null}
      {record.notices.length ? (
        <ul className="mt-4 space-y-1 rounded-md bg-secondary p-3 text-xs">
          {record.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">{record.sourceUpdated}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => onAnalyze(record)}>Analyze this deal</Button>
        {mapUrl ? (
          <Button variant="outline" asChild>
            <a href={mapUrl} target="_blank" rel="noopener noreferrer">
              Open in Google Maps
            </a>
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">
            Official source
          </a>
        </Button>
      </div>
    </div>
  );
}
