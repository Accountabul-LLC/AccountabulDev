CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_slug text,
  p_legal_name text,
  p_display_name text,
  p_handle text DEFAULT NULL,
  p_headline text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_primary_industry text DEFAULT NULL,
  p_year_founded integer DEFAULT NULL,
  p_employee_count_range text DEFAULT NULL,
  p_public_email text DEFAULT NULL,
  p_public_phone text DEFAULT NULL,
  p_website_url text DEFAULT NULL,
  p_address_city text DEFAULT NULL,
  p_address_state text DEFAULT NULL,
  p_address_country text DEFAULT NULL,
  p_service_areas text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_business_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create a business.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_slug), '') IS NULL OR NULLIF(btrim(p_legal_name), '') IS NULL OR NULLIF(btrim(p_display_name), '') IS NULL THEN
    RAISE EXCEPTION 'Business slug, legal name, and display name are required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.businesses (
    slug, legal_name, display_name, handle, headline, description,
    primary_industry, year_founded, employee_count_range, public_email,
    public_phone, website_url, address_city, address_state, address_country,
    service_areas, created_by
  ) VALUES (
    btrim(p_slug), btrim(p_legal_name), btrim(p_display_name), NULLIF(btrim(p_handle), ''),
    NULLIF(btrim(p_headline), ''), NULLIF(btrim(p_description), ''),
    NULLIF(btrim(p_primary_industry), ''), p_year_founded,
    NULLIF(btrim(p_employee_count_range), ''), NULLIF(btrim(p_public_email), ''),
    NULLIF(btrim(p_public_phone), ''), NULLIF(btrim(p_website_url), ''),
    NULLIF(btrim(p_address_city), ''), NULLIF(btrim(p_address_state), ''),
    NULLIF(btrim(p_address_country), ''), COALESCE(p_service_areas, '{}'), v_user_id
  )
  RETURNING id INTO v_business_id;

  INSERT INTO public.business_members (
    business_id, user_id, membership_role, invitation_status, joined_at
  ) VALUES (
    v_business_id, v_user_id, 'owner', 'active', now()
  );

  RETURN v_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text[]) TO authenticated;

REVOKE INSERT ON public.businesses FROM authenticated;