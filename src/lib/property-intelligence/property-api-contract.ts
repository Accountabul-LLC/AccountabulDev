// Property Intelligence public API contract: sandbox key material, bearer
// parsing, request-query normalization, response projection, CORS, and error
// shaping. Ported from property-intelligence-app's `property-api-contract.ts`,
// adapted to this repo's actual queryable data source -- the St. Louis
// parcel/profile workspace (property_intel_parcels / property_intel_profiles,
// Phase 2 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md) -- not the nationwide
// property_core/property_ingest schema (Slices 1-3), which has no populated
// data path yet. No framework or `@/` imports, so this file is directly
// unit-testable under plain `node --test`. The compare and hex helpers are
// relative imports with no packages, matching report-vault-validation.ts.

import { bytesToHex as hex } from "../security/hex.ts";

export { constantTimeEqual } from "../security/constant-time.ts";

export const PROPERTY_API_KEY_SCOPE = "properties:read";
export const PROPERTY_API_MINUTE_LIMIT = 60;
export const PROPERTY_API_MAX_ACTIVE_KEYS = 3;
export const PROPERTY_API_DEFAULT_PAGE_SIZE = 25;
export const PROPERTY_API_MAX_PAGE_SIZE = 75;

const KEY_PATTERN = /^(acct_test_[a-f0-9]{24})_([A-Za-z0-9_-]{43})$/;
const QUERY_PARAMETERS = new Set(["q", "ward", "zip", "parcel_id", "sort", "cursor", "limit"]);
const SORTS = new Set(["updated_desc", "address_asc"]);

export type PropertyApiKeyMaterial = {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
};

export type PublicPropertySort = "updated_desc" | "address_asc";

export type PublicPropertyQuery = {
  q: string | null;
  ward: number | null;
  zip: string | null;
  parcelId: string | null;
  sort: PublicPropertySort;
  cursor: string | null;
  pageSize: number;
};

/**
 * The provenance-safe public projection of a parcel + its Assessor profile.
 *
 * Exposed: the canonical parcel identity (asr_parcel_id, address, match
 * status, sync/update timestamps) and every Assessor dossier field a
 * customer actually pays for (valuation, ownership, zoning, building/lot
 * facts, tax status).
 *
 * Deliberately withheld, matching the source contract's own "public read-only
 * projection never leaks internal-only fields" stance (and this repo's own
 * nationwide-ingestion migration's reasoning about not exposing scraping
 * mechanics, 20260924150000_property_intelligence_ingestion_pipeline.sql):
 *   - property_intel_profiles.source_url -- the exact page the Assessor
 *     dossier was scraped from; internal provenance, not a public contract.
 *   - property_intel_profiles.assessor_handle -- an internal resolver/session
 *     handle, not a stable public identifier.
 *   - property_intel_profiles.web_mercator_x / web_mercator_y -- raw internal
 *     GIS projection coordinates, never part of the public contract.
 *   - Everything about the caller's own property_analysis_threads workspace
 *     (title, status, deal scenarios, owner documents, reports) -- this route
 *     only ever serves the shared canonical parcel/profile reference data,
 *     never another account's or even the caller's own per-user workspace
 *     state.
 */
export type PublicPropertyRecord = {
  id: string;
  asr_parcel_id: string;
  address: string | null;
  match_status: string;
  last_intelligence_sync_at: string | null;
  updated_at: string;
  assessor: null | {
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
};

export type PublicParcelRow = {
  id: string;
  asr_parcel_id: string;
  current_address: string | null;
  match_status: string;
  last_intelligence_sync_at: string | null;
  updated_at: string;
  property_intel_profiles: null | Record<string, unknown>;
};

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

/** Never returns a hash that equals its own raw key material verbatim. */
export async function createPropertyApiKeyMaterial(): Promise<PropertyApiKeyMaterial> {
  const keyPrefix = `acct_test_${hex(randomBytes(12))}`;
  const rawKey = `${keyPrefix}_${base64Url(randomBytes(32))}`;
  return { rawKey, keyPrefix, keyHash: await sha256Hex(rawKey) };
}

export function parsePropertyApiKey(value: string | null) {
  if (value === null) return null;
  const match = value.match(KEY_PATTERN);
  return match ? { rawKey: value, keyPrefix: match[1]! } : null;
}

export function readBearerKey(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer (\S+)$/);
  return parsePropertyApiKey(match?.[1] ?? null);
}

export function normalizePublicPropertyQuery(url: URL): PublicPropertyQuery {
  for (const key of url.searchParams.keys()) {
    if (!QUERY_PARAMETERS.has(key)) throw new Error(`Unsupported query parameter: ${key}.`);
  }

  const q = url.searchParams.get("q");
  if (q !== null && (q.trim().length === 0 || q.length > 200)) {
    throw new Error("q must contain 1 through 200 characters.");
  }

  const wardText = url.searchParams.get("ward");
  let ward: number | null = null;
  if (wardText !== null) {
    if (!/^[1-9]\d*$/.test(wardText) || Number(wardText) > 99) {
      throw new Error("ward must be a whole number from 1 through 99.");
    }
    ward = Number(wardText);
  }

  const zip = url.searchParams.get("zip");
  if (zip !== null && !/^\d{5}$/.test(zip)) {
    throw new Error("zip must be a five-digit ZIP code.");
  }

  const parcelId = url.searchParams.get("parcel_id");
  if (parcelId !== null && !/^\d{11}$/.test(parcelId)) {
    throw new Error("parcel_id must be an eleven-digit Assessor parcel id.");
  }

  const sortText = url.searchParams.get("sort") ?? "updated_desc";
  if (!SORTS.has(sortText)) throw new Error("sort must be updated_desc or address_asc.");

  const limitText = url.searchParams.get("limit");
  let pageSize = PROPERTY_API_DEFAULT_PAGE_SIZE;
  if (limitText !== null) {
    if (!/^[1-9]\d*$/.test(limitText) || Number(limitText) > PROPERTY_API_MAX_PAGE_SIZE) {
      throw new Error(`limit must be a whole number from 1 through ${PROPERTY_API_MAX_PAGE_SIZE}.`);
    }
    pageSize = Number(limitText);
  }

  return {
    q: q?.trim() || null,
    ward,
    zip,
    parcelId,
    sort: sortText as PublicPropertySort,
    cursor: url.searchParams.get("cursor"),
    pageSize,
  };
}

function cursorSignature(query: PublicPropertyQuery) {
  return JSON.stringify([query.q, query.ward, query.zip, query.parcelId, query.sort]);
}

export function encodePropertyApiCursor(offset: number, query: PublicPropertyQuery) {
  return `page_${base64Url(
    new TextEncoder().encode(
      JSON.stringify({ version: 1, offset, signature: cursorSignature(query) }),
    ),
  )}`;
}

export function decodePropertyApiCursor(query: PublicPropertyQuery) {
  if (!query.cursor) return 0;
  try {
    if (!query.cursor.startsWith("page_")) throw new Error("invalid");
    const bytes = fromBase64Url(query.cursor.slice("page_".length));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (
      parsed["version"] !== 1 ||
      !Number.isInteger(parsed["offset"]) ||
      Number(parsed["offset"]) < 0 ||
      parsed["signature"] !== cursorSignature(query)
    ) {
      throw new Error("invalid");
    }
    return Number(parsed["offset"]);
  } catch {
    throw new Error("cursor is invalid for the current filters.");
  }
}

function publicAssessorProfile(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  return {
    ward: (profile["ward"] as number | null) ?? null,
    lot_square_feet: (profile["lot_square_feet"] as number | null) ?? null,
    tax_balance: (profile["tax_balance"] as number | null) ?? null,
    prior_tax_amount: (profile["prior_tax_amount"] as number | null) ?? null,
    property_class_code: (profile["property_class_code"] as number | null) ?? null,
    is_tax_abated: (profile["is_tax_abated"] as boolean | null) ?? null,
    abatement_start_year: (profile["abatement_start_year"] as number | null) ?? null,
    abatement_end_year: (profile["abatement_end_year"] as number | null) ?? null,
    city_block: (profile["city_block"] as number | null) ?? null,
    parcel_number: (profile["parcel_number"] as number | null) ?? null,
    owner_name: (profile["owner_name"] as string | null) ?? null,
    owner_name_2: (profile["owner_name_2"] as string | null) ?? null,
    legal_description: (profile["legal_description"] as string | null) ?? null,
    assessor_class_code: (profile["assessor_class_code"] as string | null) ?? null,
    land_use_code: (profile["land_use_code"] as string | null) ?? null,
    vacant_lot: (profile["vacant_lot"] as boolean | null) ?? null,
    number_of_units: (profile["number_of_units"] as number | null) ?? null,
    number_of_apartments: (profile["number_of_apartments"] as number | null) ?? null,
    frontage_feet: (profile["frontage_feet"] as number | null) ?? null,
    land_area: (profile["land_area"] as number | null) ?? null,
    assessed_land_value: (profile["assessed_land_value"] as number | null) ?? null,
    assessed_improvement_value: (profile["assessed_improvement_value"] as number | null) ?? null,
    assessed_total_value: (profile["assessed_total_value"] as number | null) ?? null,
    appraised_land_value: (profile["appraised_land_value"] as number | null) ?? null,
    appraised_improvement_value: (profile["appraised_improvement_value"] as number | null) ?? null,
    zoning: (profile["zoning"] as string | null) ?? null,
    residential_building_count: (profile["residential_building_count"] as number | null) ?? null,
    commercial_building_count: (profile["commercial_building_count"] as number | null) ?? null,
    first_year_built: (profile["first_year_built"] as number | null) ?? null,
    last_year_built: (profile["last_year_built"] as number | null) ?? null,
    last_residential_sale_price: (profile["last_residential_sale_price"] as number | null) ?? null,
    last_residential_sale_date: (profile["last_residential_sale_date"] as string | null) ?? null,
    vacant_building_year: (profile["vacant_building_year"] as number | null) ?? null,
    neighborhood_code: (profile["neighborhood_code"] as string | null) ?? null,
    zip_code: (profile["zip_code"] as string | null) ?? null,
    owner_occupied: (profile["owner_occupied"] as boolean | null) ?? null,
    observed_at: profile["observed_at"] as string,
  };
}

export function publicPropertyRecord(row: PublicParcelRow): PublicPropertyRecord {
  return {
    id: row.id,
    asr_parcel_id: row.asr_parcel_id,
    address: row.current_address,
    match_status: row.match_status,
    last_intelligence_sync_at: row.last_intelligence_sync_at,
    updated_at: row.updated_at,
    assessor: publicAssessorProfile(row.property_intel_profiles),
  };
}

export function propertyApiCorsHeaders(request: Request, configuredOrigins: string | undefined) {
  const origin = request.headers.get("origin");
  if (!origin) return new Headers({ Vary: "Origin" });
  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set(
    (configuredOrigins ?? "")
      .split(",")
      .map((candidate) => candidate.trim())
      .filter((candidate) => {
        try {
          return new URL(candidate).protocol === "https:";
        } catch {
          return false;
        }
      }),
  );
  if (origin !== requestOrigin && !allowedOrigins.has(origin)) return null;
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
}

export function propertyApiError(
  requestId: string,
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
) {
  return Response.json(
    { error: { code, message, request_id: requestId } },
    {
      status,
      headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)) },
    },
  );
}
