# Live Multistream Runbook (OBS direct → Twitch/Kick/YouTube → Accountabul)

## What's built

Chat ingestion is implemented, tested, security-reviewed, and merged to `main`:

- OBS streams directly to each platform using the [obs-multi-rtmp](https://github.com/sorayuki/obs-multi-rtmp)
  plugin — no third-party restreaming service in the video path.
- Twitch and Kick chat arrive via signed webhooks
  (`src/routes/api/public/webhooks/twitch.ts`, `kick.ts`).
- YouTube chat is polled (`src/routes/api/internal/ops/multistream-youtube-poll.ts`,
  `src/lib/youtube/chat-poller.ts`) — YouTube has no webhook for chat.
- An operator maps each event to its platform channel(s) via
  `/api/internal/ops/multistream-channels`; a channel that doesn't match an event's
  mapping is not ingested (`src/lib/chat-adapters/ingest.server.ts`).
- All three platforms normalize into the same `chat_messages` row shape
  (`src/lib/chat-adapters/normalize.ts`) and pass through the same moderation path as
  first-party chat.
- Each platform's messages show a small source-platform mark in the chat panel
  (`src/components/live/platform-icon.tsx`).

## Still open

- **A viewing surface for the multistream video itself.** This runbook originally
  planned a third-party player (Castr) with a tokenized playback gate; that plan was
  never adopted. No video-playback layer has been built — only chat ingestion. If a
  viewing surface is needed, that's a separate design decision, not settled by this
  document.
- **Free-event sign-in requirement.** Not yet decided.
- LinkedIn / Instagram / X chat: deferred — limited or no live-chat API on those
  platforms.

## OBS setup checklist

1. Install the [obs-multi-rtmp](https://github.com/sorayuki/obs-multi-rtmp) plugin.
2. Add one output per destination platform (Twitch, Kick, YouTube); each output carries
   that platform's own RTMP URL and stream key.
3. Output: CBR, bitrate within the weakest destination's limit, keyframe interval 2s,
   x264 or hardware encoder.
4. Build scenes: camera, screen share, guest layout, branded overlay.
5. Do a private test stream to all destinations before going live.
6. In `/api/internal/ops/multistream-channels`, map the event to each platform's
   channel ID before the stream starts.

## Per-platform chat notes

- **Twitch**: EventSub `channel.chat.message` webhook, HMAC-signed
  (`TWITCH_EVENTSUB_SECRET`).
- **Kick**: `chat.message.sent` webhook, RSA-signed against Kick's published public key
  (`KICK_WEBHOOK_PUBLIC_KEY`, fetched from `https://api.kick.com/public/v1/public-key`).
- **YouTube**: `liveChatMessages.list` polled once a minute, capped at one request per
  5 seconds per channel to stay under the default quota
  (`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`/`YOUTUBE_TOKEN_ENCRYPTION_KEY`).

## Secrets

Twitch/Kick webhook secrets and the YouTube OAuth client live in environment variables
(see `.env.example`); YouTube's per-channel access/refresh tokens are encrypted at rest
via the `private.provider_connections` pattern (service-role RPCs, AES-256-GCM). Never
in client code or git. Rotate a key if it is ever exposed.
