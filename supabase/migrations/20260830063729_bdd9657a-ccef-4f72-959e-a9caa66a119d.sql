DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text, text, text, integer, text, text, text, text, text, text, text, text[]);

CREATE OR REPLACE FUNCTION public.create_initial_business_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'A business owner is required.' USING ERRCODE = '23502';
  END IF;

  INSERT INTO public.business_members (
    business_id, user_id, membership_role, invitation_status, joined_at
  ) VALUES (
    NEW.id, NEW.created_by, 'owner', 'active', now()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_initial_business_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_initial_business_owner() FROM anon;
REVOKE ALL ON FUNCTION public.create_initial_business_owner() FROM authenticated;

DROP TRIGGER IF EXISTS businesses_create_initial_owner ON public.businesses;
CREATE TRIGGER businesses_create_initial_owner
AFTER INSERT ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.create_initial_business_owner();

GRANT INSERT ON public.businesses TO authenticated;