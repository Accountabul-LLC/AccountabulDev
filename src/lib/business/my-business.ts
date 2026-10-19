import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export async function fetchMyBusinessProfile(
  supabase: SupabaseClient<Database>,
  businessId: string,
) {
  const { data, error } = await supabase.rpc("get_my_business_profile", {
    p_business_id: businessId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}
