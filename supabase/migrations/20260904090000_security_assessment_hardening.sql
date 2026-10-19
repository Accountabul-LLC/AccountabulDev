-- Tighten Data API grants and inquiry RPC authority after ACC-20260904.

REVOKE SELECT ON public.events FROM authenticated;
GRANT SELECT (
  id, slug, title, description, host_business_id,
  scheduled_start_at, actual_start_at, ended_at, status,
  chat_enabled, tips_enabled, cover_path, created_at, updated_at,
  access_mode, pass_price_minor, pass_currency,
  speaker_requests_enabled, replay_available_at
) ON public.events TO authenticated;

REVOKE SELECT ON public.businesses FROM authenticated;
GRANT SELECT (
  id, slug, display_name, handle, headline, description,
  logo_path, cover_path, website_url, public_email, public_phone,
  year_founded, employee_count_range, primary_industry,
  address_city, address_state, address_country, service_areas,
  profile_status, verification_status, public_profile_enabled,
  created_at, updated_at, published_at, created_by
) ON public.businesses TO authenticated;

DROP POLICY IF EXISTS property_inquiries_guest_insert ON public.property_inquiries;
DROP POLICY IF EXISTS service_inquiries_guest_insert ON public.service_inquiries;

CREATE OR REPLACE FUNCTION public.list_property_inquiries(p_business_id uuid)
RETURNS SETOF public.property_inquiries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select i.*
  from public.property_inquiries i
  where i.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  order by i.created_at desc;
$$;

CREATE OR REPLACE FUNCTION public.list_service_inquiries(p_business_id uuid)
RETURNS SETOF public.service_inquiries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select i.*
  from public.service_inquiries i
  where i.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  order by i.created_at desc;
$$;

CREATE OR REPLACE FUNCTION public.get_my_business_profile(p_business_id uuid)
RETURNS SETOF public.businesses
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select b.*
  from public.businesses b
  where b.id = p_business_id
    and (
      public.is_business_member(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    );
$$;

REVOKE ALL ON FUNCTION public.get_my_business_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_business_profile(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.review_business(uuid, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_business(uuid, text, text, text)
  TO service_role;
