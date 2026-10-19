import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseRecordSearchInput } from "@/lib/property-intelligence/search";
import { UUID_V1_TO_V8 as UUID_PATTERN } from "../validation/patterns.ts";

function optionalText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** ACC-20260923-004: whether the signed-in caller may use Property Intelligence. */
export const getPropertyIntelligenceAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadPropertyIntelligenceAccessFor } =
      await import("@/lib/property-intelligence/access.server");
    return loadPropertyIntelligenceAccessFor(context.userId);
  });

export const searchPropertyRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(parseRecordSearchInput)
  .handler(async ({ data }) => {
    const { getCachedPropertyPayload } =
      await import("@/lib/property-intelligence/feed-cache.server");
    const { searchRecords } = await import("@/lib/property-intelligence/search");
    const payload = await getCachedPropertyPayload();
    return {
      ...searchRecords(payload.properties, data),
      sources: payload.sources.map(({ key, label, mode, loaded }) => ({
        key,
        label,
        mode,
        loaded,
      })),
      fetchedAt: payload.fetchedAt,
    };
  });

export const listDealScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("property_deal_scenarios")
      .select("id, label, property_address, parcel_id, inputs, results, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  });

export const saveDealScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const id =
      typeof value["id"] === "string" && UUID_PATTERN.test(value["id"]) ? value["id"] : null;
    const label = optionalText(value["label"], 160);
    if (!label) throw new Error("Give this scenario a name.");
    return {
      id,
      label,
      propertyAddress: optionalText(value["propertyAddress"], 240),
      parcelId: optionalText(value["parcelId"], 64),
      recordId: optionalText(value["recordId"], 128),
      inputs: value["inputs"],
    };
  })
  .handler(async ({ data, context }) => {
    const { calculateDeal, normalizeDealInputs, DEAL_CALCULATION_VERSION } =
      await import("@/lib/property-intelligence/deal-analysis");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Clients send inputs only; results are recomputed here so a saved grade can't be forged.
    const inputs = normalizeDealInputs(data.inputs);
    const results = calculateDeal(inputs);
    const row = {
      label: data.label,
      property_address: data.propertyAddress,
      parcel_id: data.parcelId,
      record_id: data.recordId,
      calculation_version: DEAL_CALCULATION_VERSION,
      inputs: JSON.parse(JSON.stringify(inputs)),
      results: JSON.parse(JSON.stringify(results)),
      updated_at: new Date().toISOString(),
    };
    const query = data.id
      ? supabaseAdmin
          .from("property_deal_scenarios")
          .update(row)
          .eq("id", data.id)
          .eq("user_id", context.userId)
      : supabaseAdmin.from("property_deal_scenarios").insert({ ...row, user_id: context.userId });
    const { data: saved, error } = await query.select("id, updated_at").maybeSingle();
    if (error?.message?.includes("property_deal_scenario_quota_exceeded")) {
      throw new Error("You have reached 100 saved scenarios. Delete one to save another.");
    }
    if (error) throw error;
    if (!saved) throw new Error("That scenario no longer exists.");
    return { id: saved.id, updatedAt: saved.updated_at, results };
  });

export const deleteDealScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (typeof input?.id !== "string" || !UUID_PATTERN.test(input.id)) {
      throw new Error("A scenario id is required.");
    }
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("property_deal_scenarios")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { deleted: true };
  });
