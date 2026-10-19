revoke insert, update, delete, truncate, references, trigger
  on public.billing_customers,
     public.membership_subscriptions,
     public.payment_records,
     public.event_passes,
     public.paid_comments,
     public.stripe_catalog_items,
     public.speaker_requests,
     public.provider_health,
     public.community_standards_versions
  from anon, authenticated;

revoke select on public.billing_customers,
                 public.membership_subscriptions,
                 public.payment_records,
                 public.event_passes,
                 public.paid_comments,
                 public.stripe_catalog_items,
                 public.speaker_requests,
                 public.provider_health
  from anon;

revoke select on public.paid_comments, public.stripe_catalog_items
  from authenticated;

grant select on public.billing_customers,
                public.membership_subscriptions,
                public.payment_records,
                public.event_passes,
                public.speaker_requests,
                public.provider_health,
                public.community_standards_versions
  to authenticated;

grant select on public.community_standards_versions to anon;

grant all on public.billing_customers,
              public.membership_subscriptions,
              public.payment_records,
              public.event_passes,
              public.paid_comments,
              public.stripe_catalog_items,
              public.speaker_requests,
              public.provider_health,
              public.community_standards_versions
  to service_role;