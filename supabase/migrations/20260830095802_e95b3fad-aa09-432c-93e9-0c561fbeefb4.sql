insert into public.events (
  slug,
  title,
  description,
  scheduled_start_at,
  status,
  access_mode,
  chat_enabled,
  tips_enabled
)
values (
  'accountabul-launch-room',
  'Accountabul Launch Room',
  'Welcome to the Accountabul conference room. When we go live, the stream plays right here and members can join the room chat. Set a reminder and we will see you at kickoff.',
  now() + interval '7 days',
  'scheduled',
  'public',
  true,
  true
)
on conflict (slug) do nothing;