DROP POLICY IF EXISTS businesses_authenticated_read ON public.businesses;
CREATE POLICY businesses_authenticated_read
ON public.businesses
FOR SELECT TO authenticated
USING (
  created_by = auth.uid()
  OR (profile_status = 'published'::public.profile_status AND public_profile_enabled = true)
  OR public.is_business_member(id, auth.uid())
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'moderator'::public.app_role)
);