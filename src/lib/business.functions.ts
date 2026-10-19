import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

const PUBLIC_BUSINESS_COLUMNS =
  "id, slug, display_name, handle, logo_path, cover_path, headline, description, website_url, public_email, public_phone, primary_industry, address_city, address_state, address_country, verification_status, year_founded, employee_count_range, service_areas";

/** Public, unauthenticated read of a published business profile (anon RLS applies). */
export const getPublicBusiness = createServerFn({ method: "GET" })
  .validator((data: unknown) => z.object({ slug: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const supabase = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { data: business, error } = await supabase
      .from("businesses")
      .select(PUBLIC_BUSINESS_COLUMNS)
      .eq("slug", data.slug)
      .eq("profile_status", "published")
      .eq("verification_status", "verified")
      .eq("public_profile_enabled", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return business;
  });

export type PublicBusiness = Awaited<ReturnType<typeof getPublicBusiness>>;
