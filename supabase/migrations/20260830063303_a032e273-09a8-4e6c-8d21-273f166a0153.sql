-- Narrow anon SELECT to public-safe columns only (anon previously had full-table SELECT)

REVOKE SELECT ON public.events FROM anon;
GRANT SELECT (
  id, slug, title, description, host_business_id,
  scheduled_start_at, actual_start_at, ended_at, status,
  chat_enabled, tips_enabled, cover_path, created_at, updated_at,
  access_mode, pass_price_minor, pass_currency,
  speaker_requests_enabled, replay_available_at
) ON public.events TO anon;

REVOKE SELECT ON public.chat_messages FROM anon;
GRANT SELECT (
  id, event_id, user_id, body, kind, is_hidden, created_at,
  source, external_id, author_display_name, author_avatar_url,
  author_badge, source_created_at, published_at
) ON public.chat_messages TO anon;

REVOKE SELECT ON public.businesses FROM anon;
GRANT SELECT (
  id, slug, display_name, handle, headline, description,
  logo_path, cover_path, website_url, public_email, public_phone,
  year_founded, employee_count_range, primary_industry,
  address_city, address_state, address_country, service_areas,
  profile_status, verification_status, public_profile_enabled,
  created_at, updated_at, published_at
) ON public.businesses TO anon;

REVOKE SELECT ON public.properties FROM anon;
GRANT SELECT (
  id, business_id, slug, title, description, property_type,
  address_line1, address_city, address_state, address_country, postal_code,
  latitude, longitude, bedrooms, bathrooms, area_sqft,
  price_minor, currency, cover_path, status,
  created_at, updated_at, published_at
) ON public.properties TO anon;

REVOKE SELECT ON public.services FROM anon;
GRANT SELECT (
  id, business_id, slug, name, summary, description, category,
  price_minor, currency, price_note, service_areas, status,
  created_at, updated_at, published_at
) ON public.services TO anon;
