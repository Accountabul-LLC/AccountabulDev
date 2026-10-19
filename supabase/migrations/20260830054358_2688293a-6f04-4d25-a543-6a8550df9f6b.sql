-- Phase A: zero-leak lockdown
-- 1) Anon: read-only on public content, insert-only on lead forms, nothing else.
-- 2) Authenticated: no direct writes to finance/ops tables (service-role only).
-- 3) Guest inquiry inserts (from_user_id must be NULL).
-- 4) Business approval gate: only admins can publish/suspend/verify.
-- 5) Events: hosts manage own events; non-hosts never see canceled events.
-- 6) Listings: any active org member can manage services/properties.
-- 7) SECURITY DEFINER function EXECUTE lockdown.

-- 1) Anon grants -----------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.businesses TO anon;
GRANT SELECT ON public.services TO anon;
GRANT SELECT ON public.properties TO anon;
GRANT SELECT ON public.property_media TO anon;
GRANT SELECT ON public.events TO anon;
GRANT SELECT ON public.chat_messages TO anon;
GRANT SELECT ON public.community_standards_versions TO anon;
GRANT INSERT ON public.property_inquiries TO anon;
GRANT INSERT ON public.service_inquiries TO anon;

-- 2) Authenticated may not write finance/ops tables directly ---------------
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_customers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.membership_subscriptions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_records FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tips FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.event_passes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.paid_comments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.speaker_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_health FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.community_standards_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.migration_batches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.migration_record_map FROM authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.payment_events TO authenticated;
GRANT SELECT ON public.provider_health TO authenticated;
GRANT SELECT ON public.community_standards_versions TO authenticated;
GRANT SELECT ON public.migration_batches TO authenticated;
GRANT SELECT ON public.migration_record_map TO authenticated;

-- 3) Guest inquiry inserts -------------------------------------------------
CREATE POLICY property_inquiries_guest_insert
ON public.property_inquiries
FOR INSERT TO anon
WITH CHECK (
  from_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = property_inquiries.property_id
      AND p.business_id = property_inquiries.business_id
      AND p.status = 'published'::property_status
  )
);

CREATE POLICY service_inquiries_guest_insert
ON public.service_inquiries
FOR INSERT TO anon
WITH CHECK (
  from_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.id = service_inquiries.service_id
      AND s.business_id = service_inquiries.business_id
      AND s.status = 'published'::service_status
  )
);

-- 4) Business approval gate ------------------------------------------------
-- Members may edit their own org and request review, but only Accountabul
-- staff (admin role) can publish, suspend, archive, reject, or verify.
CREATE OR REPLACE FUNCTION public.enforce_business_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  -- service_role (auth.uid() is null) is unrestricted; browser users are not
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    if new.profile_status is distinct from old.profile_status
       and new.profile_status in ('published', 'suspended', 'archived', 'rejected') then
      raise exception 'Only Accountabul staff can change approval status.';
    end if;
    if new.verification_status is distinct from old.verification_status
       and new.verification_status in ('verified', 'in_review', 'rejected', 'expired') then
      raise exception 'Only Accountabul staff can change verification status.';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'Business ownership record cannot be changed.';
    end if;
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS businesses_enforce_approval ON public.businesses;
CREATE TRIGGER businesses_enforce_approval
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.enforce_business_approval();

-- 5) Events: tighten reads, let host orgs manage their own -----------------
DROP POLICY events_auth_read ON public.events;
CREATE POLICY events_auth_read
ON public.events
FOR SELECT TO authenticated
USING (
  status <> 'canceled'::event_status
  OR (host_business_id IS NOT NULL AND public.is_business_member(host_business_id, auth.uid()))
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'moderator')
);

CREATE POLICY events_host_write
ON public.events
FOR ALL TO authenticated
USING (
  host_business_id IS NOT NULL
  AND public.can_manage_business(host_business_id, auth.uid())
)
WITH CHECK (
  host_business_id IS NOT NULL
  AND public.can_manage_business(host_business_id, auth.uid())
);

-- 6) Listings: any active org member can manage ----------------------------
DROP POLICY services_write ON public.services;
CREATE POLICY services_write
ON public.services
FOR ALL TO authenticated
USING (public.is_business_member(business_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.is_business_member(business_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

DROP POLICY properties_insert ON public.properties;
DROP POLICY properties_update ON public.properties;
CREATE POLICY properties_insert
ON public.properties
FOR INSERT TO authenticated
WITH CHECK (public.is_business_member(business_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY properties_update
ON public.properties
FOR UPDATE TO authenticated
USING (public.is_business_member(business_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.is_business_member(business_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'));

-- 7) Function EXECUTE lockdown ----------------------------------------------
-- Trigger functions: no direct calls needed.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_business_approval() FROM PUBLIC, anon, authenticated;

-- Provider-connection helpers: service role only (re-asserted, idempotent).
REVOKE EXECUTE ON FUNCTION public.private_create_provider_oauth_state(text, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_consume_provider_oauth_state(text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_get_provider_connection(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.private_upsert_provider_connection(text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_create_provider_oauth_state(text, text, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_consume_provider_oauth_state(text, text, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_get_provider_connection(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.private_upsert_provider_connection(text, text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text[]) TO service_role;

-- RLS helper functions stay callable by authenticated/anon: policies rely on
-- them (has_role, is_business_member, can_manage_business, is_business_owner,
-- is_chat_banned, can_view_event_presence, has_active_membership, has_event_pass).