-- Table-level INSERT still covered status after a column REVOKE. Allowlist only guest fields.

revoke insert on public.property_inquiries from anon, authenticated;
grant insert (
  property_id,
  business_id,
  from_user_id,
  contact_name,
  contact_email,
  contact_phone,
  message
) on public.property_inquiries to anon, authenticated;

revoke insert on public.service_inquiries from anon, authenticated;
grant insert (
  service_id,
  business_id,
  from_user_id,
  contact_name,
  contact_email,
  contact_phone,
  message
) on public.service_inquiries to anon, authenticated;
