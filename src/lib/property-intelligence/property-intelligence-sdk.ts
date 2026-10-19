// Accountabul Property Intelligence SDK: a dependency-free, framework-free
// TypeScript client for the public sandbox API
// (src/routes/api/public/property-intelligence.v1.parcels.ts). No `@/`
// imports and nothing beyond standard `fetch`/`URL`/`AbortController`, so
// this file can be lifted verbatim into its own published package later --
// mirroring property-intelligence-app's packages/property-intelligence-sdk.
// This repo has no `packages/` workspace convention (every cross-cutting
// module lives under src/lib/<feature>/), so it stays here rather than
// inventing one for a single file.
const DEFAULT_BASE_URL = "https://accountabul.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const ROUTE_PATH = "/api/public/property-intelligence/v1/parcels";

export type PropertySort = "updated_desc" | "address_asc";

export type PropertySearchFilters = {
  q?: string;
  ward?: number;
  zip?: string;
  parcelId?: string;
  sort?: PropertySort;
  cursor?: string;
  limit?: number;
};

export type AssessorProfile = {
  ward: number | null;
  lot_square_feet: number | null;
  tax_balance: number | null;
  prior_tax_amount: number | null;
  property_class_code: number | null;
  is_tax_abated: boolean | null;
  abatement_start_year: number | null;
  abatement_end_year: number | null;
  city_block: number | null;
  parcel_number: number | null;
  owner_name: string | null;
  owner_name_2: string | null;
  legal_description: string | null;
  assessor_class_code: string | null;
  land_use_code: string | null;
  vacant_lot: boolean | null;
  number_of_units: number | null;
  number_of_apartments: number | null;
  frontage_feet: number | null;
  land_area: number | null;
  assessed_land_value: number | null;
  assessed_improvement_value: number | null;
  assessed_total_value: number | null;
  appraised_land_value: number | null;
  appraised_improvement_value: number | null;
  zoning: string | null;
  residential_building_count: number | null;
  commercial_building_count: number | null;
  first_year_built: number | null;
  last_year_built: number | null;
  last_residential_sale_price: number | null;
  last_residential_sale_date: string | null;
  vacant_building_year: number | null;
  neighborhood_code: string | null;
  zip_code: string | null;
  owner_occupied: boolean | null;
  observed_at: string;
};

export type PropertyRecord = {
  id: string;
  asr_parcel_id: string;
  address: string | null;
  match_status: string;
  last_intelligence_sync_at: string | null;
  updated_at: string;
  assessor: AssessorProfile | null;
};

export type PropertyListResponse = {
  object: "list";
  data: PropertyRecord[];
  meta: {
    request_id: string;
    fetched_at: string;
    total: number;
    next_cursor: string | null;
    limit: number;
  };
};

export type RateLimit = {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  retryAfter: number | null;
};

export type AccountabulClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export type RequestOptions = { signal?: AbortSignal };
export type IterateOptions = RequestOptions & { maxPages?: number };

type ApiErrorBody = { error?: { code?: unknown; message?: unknown; request_id?: unknown } };

export class AccountabulApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly rateLimit: RateLimit;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    requestId?: string | null;
    rateLimit?: Partial<RateLimit>;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AccountabulApiError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId ?? null;
    this.rateLimit = {
      limit: input.rateLimit?.limit ?? null,
      remaining: input.rateLimit?.remaining ?? null,
      resetAt: input.rateLimit?.resetAt ?? null,
      retryAfter: input.rateLimit?.retryAfter ?? null,
    };
  }
}

const sorts = new Set<PropertySort>(["updated_desc", "address_asc"]);

function requiredText(value: string, label: string) {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
  return value.trim();
}

function validateBaseUrl(value: string) {
  const url = new URL(value);
  const localHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("baseUrl must use HTTPS, except for localhost development.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function finiteInteger(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return value;
}

/** Builds the request query from documented filters only, never mutating the
 * caller-supplied `filters` object. */
function propertyQuery(filters: PropertySearchFilters) {
  const params = new URLSearchParams();
  if (filters.q !== undefined) {
    const q = filters.q.trim();
    if (!q || q.length > 200) throw new TypeError("q must contain 1 through 200 characters.");
    params.set("q", q);
  }
  if (filters.ward !== undefined) {
    params.set("ward", String(finiteInteger(filters.ward, "ward", 1, 99)));
  }
  if (filters.zip !== undefined) {
    const zip = filters.zip.trim();
    if (!/^\d{5}$/.test(zip)) throw new TypeError("zip must be a five-digit ZIP code.");
    params.set("zip", zip);
  }
  if (filters.parcelId !== undefined) {
    const parcelId = filters.parcelId.trim();
    if (!/^\d{11}$/.test(parcelId))
      throw new TypeError("parcelId must be an eleven-digit Assessor parcel id.");
    params.set("parcel_id", parcelId);
  }
  if (filters.sort !== undefined) {
    if (!sorts.has(filters.sort)) throw new TypeError("sort is not supported.");
    params.set("sort", filters.sort);
  }
  if (filters.cursor !== undefined) {
    const cursor = filters.cursor.trim();
    if (!cursor) throw new TypeError("cursor must not be empty.");
    params.set("cursor", cursor);
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(finiteInteger(filters.limit, "limit", 1, 75)));
  }
  return params;
}

function headerInteger(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function responseRateLimit(headers: Headers): RateLimit {
  return {
    limit: headerInteger(headers, "x-ratelimit-limit"),
    remaining: headerInteger(headers, "x-ratelimit-remaining"),
    resetAt: headerInteger(headers, "x-ratelimit-reset"),
    retryAfter: headerInteger(headers, "retry-after"),
  };
}

async function jsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isListResponse(value: unknown): value is PropertyListResponse {
  if (
    !isRecord(value) ||
    value["object"] !== "list" ||
    !Array.isArray(value["data"]) ||
    !isRecord(value["meta"])
  ) {
    return false;
  }
  const meta = value["meta"];
  return (
    typeof meta["request_id"] === "string" &&
    typeof meta["fetched_at"] === "string" &&
    typeof meta["total"] === "number" &&
    (typeof meta["next_cursor"] === "string" || meta["next_cursor"] === null) &&
    typeof meta["limit"] === "number"
  );
}

export class AccountabulClient {
  readonly properties: {
    list: (
      filters?: PropertySearchFilters,
      options?: RequestOptions,
    ) => Promise<PropertyListResponse>;
    iterate: (
      filters?: PropertySearchFilters,
      options?: IterateOptions,
    ) => AsyncGenerator<PropertyRecord, void, undefined>;
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: AccountabulClientOptions) {
    if (!options || typeof options !== "object")
      throw new TypeError("AccountabulClient options are required.");
    this.apiKey = requiredText(options.apiKey, "apiKey");
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function")
      throw new TypeError("A standards-based fetch implementation is required.");
    this.timeoutMs = finiteInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      1,
      300_000,
    );
    this.properties = {
      list: (filters = {}, requestOptions = {}) => this.listProperties(filters, requestOptions),
      iterate: (filters = {}, iterateOptions = {}) =>
        this.iterateProperties(filters, iterateOptions),
    };
  }

  private async listProperties(filters: PropertySearchFilters, options: RequestOptions) {
    const params = propertyQuery(filters);
    const url = `${this.baseUrl}${ROUTE_PATH}${params.size ? `?${params}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Accountabul request timed out.")),
      this.timeoutMs,
    );
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      const body = await jsonBody(response);
      if (!response.ok) {
        const errorBody = isRecord(body) ? (body as ApiErrorBody) : {};
        const apiError = isRecord(errorBody.error) ? errorBody.error : {};
        throw new AccountabulApiError({
          code:
            typeof apiError["code"] === "string" ? (apiError["code"] as string) : "request_failed",
          message:
            typeof apiError["message"] === "string"
              ? (apiError["message"] as string)
              : `Accountabul API request failed with status ${response.status}.`,
          status: response.status,
          requestId:
            typeof apiError["request_id"] === "string" ? (apiError["request_id"] as string) : null,
          rateLimit: responseRateLimit(response.headers),
        });
      }
      if (!isListResponse(body)) {
        throw new AccountabulApiError({
          code: "invalid_response",
          message: "The Accountabul API returned an invalid list response.",
          status: response.status,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof AccountabulApiError) throw error;
      if (options.signal?.aborted) throw error;
      if (controller.signal.aborted) {
        throw new AccountabulApiError({
          code: "request_timeout",
          message: "The Accountabul API request timed out.",
          status: 0,
          cause: error,
        });
      }
      throw new AccountabulApiError({
        code: "network_error",
        message: "The Accountabul API request could not be completed.",
        status: 0,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private async *iterateProperties(
    filters: PropertySearchFilters,
    options: IterateOptions,
  ): AsyncGenerator<PropertyRecord, void, undefined> {
    const maxPages =
      options.maxPages === undefined
        ? Number.MAX_SAFE_INTEGER
        : finiteInteger(options.maxPages, "maxPages", 1, 10_000);
    let cursor = filters.cursor;
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const pageFilters = cursor === undefined ? { ...filters } : { ...filters, cursor };
      const pageOptions: RequestOptions = options.signal ? { signal: options.signal } : {};
      const page = await this.listProperties(pageFilters, pageOptions);
      for (const record of page.data) yield record;
      const next = page.meta.next_cursor;
      if (next === null) return;
      if (seen.has(next) || next === cursor) {
        throw new AccountabulApiError({
          code: "pagination_cursor_repeated",
          message: "The Accountabul API repeated a pagination cursor.",
          status: 0,
          requestId: page.meta.request_id,
        });
      }
      seen.add(next);
      cursor = next;
    }
  }
}
