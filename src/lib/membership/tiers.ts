import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type BillingInterval = "monthly" | "annual";
export type TierAudience = "individual" | "business" | "both";

export type MembershipTier = {
  id: string;
  slug: string;
  name: string;
  audience: TierAudience;
  price_monthly_minor: number;
  price_annual_minor: number | null;
  currency: string;
  description: string | null;
  features: string[];
  business_features: string[];
  highlight_feature: string | null;
  cta_label: string;
  is_popular: boolean;
  grants_vendor_verification: boolean;
  sort_order: number;
};

const TIER_SELECT =
  "id, slug, name, audience, price_monthly_minor, price_annual_minor, currency, description, features, business_features, highlight_feature, cta_label, is_popular, grants_vendor_verification, sort_order";

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function useMembershipTiers() {
  return useQuery({
    queryKey: ["membership-tiers"],
    staleTime: 60_000,
    queryFn: async (): Promise<MembershipTier[]> => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select(TIER_SELECT)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        audience: row.audience as TierAudience,
        price_monthly_minor: Number(row.price_monthly_minor),
        price_annual_minor: row.price_annual_minor === null ? null : Number(row.price_annual_minor),
        features: toStringArray(row.features),
        business_features: toStringArray(row.business_features),
      }));
    },
  });
}

export function tierPriceMinor(tier: MembershipTier, interval: BillingInterval) {
  return interval === "annual"
    ? (tier.price_annual_minor ?? tier.price_monthly_minor * 12)
    : tier.price_monthly_minor;
}
