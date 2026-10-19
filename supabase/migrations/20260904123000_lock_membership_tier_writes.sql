REVOKE ALL ON TABLE public.membership_tiers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.membership_tiers TO anon, authenticated;
GRANT ALL ON TABLE public.membership_tiers TO service_role;

DROP POLICY IF EXISTS "Admins can insert membership tiers" ON public.membership_tiers;
DROP POLICY IF EXISTS "Admins can update membership tiers" ON public.membership_tiers;
DROP POLICY IF EXISTS "Admins can delete membership tiers" ON public.membership_tiers;
