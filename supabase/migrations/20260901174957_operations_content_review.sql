-- Standalone Operations Console review contracts.
--
-- These functions are the only privileged mutation path used by the console.
-- Each decision locks the target row, validates the current state, applies the
-- transition, and records the audit event in one database transaction.

create or replace function public.review_property(
  p_property_id uuid,
  p_decision text,
  p_note text default null,
  p_request_id text default null
)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_property public.properties;
  after_property public.properties;
  parent_is_approved boolean;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'Not authorized to review properties.' using errcode = '42501';
    end if;
  elsif not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only Accountabul administrators can review properties.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'request_changes', 'reject', 'suspend') then
    raise exception 'Unsupported property review decision.' using errcode = '22023';
  end if;

  if p_decision <> 'approve' and nullif(btrim(p_note), '') is null then
    raise exception 'A review note is required for this decision.' using errcode = '22023';
  end if;

  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'A review note may not exceed 2000 characters.' using errcode = '22023';
  end if;

  select p.*
    into before_property
    from public.properties p
    where p.id = p_property_id
    for update;

  if not found then
    return null;
  end if;

  if p_decision in ('approve', 'request_changes', 'reject')
     and before_property.status <> 'pending_review'::public.property_status then
    raise exception 'Only a pending property can receive this review decision.' using errcode = '22023';
  end if;

  if p_decision = 'suspend'
     and before_property.status <> 'published'::public.property_status then
    raise exception 'Only a published property can be suspended.' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    select exists (
      select 1
      from public.businesses b
      where b.id = before_property.business_id
        and b.profile_status = 'published'::public.profile_status
        and b.verification_status = 'verified'::public.verification_status
        and b.public_profile_enabled
    ) into parent_is_approved;

    if not parent_is_approved then
      raise exception 'The parent business must be approved before publishing a property.'
        using errcode = '22023';
    end if;
  end if;

  update public.properties p
  set
    status = case p_decision
      when 'approve' then 'published'::public.property_status
      when 'request_changes' then 'draft'::public.property_status
      when 'reject' then 'rejected'::public.property_status
      when 'suspend' then 'archived'::public.property_status
    end,
    published_at = case
      when p_decision = 'approve' then coalesce(p.published_at, now())
      else null
    end,
    archived_at = case when p_decision = 'suspend' then now() else null end
  where p.id = p_property_id
  returning p.* into after_property;

  insert into public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    diff,
    request_id
  ) values (
    auth.uid(),
    'ops.property.' || p_decision,
    'properties',
    p_property_id,
    jsonb_build_object(
      'before', to_jsonb(before_property),
      'after', to_jsonb(after_property),
      'note', nullif(btrim(p_note), '')
    ),
    nullif(left(btrim(p_request_id), 200), '')
  );

  return after_property;
end;
$$;

create or replace function public.review_service(
  p_service_id uuid,
  p_decision text,
  p_note text default null,
  p_request_id text default null
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_service public.services;
  after_service public.services;
  parent_is_approved boolean;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'Not authorized to review services.' using errcode = '42501';
    end if;
  elsif not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only Accountabul administrators can review services.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'request_changes', 'reject', 'suspend') then
    raise exception 'Unsupported service review decision.' using errcode = '22023';
  end if;

  if p_decision <> 'approve' and nullif(btrim(p_note), '') is null then
    raise exception 'A review note is required for this decision.' using errcode = '22023';
  end if;

  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'A review note may not exceed 2000 characters.' using errcode = '22023';
  end if;

  select s.*
    into before_service
    from public.services s
    where s.id = p_service_id
    for update;

  if not found then
    return null;
  end if;

  if p_decision in ('approve', 'request_changes', 'reject')
     and before_service.status <> 'pending_review'::public.service_status then
    raise exception 'Only a pending service can receive this review decision.' using errcode = '22023';
  end if;

  if p_decision = 'suspend'
     and before_service.status <> 'published'::public.service_status then
    raise exception 'Only a published service can be suspended.' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    select exists (
      select 1
      from public.businesses b
      where b.id = before_service.business_id
        and b.profile_status = 'published'::public.profile_status
        and b.verification_status = 'verified'::public.verification_status
        and b.public_profile_enabled
    ) into parent_is_approved;

    if not parent_is_approved then
      raise exception 'The parent business must be approved before publishing a service.'
        using errcode = '22023';
    end if;
  end if;

  update public.services s
  set
    status = case p_decision
      when 'approve' then 'published'::public.service_status
      when 'request_changes' then 'draft'::public.service_status
      when 'reject' then 'rejected'::public.service_status
      when 'suspend' then 'archived'::public.service_status
    end,
    published_at = case
      when p_decision = 'approve' then coalesce(s.published_at, now())
      else null
    end
  where s.id = p_service_id
  returning s.* into after_service;

  insert into public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    diff,
    request_id
  ) values (
    auth.uid(),
    'ops.service.' || p_decision,
    'services',
    p_service_id,
    jsonb_build_object(
      'before', to_jsonb(before_service),
      'after', to_jsonb(after_service),
      'note', nullif(btrim(p_note), '')
    ),
    nullif(left(btrim(p_request_id), 200), '')
  );

  return after_service;
end;
$$;

create or replace function public.review_business_credential(
  p_credential_id uuid,
  p_decision text,
  p_note text default null,
  p_request_id text default null
)
returns public.business_credentials
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_credential public.business_credentials;
  after_credential public.business_credentials;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'Not authorized to review business credentials.' using errcode = '42501';
    end if;
  elsif not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only Accountabul administrators can review business credentials.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'Unsupported credential review decision.' using errcode = '22023';
  end if;

  if p_decision = 'reject' and nullif(btrim(p_note), '') is null then
    raise exception 'A review note is required for this decision.' using errcode = '22023';
  end if;

  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'A review note may not exceed 2000 characters.' using errcode = '22023';
  end if;

  select c.*
    into before_credential
    from public.business_credentials c
    where c.id = p_credential_id
    for update;

  if not found then
    return null;
  end if;

  if before_credential.review_status <> 'pending'::public.credential_review_status then
    raise exception 'Only a pending credential can be reviewed.' using errcode = '22023';
  end if;

  update public.business_credentials c
  set
    review_status = case p_decision
      when 'approve' then 'approved'::public.credential_review_status
      when 'reject' then 'rejected'::public.credential_review_status
    end,
    public_display_approved = p_decision = 'approve',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    private_notes = coalesce(nullif(btrim(p_note), ''), c.private_notes)
  where c.id = p_credential_id
  returning c.* into after_credential;

  insert into public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    diff,
    request_id
  ) values (
    auth.uid(),
    'ops.credential.' || p_decision,
    'business_credentials',
    p_credential_id,
    jsonb_build_object(
      'before', to_jsonb(before_credential),
      'after', to_jsonb(after_credential),
      'note', nullif(btrim(p_note), '')
    ),
    nullif(left(btrim(p_request_id), 200), '')
  );

  return after_credential;
end;
$$;

revoke execute on function public.review_property(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.review_service(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.review_business_credential(uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.review_property(uuid, text, text, text)
  to service_role;
grant execute on function public.review_service(uuid, text, text, text)
  to service_role;
grant execute on function public.review_business_credential(uuid, text, text, text)
  to service_role;
