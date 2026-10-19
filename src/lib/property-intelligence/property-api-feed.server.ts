// Data source for the public property API route: property_intel_parcels
// joined with property_intel_profiles (Phase 2's already-shipped St. Louis
// workspace). Deliberately does NOT read property_core/property_ingest (the
// nationwide ingestion schema from Slices 1-3) -- see
// 20260924160000_property_api_platform.sql's header for why.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PROPERTY_API_MAX_PAGE_SIZE,
  decodePropertyApiCursor,
  encodePropertyApiCursor,
  type PublicParcelRow,
  type PublicPropertyQuery,
} from "@/lib/property-intelligence/property-api-contract";

export type PublicPropertyFeedPage = {
  rows: PublicParcelRow[];
  total: number;
  nextCursor: string | null;
};

export async function resolvePublicPropertyFeed(
  query: PublicPropertyQuery,
): Promise<PublicPropertyFeedPage> {
  const offset = decodePropertyApiCursor(query);
  const needsProfileJoin = query.ward !== null || query.zip !== null;
  const select = needsProfileJoin
    ? "id, asr_parcel_id, current_address, match_status, last_intelligence_sync_at, updated_at, property_intel_profiles!inner(*)"
    : "id, asr_parcel_id, current_address, match_status, last_intelligence_sync_at, updated_at, property_intel_profiles(*)";

  let builder = supabaseAdmin.from("property_intel_parcels").select(select, { count: "exact" });

  if (query.parcelId) builder = builder.eq("asr_parcel_id", query.parcelId);
  if (query.q) builder = builder.ilike("current_address", `%${query.q}%`);
  if (query.ward !== null) builder = builder.eq("property_intel_profiles.ward", query.ward);
  if (query.zip) builder = builder.eq("property_intel_profiles.zip_code", query.zip);

  builder =
    query.sort === "address_asc"
      ? builder
          .order("current_address", { ascending: true, nullsFirst: false })
          .order("id", { ascending: true })
      : builder.order("updated_at", { ascending: false }).order("id", { ascending: true });

  const limit = Math.min(query.pageSize, PROPERTY_API_MAX_PAGE_SIZE);
  builder = builder.range(offset, offset + limit - 1);

  const { data, error, count } = await builder;
  if (error) throw error;

  const rows = (data ?? []) as unknown as PublicParcelRow[];
  const total = count ?? rows.length;
  const nextOffset = offset + rows.length;
  const nextCursor = nextOffset < total ? encodePropertyApiCursor(nextOffset, query) : null;
  return { rows, total, nextCursor };
}
