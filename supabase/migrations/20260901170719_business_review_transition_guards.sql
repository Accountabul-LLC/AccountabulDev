-- Keep the database transition contract aligned with the Operations Console.
-- The first review migration is already deployed, so this follow-up replaces
-- the function without rewriting applied migration history.
create or replace function public.review_business(
  p_business_id uuid,
  p_decision text,
  p_note text default null,
  p_request_id text default null
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_business public.businesses;
  after_business public.businesses;
begin
  if auth.uid() is null then
    if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'Not authorized to review businesses.' using errcode = '42501';
    end if;
  elsif not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only Accountabul administrators can review businesses.' using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'request_changes', 'reject', 'suspend') then
    raise exception 'Unsupported business review decision.' using errcode = '22023';
  end if;

  if p_decision <> 'approve' and nullif(btrim(p_note), '') is null then
    raise exception 'A review note is required for this decision.' using errcode = '22023';
  end if;

  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'A review note may not exceed 2000 characters.' using errcode = '22023';
  end if;

  select b.*
    into before_business
    from public.businesses b
    where b.id = p_business_id
    for update;

  if not found then
    return null;
  end if;

  if p_decision = 'approve'
     and before_business.profile_status = 'published'
     and before_business.verification_status = 'verified'
     and before_business.public_profile_enabled then
    raise exception 'The business is already approved.' using errcode = '22023';
  end if;

  if p_decision = 'request_changes'
     and before_business.profile_status = 'draft'
     and before_business.verification_status = 'unverified'
     and not before_business.public_profile_enabled then
    raise exception 'Changes have already been requested for this business.' using errcode = '22023';
  end if;

  if p_decision = 'reject'
     and before_business.profile_status = 'rejected'
     and before_business.verification_status = 'rejected'
     and not before_business.public_profile_enabled then
    raise exception 'The business is already rejected.' using errcode = '22023';
  end if;

  if p_decision = 'suspend'
     and not (
       before_business.profile_status = 'published'
       and before_business.verification_status = 'verified'
       and before_business.public_profile_enabled
     ) then
    raise exception 'Only an approved business can be suspended.' using errcode = '22023';
  end if;

  update public.businesses b
  set
    profile_status = case p_decision
      when 'approve' then 'published'::public.profile_status
      when 'request_changes' then 'draft'::public.profile_status
      when 'reject' then 'rejected'::public.profile_status
      when 'suspend' then 'suspended'::public.profile_status
    end,
    verification_status = case p_decision
      when 'approve' then 'verified'::public.verification_status
      when 'request_changes' then 'unverified'::public.verification_status
      when 'reject' then 'rejected'::public.verification_status
      when 'suspend' then 'expired'::public.verification_status
    end,
    public_profile_enabled = p_decision = 'approve',
    published_at = case when p_decision = 'approve' then coalesce(b.published_at, now()) else null end
  where b.id = p_business_id
  returning b.* into after_business;

  insert into public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    diff,
    request_id
  ) values (
    auth.uid(),
    'ops.business.' || p_decision,
    'businesses',
    p_business_id,
    jsonb_build_object(
      'before', to_jsonb(before_business),
      'after', to_jsonb(after_business),
      'note', nullif(btrim(p_note), '')
    ),
    nullif(left(btrim(p_request_id), 200), '')
  );

  return after_business;
end;
$$;

revoke execute on function public.review_business(uuid, text, text, text)
  from public, anon;
grant execute on function public.review_business(uuid, text, text, text)
  to authenticated, service_role;
