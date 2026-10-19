INSERT INTO public.membership_tiers (
  slug, name, audience, price_monthly_minor, price_annual_minor, description,
  features, business_features, highlight_feature, cta_label, is_popular,
  grants_vendor_verification, sort_order
) VALUES (
  'business-hosting',
  'Business Hosting',
  'business',
  1000,
  NULL,
  'Host your public Accountabul business page, services, listings, and lead inbox.',
  '[]'::jsonb,
  '["Public business page on your own slug","Directory listing","Service listings","Property listings you own","Lead inbox","Policies on your page","Verified vendor review"]'::jsonb,
  'Host your page',
  'Host your page',
  false,
  true,
  0
)
ON CONFLICT (slug) DO UPDATE SET
  name = excluded.name,
  audience = excluded.audience,
  price_monthly_minor = excluded.price_monthly_minor,
  price_annual_minor = excluded.price_annual_minor,
  description = excluded.description,
  features = excluded.features,
  business_features = excluded.business_features,
  highlight_feature = excluded.highlight_feature,
  cta_label = excluded.cta_label,
  grants_vendor_verification = excluded.grants_vendor_verification,
  sort_order = excluded.sort_order;

UPDATE public.membership_tiers
SET
  audience = 'individual',
  business_features = '[]'::jsonb,
  grants_vendor_verification = false,
  description = 'For members who want in the room: live conferences, replays, and free chat participation.'
WHERE slug = 'starter';
