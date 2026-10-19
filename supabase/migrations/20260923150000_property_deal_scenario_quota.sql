-- ACC-20260923-003: cap saved deal scenarios per account. Enforced in the database so
-- the service-role write path in saveDealScenario cannot bypass it.

create or replace function public.enforce_property_deal_scenario_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize concurrent inserts for one account so the count can't be raced past the cap.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if (select count(*) from public.property_deal_scenarios where user_id = new.user_id) >= 100 then
    raise exception 'property_deal_scenario_quota_exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_property_deal_scenario_quota() from public, anon, authenticated;

create trigger property_deal_scenarios_quota
  before insert on public.property_deal_scenarios
  for each row execute function public.enforce_property_deal_scenario_quota();
