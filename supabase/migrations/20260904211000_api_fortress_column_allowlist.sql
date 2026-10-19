-- Table-level UPDATE/INSERT still covered every column after a column REVOKE.
-- Rebuild authenticated DML as an allowlist. Defaults keep new rows draft/unverified.

revoke delete on public.businesses from authenticated;

revoke update on public.businesses from authenticated;
grant update (
  legal_name,
  display_name,
  handle,
  headline,
  description,
  logo_path,
  cover_path,
  website_url,
  public_email,
  public_phone,
  year_founded,
  employee_count_range,
  primary_industry,
  address_city,
  address_state,
  address_country,
  service_areas,
  profile_status,
  verification_status,
  entity_type,
  formation_state,
  updated_at
) on public.businesses to authenticated;

revoke insert on public.businesses from authenticated;
grant insert (
  slug,
  legal_name,
  display_name,
  handle,
  headline,
  description,
  logo_path,
  cover_path,
  website_url,
  public_email,
  public_phone,
  year_founded,
  employee_count_range,
  primary_industry,
  address_city,
  address_state,
  address_country,
  service_areas,
  created_by,
  entity_type,
  formation_state
) on public.businesses to authenticated;

revoke select on public.payment_events from authenticated;
