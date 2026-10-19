import { searchCityParcels } from "./parcel-search.ts";
import type { ParcelSearchResult } from "./analysis-types.ts";

// Assessor facts are treated as stale after this and re-fetched on next open,
// matching the source app's "auto-refresh when missing or >6h old" rule.
const STALE_MS = 6 * 60 * 60_000;

function toSnakeProfile(parcel: ParcelSearchResult, parcelRowId: string) {
  return {
    parcel_id: parcelRowId,
    lot_square_feet: parcel.lotSquareFeet,
    ward: parcel.ward,
    tax_balance: parcel.taxBalance,
    prior_tax_amount: parcel.priorTaxAmount,
    property_class_code: parcel.propertyClassCode,
    is_tax_abated: parcel.isTaxAbated,
    abatement_start_year: parcel.abatementStartYear,
    abatement_end_year: parcel.abatementEndYear,
    web_mercator_x: parcel.webMercatorX,
    web_mercator_y: parcel.webMercatorY,
    city_block: parcel.cityBlock,
    parcel_number: parcel.parcelNumber,
    owner_name: parcel.ownerName,
    owner_name_2: parcel.ownerName2,
    legal_description: parcel.legalDescription,
    assessor_class_code: parcel.assessorClassCode,
    land_use_code: parcel.landUseCode,
    vacant_lot: parcel.vacantLot,
    number_of_units: parcel.numberOfUnits,
    number_of_apartments: parcel.numberOfApartments,
    frontage_feet: parcel.frontageFeet,
    land_area: parcel.landArea,
    assessed_land_value: parcel.assessedLandValue,
    assessed_improvement_value: parcel.assessedImprovementValue,
    assessed_total_value: parcel.assessedTotalValue,
    appraised_land_value: parcel.appraisedLandValue,
    appraised_improvement_value: parcel.appraisedImprovementValue,
    zoning: parcel.zoning,
    residential_building_count: parcel.residentialBuildingCount,
    commercial_building_count: parcel.commercialBuildingCount,
    first_year_built: parcel.firstYearBuilt,
    last_year_built: parcel.lastYearBuilt,
    last_residential_sale_price: parcel.lastResidentialSalePrice,
    last_residential_sale_date: parcel.lastResidentialSaleDate,
    vacant_building_year: parcel.vacantBuildingYear,
    neighborhood_code: parcel.neighborhoodCode,
    zip_code: parcel.zipCode,
    owner_occupied: parcel.ownerOccupied,
    assessor_handle: parcel.assessorHandle,
    source_url: parcel.sourceUrl,
    observed_at: parcel.observedAt,
  };
}

/**
 * Address or 11-digit parcel ID -> ranked official Assessor matches. Pure
 * network call, no persistence; the caller picks a match and calls
 * upsertParcelAndProfile to commit it.
 */
export async function searchAssessorParcels(input: string) {
  return searchCityParcels(input, fetch);
}

/**
 * Writes (or refreshes) the canonical parcel + its Assessor dossier, then
 * opens or reopens the signed-in user's permanent workspace for it. Runs
 * with the service role because property_intel_parcels/_profiles are
 * shared reference data, not owned by any one user.
 */
export async function resolveOrCreateWorkspace(userId: string, parcel: ParcelSearchResult) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: parcelRow, error: parcelError } = await supabaseAdmin
    .from("property_intel_parcels")
    .upsert(
      {
        asr_parcel_id: parcel.parcelId,
        current_address: parcel.address,
        match_status: "parcel-id-verified",
        last_intelligence_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "asr_parcel_id" },
    )
    .select("id")
    .single();
  if (parcelError) throw parcelError;

  const { error: profileError } = await supabaseAdmin
    .from("property_intel_profiles")
    .upsert(toSnakeProfile(parcel, parcelRow.id), { onConflict: "parcel_id" });
  if (profileError) throw profileError;

  const { data: thread, error: threadError } = await supabaseAdmin
    .from("property_analysis_threads")
    .upsert(
      {
        parcel_id: parcelRow.id,
        user_id: userId,
        title: parcel.address,
        last_opened_at: new Date().toISOString(),
      },
      { onConflict: "user_id,parcel_id", ignoreDuplicates: false },
    )
    .select("id, status, created_at")
    .single();
  if (threadError?.message?.includes("property_analysis_thread_quota_exceeded")) {
    throw new Error("You have reached 200 property workspaces. Delete one to open another.");
  }
  if (threadError) throw threadError;

  return { threadId: thread.id, parcelRowId: parcelRow.id, status: thread.status };
}

export function isStale(observedAt: string | null, nowMs = Date.now()) {
  if (!observedAt) return true;
  return nowMs - Date.parse(observedAt) > STALE_MS;
}
