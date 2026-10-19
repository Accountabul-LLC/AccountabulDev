import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

/** The first active business the signed-in user belongs to, with their membership role. */
export function useMyBusiness() {
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ["my-business-membership", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data: memberships, error: membershipError } =
        await supabase.rpc("get_my_memberships");
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) return null;

      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select(
          "id, slug, display_name, profile_status, verification_status, public_profile_enabled, published_at",
        )
        .eq("id", membership.business_id)
        .single();
      if (businessError) throw businessError;

      return {
        membership_role: membership.membership_role,
        business_id: membership.business_id,
        businesses: business,
      };
    },
  });
}
