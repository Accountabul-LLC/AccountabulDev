-- Reconstructed 2026-09-10 from live catalog on PRODUCTION_PROJECT_REF
-- (schema_migrations version 20260906053442 / name september_6_assessment_hardening).
-- Already applied on that project. Do not re-apply there.

update storage.buckets
set public = false
where id in ('business-media', 'property-media');

create or replace function public.can_view_event_presence(_event_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.subject_is_self_or_admin(_user_id) and (
    exists (
      select 1 from public.event_presence p
      where p.event_id = _event_id and p.user_id = _user_id
    )
    or exists (
      select 1 from public.event_reminders r
      where r.event_id = _event_id and r.user_id = _user_id
    )
    or exists (
      select 1 from public.events e
      where e.id = _event_id
        and e.host_business_id is not null
        and public.can_manage_business(e.host_business_id, _user_id)
    )
    or public.has_role(_user_id, 'admin'::app_role)
    or public.has_role(_user_id, 'moderator'::app_role)
  );
$$;
