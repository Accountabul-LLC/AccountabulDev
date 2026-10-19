revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

revoke execute on function public.is_business_member(uuid, uuid) from public, anon;
grant execute on function public.is_business_member(uuid, uuid) to authenticated, service_role;

revoke execute on function public.can_manage_business(uuid, uuid) from public, anon;
grant execute on function public.can_manage_business(uuid, uuid) to authenticated, service_role;

revoke execute on function public.is_business_owner(uuid, uuid) from public, anon;
grant execute on function public.is_business_owner(uuid, uuid) to authenticated, service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;