REVOKE INSERT (
  stripe_price_id,
  stripe_product_id,
  pass_price_minor,
  pass_currency
) ON public.events FROM PUBLIC, anon, authenticated;

REVOKE UPDATE (
  stripe_price_id,
  stripe_product_id,
  pass_price_minor,
  pass_currency
) ON public.events FROM PUBLIC, anon, authenticated;
