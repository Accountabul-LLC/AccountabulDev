import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { PublicBusiness } from "@/lib/business.functions";

export type Business = NonNullable<PublicBusiness>;

export function businessLocation(business: Business) {
  return [business.address_city, business.address_state, business.address_country]
    .filter(Boolean)
    .join(", ");
}

export function externalHref(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

const SERVICE_COLUMNS =
  "id, slug, name, summary, description, category, price_minor, currency, price_note, service_areas, image_path";

export function useBusinessServices(businessId: string) {
  return useQuery({
    queryKey: ["business-services", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .eq("business_id", businessId)
        .eq("status", "published")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBusinessService(businessId: string, serviceSlug: string) {
  return useQuery({
    queryKey: ["business-service", businessId, serviceSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select(SERVICE_COLUMNS)
        .eq("business_id", businessId)
        .eq("slug", serviceSlug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useBusinessProperties(businessId: string) {
  return useQuery({
    queryKey: ["business-listings", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, slug, title, address_city, address_state, price_minor, currency, cover_path, bedrooms, bathrooms, area_sqft",
        )
        .eq("business_id", businessId)
        .eq("status", "published")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBusinessPolicies(businessId: string) {
  return useQuery({
    queryKey: ["business-policies-public", businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_policies")
        .select("id, slug, title, policy_type, updated_at")
        .eq("business_id", businessId)
        .eq("is_published", true)
        .order("sort_order")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBusinessPolicy(businessId: string, policySlug: string) {
  return useQuery({
    queryKey: ["business-policy-public", businessId, policySlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_policies")
        .select("id, slug, title, policy_type, content, updated_at")
        .eq("business_id", businessId)
        .eq("slug", policySlug)
        .eq("is_published", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export const POLICY_TYPES = [
  "Terms of Service",
  "Privacy Policy",
  "Refund Policy",
  "Cancellation Policy",
  "Service Policy",
  "Return Policy",
  "Shipping Policy",
  "Warranty Policy",
  "Payment Policy",
  "Appointment Policy",
  "Custom",
] as const;
