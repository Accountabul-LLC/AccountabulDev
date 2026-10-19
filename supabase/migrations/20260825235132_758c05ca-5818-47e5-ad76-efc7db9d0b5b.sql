grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.is_business_member(uuid, uuid) to authenticated;
grant execute on function public.is_business_owner(uuid, uuid) to authenticated;
grant execute on function public.can_manage_business(uuid, uuid) to authenticated;
grant execute on function public.is_chat_banned(uuid, uuid) to authenticated;
grant execute on function public.can_view_event_presence(uuid, uuid) to authenticated;