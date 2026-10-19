create or replace function public.is_chat_banned(_event_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_moderation_actions a
    where a.target_user_id = _user_id
      and a.action = 'ban'
      and (a.event_id is null or a.event_id = _event_id)
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

revoke all on function public.is_chat_banned(uuid, uuid) from public, anon;
grant execute on function public.is_chat_banned(uuid, uuid) to authenticated, service_role;

create policy chat_messages_insert on public.chat_messages
for insert to authenticated
with check (
  user_id = auth.uid()
  and kind = 'message'
  and is_hidden = false
  and length(btrim(body)) between 1 and 500
  and not public.is_chat_banned(event_id, auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id and e.chat_enabled = true and e.status in ('scheduled','live','replay_available')
  )
);