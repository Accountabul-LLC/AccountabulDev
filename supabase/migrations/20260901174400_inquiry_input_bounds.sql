-- Bound all public inquiry payloads at the authoritative database boundary.
-- UI validation improves feedback, but these constraints also apply to direct
-- Data API clients and prevent unbounded lead records.

alter table public.service_inquiries
  add constraint service_inquiries_contact_name_valid
    check (contact_name = btrim(contact_name) and char_length(contact_name) between 1 and 120),
  add constraint service_inquiries_contact_email_valid
    check (
      contact_email = btrim(contact_email)
      and char_length(contact_email) between 3 and 254
      and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  add constraint service_inquiries_contact_phone_valid
    check (
      contact_phone is null
      or (
        contact_phone = btrim(contact_phone)
        and char_length(contact_phone) between 1 and 40
      )
    ),
  add constraint service_inquiries_message_valid
    check (message = btrim(message) and char_length(message) between 1 and 2000);

alter table public.property_inquiries
  add constraint property_inquiries_contact_name_valid
    check (contact_name = btrim(contact_name) and char_length(contact_name) between 1 and 120),
  add constraint property_inquiries_contact_email_valid
    check (
      contact_email = btrim(contact_email)
      and char_length(contact_email) between 3 and 254
      and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  add constraint property_inquiries_contact_phone_valid
    check (
      contact_phone is null
      or (
        contact_phone = btrim(contact_phone)
        and char_length(contact_phone) between 1 and 40
      )
    ),
  add constraint property_inquiries_message_valid
    check (message = btrim(message) and char_length(message) between 1 and 2000);
