-- Phase B: RPC-only access for internal data. Definer functions below enforce the same
-- membership/admin guards as the previous RLS policies; direct table privileges are then revoked.

-- 1. My active memberships (replaces direct business_members self-read).
CREATE OR REPLACE FUNCTION public.get_my_memberships()
RETURNS TABLE(business_id uuid, membership_role membership_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select m.business_id, m.membership_role
  from public.business_members m
  where m.user_id = auth.uid()
    and m.invitation_status = 'active';
$$;

-- 2. Team roster for a business you belong to (or staff).
CREATE OR REPLACE FUNCTION public.list_business_members(p_business_id uuid)
RETURNS SETOF public.business_members
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select m.*
  from public.business_members m
  where m.business_id = p_business_id
    and (
      public.is_business_member(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  order by m.created_at asc;
$$;

-- 3/4. Inquiries addressed to a business you belong to (or staff).
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
      public.is_business_member(p_business_id, auth.uid())
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
      public.is_business_member(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  order by i.created_at desc;
$$;

-- 5. Status-only inquiry update, scoped to managers/owners of the owning business (or staff).
CREATE OR REPLACE FUNCTION public.update_inquiry_status(
  p_table text,
  p_id uuid,
  p_status inquiry_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  if p_table = 'property_inquiries' then
    select business_id into v_business_id from public.property_inquiries where id = p_id;
  elsif p_table = 'service_inquiries' then
    select business_id into v_business_id from public.service_inquiries where id = p_id;
  else
    raise exception 'invalid inquiry table';
  end if;

  if v_business_id is null then
    raise exception 'inquiry not found';
  end if;

  if not (
    public.can_manage_business(v_business_id, auth.uid())
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'moderator')
  ) then
    raise exception 'not authorized to update this inquiry';
  end if;

  if p_table = 'property_inquiries' then
    update public.property_inquiries set status = p_status where id = p_id;
  else
    update public.service_inquiries set status = p_status where id = p_id;
  end if;
END;
$$;

-- 6/7. Verification credentials: read and submit, owners/managers (or staff) only.
CREATE OR REPLACE FUNCTION public.list_business_credentials(p_business_id uuid)
RETURNS SETOF public.business_credentials
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select c.*
  from public.business_credentials c
  where c.business_id = p_business_id
    and (
      public.can_manage_business(p_business_id, auth.uid())
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  order by c.created_at desc;
$$;

CREATE OR REPLACE FUNCTION public.submit_business_credential(
  p_business_id uuid,
  p_credential_type text,
  p_issuing_authority text DEFAULT NULL,
  p_identifier text DEFAULT NULL,
  p_expires_at date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  if not (
    public.can_manage_business(p_business_id, auth.uid())
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'not authorized to submit credentials for this business';
  end if;

  if p_credential_type is null or btrim(p_credential_type) = '' then
    raise exception 'credential type is required';
  end if;

  insert into public.business_credentials (
    business_id, credential_type, issuing_authority, identifier, expires_at, submitted_by
  ) values (
    p_business_id, btrim(p_credential_type), nullif(btrim(coalesce(p_issuing_authority, '')), ''),
    nullif(btrim(coalesce(p_identifier, '')), ''), p_expires_at, auth.uid()
  )
  returning id into v_id;

  return v_id;
END;
$$;

-- Execute privileges: signed-in users only, never anon/public.
REVOKE ALL ON FUNCTION public.get_my_memberships() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_business_members(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_property_inquiries(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_service_inquiries(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_inquiry_status(text, uuid, inquiry_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_business_credentials(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_business_credential(uuid, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_memberships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_business_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_property_inquiries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_service_inquiries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inquiry_status(text, uuid, inquiry_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_business_credentials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_business_credential(uuid, text, text, text, date) TO authenticated;

-- Revoke direct table access for signed-in users on internal data.
-- Inquiries: keep INSERT (the public lead path) only.
REVOKE SELECT, UPDATE, DELETE ON public.property_inquiries FROM authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.service_inquiries FROM authenticated;
-- Memberships: keep INSERT (owner bootstrap during onboarding) only.
REVOKE SELECT, UPDATE, DELETE ON public.business_members FROM authenticated;
-- Credentials: fully RPC-mediated now.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.business_credentials FROM authenticated;
-- Billing/finance: no direct reads at all (webhook/service-role writes; app reads via server functions).
REVOKE ALL PRIVILEGES ON public.billing_customers FROM authenticated;
REVOKE ALL PRIVILEGES ON public.membership_subscriptions FROM authenticated;
REVOKE ALL PRIVILEGES ON public.payment_records FROM authenticated;