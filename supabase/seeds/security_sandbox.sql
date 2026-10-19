-- Synthetic security-sandbox seed. All emails use @accountabul.test.
-- No production or customer data. Idempotent on the fixed UUIDs below.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The shared sandbox password is never committed. Supply it per session before
-- running this seed, for example:
--   PGOPTIONS="-c sandbox.password=$SANDBOX_PASSWORD" psql "$TEST_DATABASE_URL" -f supabase/seeds/security_sandbox.sql
-- Never run this seed against a production project.
DO $$
BEGIN
  IF coalesce(current_setting('sandbox.password', true), '') = '' THEN
    RAISE EXCEPTION 'Set sandbox.password (e.g. PGOPTIONS="-c sandbox.password=...") before running this seed.';
  END IF;
END $$;

-- Principals
-- admin      a0000001-0000-4000-8000-000000000001
-- moderator  a0000001-0000-4000-8000-000000000002
-- owner-a    a0000001-0000-4000-8000-000000000003
-- manager-a  a0000001-0000-4000-8000-000000000004
-- viewer-a   a0000001-0000-4000-8000-000000000005
-- listing-a  a0000001-0000-4000-8000-000000000006
-- owner-b    a0000001-0000-4000-8000-000000000007
-- member-c   a0000001-0000-4000-8000-000000000008
-- banned     a0000001-0000-4000-8000-000000000009
-- revoked    a0000001-0000-4000-8000-00000000000a
-- subscriber a0000001-0000-4000-8000-00000000000b
-- past-due   a0000001-0000-4000-8000-00000000000c

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  x.id,
  'authenticated',
  'authenticated',
  x.email,
  crypt(current_setting('sandbox.password'), gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  x.meta,
  now(),
  now(),
  '',
  '',
  '',
  ''
FROM (
  VALUES
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'sandbox-admin@accountabul.test', '{"display_name":"Sandbox Admin","first_name":"Sage","last_name":"Admin","account_type":"individual"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000002'::uuid, 'sandbox-moderator@accountabul.test', '{"display_name":"Sandbox Moderator","first_name":"Morgan","last_name":"Mod","account_type":"individual"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000003'::uuid, 'sandbox-owner-a@accountabul.test', '{"display_name":"Owner A","first_name":"Ava","last_name":"Owner","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000004'::uuid, 'sandbox-manager-a@accountabul.test', '{"display_name":"Manager A","first_name":"Miles","last_name":"Manager","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000005'::uuid, 'sandbox-viewer-a@accountabul.test', '{"display_name":"Viewer A","first_name":"Vera","last_name":"Viewer","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000006'::uuid, 'sandbox-listing-a@accountabul.test', '{"display_name":"Listing A","first_name":"Lana","last_name":"Listings","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000007'::uuid, 'sandbox-owner-b@accountabul.test', '{"display_name":"Owner B","first_name":"Ben","last_name":"Owner","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000008'::uuid, 'sandbox-member-c@accountabul.test', '{"display_name":"Member C","first_name":"Cara","last_name":"Member","account_type":"individual"}'::jsonb),
    ('a0000001-0000-4000-8000-000000000009'::uuid, 'sandbox-banned@accountabul.test', '{"display_name":"Banned User","first_name":"Blake","last_name":"Banned","account_type":"individual"}'::jsonb),
    ('a0000001-0000-4000-8000-00000000000a'::uuid, 'sandbox-revoked@accountabul.test', '{"display_name":"Revoked Staff","first_name":"Riley","last_name":"Revoked","account_type":"business"}'::jsonb),
    ('a0000001-0000-4000-8000-00000000000b'::uuid, 'sandbox-subscriber@accountabul.test', '{"display_name":"Paid Subscriber","first_name":"Sam","last_name":"Subscriber","account_type":"individual"}'::jsonb),
    ('a0000001-0000-4000-8000-00000000000c'::uuid, 'sandbox-pastdue@accountabul.test', '{"display_name":"Past Due","first_name":"Pat","last_name":"Overdue","account_type":"individual"}'::jsonb)
) AS x(id, email, meta)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(),
  now(),
  now()
FROM auth.users u
WHERE u.id IN (
  'a0000001-0000-4000-8000-000000000001',
  'a0000001-0000-4000-8000-000000000002',
  'a0000001-0000-4000-8000-000000000003',
  'a0000001-0000-4000-8000-000000000004',
  'a0000001-0000-4000-8000-000000000005',
  'a0000001-0000-4000-8000-000000000006',
  'a0000001-0000-4000-8000-000000000007',
  'a0000001-0000-4000-8000-000000000008',
  'a0000001-0000-4000-8000-000000000009',
  'a0000001-0000-4000-8000-00000000000a',
  'a0000001-0000-4000-8000-00000000000b',
  'a0000001-0000-4000-8000-00000000000c'
)
ON CONFLICT (provider_id, provider) DO NOTHING;

UPDATE public.profiles p SET
  first_name = x.first_name,
  last_name = x.last_name,
  display_name = x.display_name,
  handle = x.handle,
  phone = x.phone,
  city = x.city,
  state = x.state,
  country = 'US',
  account_type = x.account_type,
  onboarding_status = x.onboarding_status,
  email_display = x.email
FROM (
  VALUES
    ('a0000001-0000-4000-8000-000000000001'::uuid, 'Sage', 'Admin', 'Sandbox Admin', 'sandbox-admin', '555-0101', 'Austin', 'TX', 'individual'::account_type, 'complete'::onboarding_status, 'sandbox-admin@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000002'::uuid, 'Morgan', 'Mod', 'Sandbox Moderator', 'sandbox-mod', '555-0102', 'Denver', 'CO', 'individual'::account_type, 'complete'::onboarding_status, 'sandbox-moderator@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000003'::uuid, 'Ava', 'Owner', 'Owner A', 'owner-a', '555-0103', 'Dallas', 'TX', 'business'::account_type, 'complete'::onboarding_status, 'sandbox-owner-a@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000004'::uuid, 'Miles', 'Manager', 'Manager A', 'manager-a', '555-0104', 'Dallas', 'TX', 'business'::account_type, 'complete'::onboarding_status, 'sandbox-manager-a@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000005'::uuid, 'Vera', 'Viewer', 'Viewer A', 'viewer-a', '555-0105', 'Fort Worth', 'TX', 'business'::account_type, 'profile_complete'::onboarding_status, 'sandbox-viewer-a@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000006'::uuid, 'Lana', 'Listings', 'Listing A', 'listing-a', '555-0106', 'Houston', 'TX', 'business'::account_type, 'complete'::onboarding_status, 'sandbox-listing-a@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000007'::uuid, 'Ben', 'Owner', 'Owner B', 'owner-b', '555-0107', 'Chicago', 'IL', 'business'::account_type, 'complete'::onboarding_status, 'sandbox-owner-b@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000008'::uuid, 'Cara', 'Member', 'Member C', 'member-c', NULL, 'Seattle', 'WA', 'individual'::account_type, 'profile_complete'::onboarding_status, 'sandbox-member-c@accountabul.test'),
    ('a0000001-0000-4000-8000-000000000009'::uuid, 'Blake', 'Banned', 'Banned User', 'banned-user', '555-0109', 'Phoenix', 'AZ', 'individual'::account_type, 'new'::onboarding_status, 'sandbox-banned@accountabul.test'),
    ('a0000001-0000-4000-8000-00000000000a'::uuid, 'Riley', 'Revoked', 'Revoked Staff', 'revoked-staff', '555-0110', 'Dallas', 'TX', 'business'::account_type, 'business_started'::onboarding_status, 'sandbox-revoked@accountabul.test'),
    ('a0000001-0000-4000-8000-00000000000b'::uuid, 'Sam', 'Subscriber', 'Paid Subscriber', 'paid-sub', '555-0111', 'Atlanta', 'GA', 'individual'::account_type, 'complete'::onboarding_status, 'sandbox-subscriber@accountabul.test'),
    ('a0000001-0000-4000-8000-00000000000c'::uuid, 'Pat', 'Overdue', 'Past Due', 'past-due', '555-0112', 'Miami', 'FL', 'individual'::account_type, 'profile_complete'::onboarding_status, 'sandbox-pastdue@accountabul.test')
) AS x(id, first_name, last_name, display_name, handle, phone, city, state, account_type, onboarding_status, email)
WHERE p.id = x.id;

INSERT INTO public.user_roles (user_id, role, granted_by)
VALUES
  ('a0000001-0000-4000-8000-000000000001', 'admin', 'a0000001-0000-4000-8000-000000000001'),
  ('a0000001-0000-4000-8000-000000000002', 'moderator', 'a0000001-0000-4000-8000-000000000001'),
  ('a0000001-0000-4000-8000-000000000003', 'business_owner', 'a0000001-0000-4000-8000-000000000001'),
  ('a0000001-0000-4000-8000-000000000007', 'business_owner', 'a0000001-0000-4000-8000-000000000001'),
  ('a0000001-0000-4000-8000-000000000004', 'business_staff', 'a0000001-0000-4000-8000-000000000003'),
  ('a0000001-0000-4000-8000-000000000006', 'business_staff', 'a0000001-0000-4000-8000-000000000003')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.business_members (business_id, user_id, membership_role, invitation_status, invited_by, joined_at)
VALUES
  ('8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000003', 'owner', 'active', 'a0000001-0000-4000-8000-000000000001', now()),
  ('8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000004', 'manager', 'active', 'a0000001-0000-4000-8000-000000000003', now()),
  ('8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000005', 'viewer', 'active', 'a0000001-0000-4000-8000-000000000003', now()),
  ('8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000006', 'listing_manager', 'active', 'a0000001-0000-4000-8000-000000000003', now()),
  ('8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-00000000000a', 'lead_manager', 'revoked', 'a0000001-0000-4000-8000-000000000003', now() - interval '10 days'),
  ('e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'a0000001-0000-4000-8000-000000000007', 'owner', 'active', 'a0000001-0000-4000-8000-000000000001', now())
ON CONFLICT (business_id, user_id) DO NOTHING;

INSERT INTO public.businesses (
  id, slug, handle, legal_name, display_name, headline, description,
  public_email, public_phone, year_founded, primary_industry,
  address_city, address_state, address_country, service_areas,
  profile_status, verification_status, public_profile_enabled,
  created_by, published_at, tax_id_last4, entity_type, formation_state
)
VALUES
  (
    'a0000002-0000-4000-8000-000000000001',
    'sandbox-draft-holdings',
    'sandbox-draft',
    'Sandbox Draft Holdings LLC',
    'Sandbox Draft Holdings',
    'Unpublished draft vendor',
    'Draft profile that must stay off the public directory.',
    'draft@accountabul.test',
    '555-0201',
    2024,
    'holding',
    'Austin',
    'TX',
    'US',
    ARRAY['TX'],
    'draft',
    'unverified',
    false,
    'a0000001-0000-4000-8000-000000000003',
    NULL,
    '0001',
    'llc',
    'TX'
  ),
  (
    'a0000002-0000-4000-8000-000000000002',
    'sandbox-pending-review',
    'sandbox-pending',
    'Sandbox Pending Review LLC',
    'Sandbox Pending Review',
    'Awaiting staff approval',
    'Submitted for review and not yet public.',
    'pending@accountabul.test',
    '555-0202',
    2023,
    'services',
    'Chicago',
    'IL',
    'US',
    ARRAY['IL','WI'],
    'pending_review',
    'in_review',
    false,
    'a0000001-0000-4000-8000-000000000007',
    NULL,
    '0002',
    'llc',
    'IL'
  ),
  (
    'a0000002-0000-4000-8000-000000000003',
    'sandbox-suspended-co',
    'sandbox-suspended',
    'Sandbox Suspended Co LLC',
    'Sandbox Suspended Co',
    'Suspended vendor',
    'Should not appear in public search.',
    'suspended@accountabul.test',
    '555-0203',
    2021,
    'real-estate',
    'Miami',
    'FL',
    'US',
    ARRAY['FL'],
    'suspended',
    'rejected',
    false,
    'a0000001-0000-4000-8000-00000000000c',
    NULL,
    '0003',
    'corporation',
    'FL'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.properties (
  id, business_id, slug, title, description, property_type,
  address_line1, address_city, address_state, address_country, postal_code,
  bedrooms, bathrooms, area_sqft, price_minor, currency, status, created_by, published_at
)
VALUES
  ('a0000003-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'sandbox-published-duplex', 'Sandbox Published Duplex', 'Published listing for baseline reads.', 'duplex', '100 Sandbox Ave', 'Dallas', 'TX', 'US', '75201', 3, 2, 1400, 28500000, 'USD', 'published', 'a0000001-0000-4000-8000-000000000003', now()),
  ('a0000003-0000-4000-8000-000000000002', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'sandbox-draft-lot', 'Sandbox Draft Lot', 'Draft listing must stay private.', 'land', '200 Sandbox Ave', 'Dallas', 'TX', 'US', '75202', NULL, NULL, 8000, 9500000, 'USD', 'draft', 'a0000001-0000-4000-8000-000000000006', NULL),
  ('a0000003-0000-4000-8000-000000000003', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'sandbox-b-published-home', 'Sandbox B Published Home', 'Other-tenant published listing.', 'single_family', '10 Lake St', 'Chicago', 'IL', 'US', '60601', 4, 3, 2100, 41000000, 'USD', 'published', 'a0000001-0000-4000-8000-000000000007', now()),
  ('a0000003-0000-4000-8000-000000000004', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'sandbox-b-pending-home', 'Sandbox B Pending Home', 'Pending review, not public.', 'single_family', '11 Lake St', 'Chicago', 'IL', 'US', '60602', 2, 1, 900, 17500000, 'USD', 'pending_review', 'a0000001-0000-4000-8000-000000000007', NULL),
  ('a0000003-0000-4000-8000-000000000005', 'a0000002-0000-4000-8000-000000000003', 'sandbox-suspended-property', 'Sandbox Suspended Property', 'Belongs to a suspended vendor.', 'multifamily', '9 Pause Rd', 'Miami', 'FL', 'US', '33101', 8, 8, 6400, 120000000, 'USD', 'archived', 'a0000001-0000-4000-8000-00000000000c', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.property_media (id, property_id, storage_path, alt_text, sort_order)
VALUES
  ('a0000004-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0/properties/a0000003-0000-4000-8000-000000000001/cover.jpg', 'Sandbox duplex cover', 0),
  ('a0000004-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000002', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0/properties/a0000003-0000-4000-8000-000000000002/draft.jpg', 'Draft lot photo', 0),
  ('a0000004-0000-4000-8000-000000000003', 'a0000003-0000-4000-8000-000000000003', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca/properties/a0000003-0000-4000-8000-000000000003/cover.jpg', 'Tenant B home', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.services (
  id, business_id, slug, name, summary, description, category, price_minor, currency, status, created_by, published_at
)
VALUES
  ('a0000005-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'sandbox-inspection', 'Sandbox Inspection', 'Published inspection service.', 'Used for inquiry and cross-tenant tests.', 'inspection', 25000, 'USD', 'published', 'a0000001-0000-4000-8000-000000000004', now()),
  ('a0000005-0000-4000-8000-000000000002', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'sandbox-b-advisory', 'Sandbox B Advisory', 'Other-tenant published service.', 'Must not leak to business A staff.', 'advisory', 150000, 'USD', 'published', 'a0000001-0000-4000-8000-000000000007', now()),
  ('a0000005-0000-4000-8000-000000000003', 'a0000002-0000-4000-8000-000000000001', 'sandbox-draft-service', 'Sandbox Draft Service', 'Draft service.', 'Must stay unpublished.', 'other', 1000, 'USD', 'draft', 'a0000001-0000-4000-8000-000000000003', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.property_inquiries (
  id, property_id, business_id, from_user_id, contact_name, contact_email, contact_phone, message, status
)
VALUES
  ('a0000006-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000008', 'Cara Member', 'sandbox-member-c@accountabul.test', '555-0301', 'Interested in the published duplex.', 'new'),
  ('a0000006-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', NULL, 'Guest Inquirer', 'guest-inquirer@accountabul.test', '555-0302', 'Guest inquiry with synthetic contact details.', 'contacted'),
  ('a0000006-0000-4000-8000-000000000003', 'a0000003-0000-4000-8000-000000000003', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'a0000001-0000-4000-8000-00000000000b', 'Sam Subscriber', 'sandbox-subscriber@accountabul.test', '555-0303', 'Other-tenant inquiry. Business A must not read this.', 'qualified')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.service_inquiries (
  id, service_id, business_id, from_user_id, contact_name, contact_email, contact_phone, message, status
)
VALUES
  ('a0000007-0000-4000-8000-000000000001', 'a0000005-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'a0000001-0000-4000-8000-000000000008', 'Cara Member', 'sandbox-member-c@accountabul.test', '555-0401', 'Need an inspection quote.', 'new'),
  ('a0000007-0000-4000-8000-000000000002', 'a0000005-0000-4000-8000-000000000002', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'a0000001-0000-4000-8000-00000000000c', 'Pat Overdue', 'sandbox-pastdue@accountabul.test', '555-0402', 'Other-tenant service inquiry.', 'new')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.saved_properties (id, user_id, property_id)
VALUES
  ('a0000008-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000008', 'a0000003-0000-4000-8000-000000000001'),
  ('a0000008-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-00000000000b', 'a0000003-0000-4000-8000-000000000003'),
  ('a0000008-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000005', 'a0000003-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_follows (id, user_id, business_id)
VALUES
  ('a0000009-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000008', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0'),
  ('a0000009-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-00000000000b', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca'),
  ('a0000009-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000008', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (
  id, slug, title, description, host_business_id, scheduled_start_at, status,
  provider, embed_url, replay_url_path, chat_enabled, tips_enabled,
  access_mode, pass_price_minor, pass_currency, created_by, speaker_requests_enabled
)
VALUES
  (
    'a000000a-0000-4000-8000-000000000001',
    'sandbox-paid-room',
    'Sandbox Paid Room',
    'Paid event used to test stream URL grants.',
    '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0',
    now() + interval '2 days',
    'scheduled',
    'restream',
    'https://sandbox.example.test/embed/paid-room',
    'replays/sandbox-paid-room',
    true,
    true,
    'subscriber_or_pass',
    1500,
    'USD',
    'a0000001-0000-4000-8000-000000000003',
    true
  ),
  (
    'a000000a-0000-4000-8000-000000000002',
    'sandbox-public-room',
    'Sandbox Public Room',
    'Public event for anonymous baseline reads.',
    'e218c8fe-6320-4f37-80f1-9d8394dc72ca',
    now() - interval '1 hour',
    'live',
    'restream',
    'https://sandbox.example.test/embed/public-room',
    NULL,
    true,
    true,
    'public',
    NULL,
    'USD',
    'a0000001-0000-4000-8000-000000000007',
    false
  )
ON CONFLICT (id) DO NOTHING;

UPDATE public.events
SET
  embed_url = coalesce(embed_url, 'https://sandbox.example.test/embed/launch'),
  replay_url_path = coalesce(replay_url_path, 'replays/accountabul-launch-room'),
  provider = coalesce(provider, 'restream')
WHERE id = '535ceaae-00ac-4712-a3b9-4425da13ed14';

INSERT INTO public.chat_messages (
  id, event_id, user_id, body, kind, source, author_display_name, author_badge, moderation_status, published_at
)
VALUES
  ('a000000b-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000008', 'Hello from member C', 'message', 'accountabul', 'Member C', 'accountabul_member', 'approved', now()),
  ('a000000b-0000-4000-8000-000000000002', 'a000000a-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000002', 'Moderator on duty', 'message', 'accountabul', 'Sandbox Moderator', 'moderator', 'approved', now()),
  ('a000000b-0000-4000-8000-000000000003', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000009', 'Banned user leftover', 'message', 'accountabul', 'Banned User', 'accountabul_member', 'rejected', NULL),
  ('a000000b-0000-4000-8000-000000000004', 'a000000a-0000-4000-8000-000000000001', NULL, 'Paid guest comment', 'message', 'paid_guest', 'Guest Donor', 'paid_guest', 'approved', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chat_moderation_actions (id, event_id, target_user_id, actor_user_id, action, reason, expires_at)
VALUES
  ('a000000c-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000009', 'a0000001-0000-4000-8000-000000000002', 'ban', 'Sandbox ban for chat write tests', now() + interval '30 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_reminders (id, event_id, user_id)
VALUES
  ('a000000d-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-00000000000b'),
  ('a000000d-0000-4000-8000-000000000002', '535ceaae-00ac-4712-a3b9-4425da13ed14', 'a0000001-0000-4000-8000-000000000008')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_presence (id, event_id, user_id, last_seen_at)
VALUES
  ('a000000e-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000008', now()),
  ('a000000e-0000-4000-8000-000000000002', 'a000000a-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000002', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tips (
  id, event_id, from_user_id, to_business_id, amount_minor, currency, message, status, provider, provider_record_id, idempotency_key, paid_at
)
VALUES
  ('a000000f-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-00000000000b', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 2500, 'USD', 'Keep going', 'paid', 'stripe', 'ch_sandbox_tip_1', 'sandbox-tip-1', now()),
  ('a000000f-0000-4000-8000-000000000002', 'a000000a-0000-4000-8000-000000000001', NULL, '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 500, 'USD', 'Guest tip', 'created', 'stripe', NULL, 'sandbox-tip-2', NULL),
  ('a000000f-0000-4000-8000-000000000003', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000008', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 1000, 'USD', 'Failed tip', 'failed', 'stripe', NULL, 'sandbox-tip-3', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_records (
  id, kind, provider, provider_account_id, user_id, event_id, tip_id,
  stripe_customer_id, amount_minor, currency, status, idempotency_key, paid_at, metadata
)
VALUES
  ('a0000010-0000-4000-8000-000000000001', 'tip', 'stripe', 'acct_sandbox', 'a0000001-0000-4000-8000-00000000000b', 'a000000a-0000-4000-8000-000000000002', 'a000000f-0000-4000-8000-000000000001', 'cus_sandbox_sub', 2500, 'USD', 'paid', 'sandbox-pay-tip-1', now(), '{"sandbox":true}'::jsonb),
  ('a0000010-0000-4000-8000-000000000002', 'event_pass', 'stripe', 'acct_sandbox', 'a0000001-0000-4000-8000-00000000000b', 'a000000a-0000-4000-8000-000000000001', NULL, 'cus_sandbox_sub', 1500, 'USD', 'paid', 'sandbox-pay-pass-1', now(), '{"sandbox":true}'::jsonb),
  ('a0000010-0000-4000-8000-000000000003', 'membership', 'stripe', 'acct_sandbox', 'a0000001-0000-4000-8000-00000000000c', NULL, NULL, 'cus_sandbox_past', 2900, 'USD', 'failed', 'sandbox-pay-mem-1', NULL, '{"sandbox":true}'::jsonb),
  ('a0000010-0000-4000-8000-000000000004', 'paid_comment', 'stripe', 'acct_sandbox', NULL, 'a000000a-0000-4000-8000-000000000001', NULL, NULL, 500, 'USD', 'paid', 'sandbox-pay-comment-1', now(), '{"sandbox":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_events (
  id, provider, provider_event_id, event_type, tip_id, payment_record_id, payload, processed_at, provider_account_id, livemode
)
VALUES
  ('a0000011-0000-4000-8000-000000000001', 'stripe', 'evt_sandbox_1', 'checkout.session.completed', 'a000000f-0000-4000-8000-000000000001', 'a0000010-0000-4000-8000-000000000001', '{"sandbox":true}'::jsonb, now(), 'acct_sandbox', false),
  ('a0000011-0000-4000-8000-000000000002', 'stripe', 'evt_sandbox_2', 'payment_intent.payment_failed', NULL, 'a0000010-0000-4000-8000-000000000003', '{"sandbox":true}'::jsonb, now(), 'acct_sandbox', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_passes (
  id, event_id, user_id, purchaser_email, payment_record_id, status, access_token_hash, activated_at
)
VALUES
  ('a0000012-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-00000000000b', 'sandbox-subscriber@accountabul.test', 'a0000010-0000-4000-8000-000000000002', 'active', encode(sha256('sandbox-pass-token'::bytea), 'hex'), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.paid_comments (
  id, event_id, user_id, guest_display_name, guest_email, body, body_sha256,
  standards_version_id, status, payment_record_id, chat_message_id
)
VALUES
  (
    'a0000013-0000-4000-8000-000000000001',
    'a000000a-0000-4000-8000-000000000001',
    NULL,
    'Guest Donor',
    'guest-donor@accountabul.test',
    'Paid guest comment',
    encode(sha256('Paid guest comment'::bytea), 'hex'),
    '33b83b1e-29d3-4692-a894-e55cd57580eb',
    'published',
    'a0000010-0000-4000-8000-000000000004',
    'a000000b-0000-4000-8000-000000000004'
  ),
  (
    'a0000013-0000-4000-8000-000000000002',
    'a000000a-0000-4000-8000-000000000001',
    'a0000001-0000-4000-8000-000000000008',
    'Member C',
    'sandbox-member-c@accountabul.test',
    'Awaiting checkout',
    encode(sha256('Awaiting checkout'::bytea), 'hex'),
    '33b83b1e-29d3-4692-a894-e55cd57580eb',
    'approved',
    NULL,
    NULL
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.billing_customers (id, user_id, provider, stripe_account_id, stripe_customer_id, email)
VALUES
  ('a0000014-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-00000000000b', 'stripe', 'acct_sandbox', 'cus_sandbox_sub', 'sandbox-subscriber@accountabul.test'),
  ('a0000014-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-00000000000c', 'stripe', 'acct_sandbox', 'cus_sandbox_past', 'sandbox-pastdue@accountabul.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.membership_subscriptions (
  id, user_id, billing_customer_id, stripe_account_id, stripe_subscription_id,
  stripe_product_id, stripe_price_id, tier_key, status, current_period_start, current_period_end
)
VALUES
  ('a0000015-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-00000000000b', 'a0000014-0000-4000-8000-000000000001', 'acct_sandbox', 'sub_sandbox_active', 'prod_sandbox_member', 'price_sandbox_month', 'member', 'active', now() - interval '5 days', now() + interval '25 days'),
  ('a0000015-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-00000000000c', 'a0000014-0000-4000-8000-000000000002', 'acct_sandbox', 'sub_sandbox_pastdue', 'prod_sandbox_member', 'price_sandbox_month', 'member', 'past_due', now() - interval '40 days', now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_credentials (
  id, business_id, credential_type, issuing_authority, identifier, issued_at, expires_at,
  document_path, private_notes, review_status, reviewed_by, reviewed_at, public_display_approved, submitted_by
)
VALUES
  ('a0000016-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'license', 'Texas Sandbox Board', 'LIC-A-0001', '2024-01-15', '2027-01-15', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0/credentials/lic-a.pdf', 'Private review note for tenant A', 'approved', 'a0000001-0000-4000-8000-000000000001', now(), true, 'a0000001-0000-4000-8000-000000000003'),
  ('a0000016-0000-4000-8000-000000000002', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'insurance', 'Illinois Sandbox Mutual', 'INS-B-0002', '2025-03-01', '2026-03-01', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca/credentials/ins-b.pdf', 'Private review note for tenant B', 'pending', NULL, NULL, false, 'a0000001-0000-4000-8000-000000000007')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.business_policies (id, business_id, title, slug, policy_type, content, is_published, sort_order, created_by)
VALUES
  ('a0000017-0000-4000-8000-000000000001', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', 'Sandbox Privacy', 'privacy', 'privacy', 'Synthetic privacy policy for tenant A.', true, 0, 'a0000001-0000-4000-8000-000000000003'),
  ('a0000017-0000-4000-8000-000000000002', 'e218c8fe-6320-4f37-80f1-9d8394dc72ca', 'Sandbox Terms', 'terms', 'terms', 'Synthetic terms for tenant B.', false, 0, 'a0000001-0000-4000-8000-000000000007')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.speaker_requests (id, event_id, user_id, topic, status, reviewed_by, reviewed_at)
VALUES
  ('a0000018-0000-4000-8000-000000000001', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000008', 'How members use the sandbox room', 'pending', NULL, NULL),
  ('a0000018-0000-4000-8000-000000000002', 'a000000a-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-00000000000b', 'Paid subscriber speaker slot', 'approved', 'a0000001-0000-4000-8000-000000000002', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.audit_log (id, actor_user_id, action, target_table, target_id, diff, request_id)
VALUES
  ('a0000019-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'sandbox.seed', 'businesses', '8ebbdca0-7031-44dc-b71c-6e9f6c9f1cc0', '{"sandbox":true}'::jsonb, 'seed-20260904'),
  ('a0000019-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000003', 'vendor.verification.in_review', 'businesses', 'a0000002-0000-4000-8000-000000000002', '{"tax_id_last4":"0002"}'::jsonb, 'seed-20260904')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.provider_health (provider, status, last_connected_at, details)
VALUES
  ('restream', 'unknown', NULL, '{"sandbox":true}'),
  ('stripe', 'healthy', now(), '{"sandbox":true}')
ON CONFLICT (provider) DO NOTHING;
