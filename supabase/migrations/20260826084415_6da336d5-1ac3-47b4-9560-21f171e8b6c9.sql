revoke execute on function public.has_active_membership(uuid, timestamp with time zone) from anon, authenticated, public;
revoke execute on function public.has_event_pass(uuid, uuid, timestamp with time zone) from anon, authenticated, public;
grant execute on function public.has_active_membership(uuid, timestamp with time zone) to service_role;
grant execute on function public.has_event_pass(uuid, uuid, timestamp with time zone) to service_role;