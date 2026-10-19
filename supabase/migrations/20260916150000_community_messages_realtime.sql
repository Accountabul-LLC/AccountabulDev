-- The member chat page subscribes to INSERT events on community_messages so a
-- new message appears without a refresh. That subscription depends on the
-- table being in the supabase_realtime publication; chat_messages (the
-- conference chat) was added when it shipped, but community_messages never
-- was. Without this, the page's realtime channel never fires and every
-- message waits for the page's own poll interval to show up.
--
-- Supabase Realtime reads publication changes; no objects in the managed
-- realtime schema are modified. The guard makes local resets and branch
-- previews repeatable.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_messages'
  ) then
    alter publication supabase_realtime add table public.community_messages;
  end if;
end
$$;
