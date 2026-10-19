CREATE TABLE public.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  audience text NOT NULL DEFAULT 'both' CHECK (audience IN ('individual','business','both')),
  price_monthly_minor bigint NOT NULL,
  price_annual_minor bigint,
  currency text NOT NULL DEFAULT 'USD',
  stripe_price_id_monthly text,
  stripe_price_id_annual text,
  description text,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  highlight_feature text,
  cta_label text NOT NULL DEFAULT 'Get started',
  is_popular boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  grants_vendor_verification boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.membership_tiers TO anon;
GRANT SELECT ON public.membership_tiers TO authenticated;
GRANT ALL ON public.membership_tiers TO service_role;

ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active membership tiers"
  ON public.membership_tiers FOR SELECT
  TO anon, authenticated
  USING (is_active);

CREATE POLICY "Admins can read all membership tiers"
  ON public.membership_tiers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert membership tiers"
  ON public.membership_tiers FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update membership tiers"
  ON public.membership_tiers FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete membership tiers"
  ON public.membership_tiers FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER membership_tiers_set_updated_at
  BEFORE UPDATE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.membership_tiers (
  slug, name, audience, price_monthly_minor, price_annual_minor, description,
  features, business_features, highlight_feature, is_popular,
  grants_vendor_verification, sort_order
) VALUES
(
  'starter', 'Starter', 'both', 1600, 16000,
  'For members who want in the room: live conferences, replays, and free chat participation.',
  '["Watch every live conference room","Replay access","Free chat participation","Save properties and follow businesses","Direct contact with verified vendors"]'::jsonb,
  '["Public business page on your own slug","Directory listing","Up to 3 service listings","Lead inbox","Verified vendor review"]'::jsonb,
  'Live access included', false, true, 1
),
(
  'professional', 'Professional', 'both', 4900, 49000,
  'For active investors and growing vendors who need reach, listings, and priority support.',
  '["Everything in Starter","Priority room access","Early replay access","Speaker request eligibility","Priority support"]'::jsonb,
  '["Everything in Starter","Unlimited service listings","Up to 10 property listings","Featured placement in the directory","Verified vendor badge","Priority support"]'::jsonb,
  'Best value for growing businesses', true, true, 2
),
(
  'portfolio', 'Portfolio', 'both', 9900, 99000,
  'For portfolio managers and multi-location vendors operating at scale.',
  '["Everything in Professional","Unlimited replays and archives","Priority speaker consideration","Dedicated support channel"]'::jsonb,
  '["Everything in Professional","Unlimited property listings","Multi-seat team access","Top-of-directory placement","Verified vendor badge","Dedicated support channel"]'::jsonb,
  'Built for scale', false, true, 3
);

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS formation_state text,
  ADD COLUMN IF NOT EXISTS tax_id_last4 text,
  ADD COLUMN IF NOT EXISTS verification_reference text,
  ADD COLUMN IF NOT EXISTS verification_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_failure_reason text;

ALTER TABLE public.events
  ALTER COLUMN access_mode SET DEFAULT 'subscriber_or_pass'::public.event_access_mode;

UPDATE public.events
SET access_mode = 'subscriber_or_pass'::public.event_access_mode
WHERE access_mode = 'public'::public.event_access_mode;