# Community chat seeding (development only)

Fills every active community room with realistic conversation so the chat UI can
be judged on a full backlog: scrolling, avatars, name and timestamp rendering,
message spacing, grouping of consecutive messages, and mobile layout.

Seeded messages are marked with `community_messages.seed_batch_id`. Cleanup
deletes strictly on that column, so a real member message is outside the filter
by construction — message text is never inspected.

## Prerequisites

1. Apply `supabase/migrations/20260916140000_community_chat_seed_batches.sql`.
   It is idempotent: it adds `seed_batch_id` and `author_avatar_url` only if they
   are missing, and creates the `community_chat_seed_batches` ledger.
2. `OPERATIONS_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
3. A dev server running (`npm run dev`).

## Running it

```bash
node scripts/seed-community-chat.mjs status
```

```bash
node scripts/seed-community-chat.mjs seed
```

```bash
node scripts/seed-community-chat.mjs clear
```

`seed` writes 100 messages per active room by default; pass `--per-room 250` to
change it (capped at 500). `clear` removes every seeded message, or just one run
with `--batch <uuid>`. Output looks like:

```
5 rooms populated
500 test messages created
12 test users used
batch 3f9c1b7e-...
```

The script targets `http://localhost:3000`; override with `SEED_TARGET_URL`.

## The endpoint

`/api/internal/ops/community-chat-seed`, alongside the other internal ops routes.

| Method   | Does                                                          |
| -------- | ------------------------------------------------------------- |
| `GET`    | Active rooms, seeded vs. real message counts, recent batches   |
| `POST`   | Seeds every active room. Body: `{ "messages_per_room": 100 }`  |
| `DELETE` | Clears seeded messages. `?batch_id=<uuid>` scopes to one run   |

Two gates, in order:

1. **Environment.** `checkSeedingAllowed()` answers 404 when `NODE_ENV` is
   `production`, unless `COMMUNITY_CHAT_SEED_ENABLED=true` is set deliberately
   for a staging deployment. The gate runs before any work in every handler.
2. **Authorization.** The `OPERATIONS_API_KEY` bearer token, same as every other
   internal ops route. Members never have this token.

Both seed and clear write to `audit_log`.

> **Note on which database you are writing to.** The gate is on `NODE_ENV`, not
> on the database. A local dev server pointed at the production Supabase project
> will seed the production database. Point `SUPABASE_URL` at a development
> project before seeding, or accept that you will need to run `clear` afterwards.

## Test members

Twelve personas in `src/lib/community-chat/seed-personas.ts`, covering all four
badges (member, vendor, moderator, admin). Accounts are keyed by a reserved
`@seed.accountabul.test` email and handles are prefixed `dev-`, so:

- a seed handle can never collide with a real member's handle, and
- re-running the seed reuses the same twelve accounts instead of creating more.

Seven personas carry an avatar; five deliberately do not, so the UI's initials
fallback is exercised on every run. Avatars are self-contained SVG data URIs
built from the Accountabul Design Studio palette — there is no remote host to
404, so a seeded message can never show a broken image.

## Message data

`src/lib/community-chat/seed-messages.ts` holds four corpora — deal evaluation,
vendor network, general platform talk, and help — plus short reactions that mix
into all of them. `corpusForRoom()` matches on room slug and name, so rooms an
admin creates later get sensible content with no code change; anything unmatched
falls back to general conversation.

A 100-message room draws about 75 distinct lines, mixing one-word replies,
questions, dollar figures and multi-sentence analysis. No line repeats back to
back.

## Timestamps and grouping

`buildRoomConversation()` in `seed-conversation.ts` is pure and deterministic:
same room, same conversation. It lays out gaps forward and then shifts them so
the newest message lands at "now".

- Most gaps are under two minutes; some run several minutes; a few run an hour.
- Three overnight gaps spread 100 messages across **3 calendar days**, roughly a
  50-hour span, so same-day, yesterday and older timestamp formats all render.
- Speakers talk in runs of one to three consecutive messages, with short gaps
  inside a run. That is what makes it visible whether grouping consecutive
  messages (avatar and name once, timestamp per message) improves the layout.

## Performance

Rows are generated in memory and inserted in chunks of 250, so five rooms are
three insert round trips, not 500.

## What to check once a room is populated

1. Opening a room lands at or near the newest message.
2. The page itself does not scroll; only the message history does.
3. The composer and room header stay visible.
4. The room list stays usable.
5. Scrolling up reaches older messages.
6. New messages auto-scroll when you are already near the bottom.
7. New messages do **not** yank you down while you are reading older ones.
8. Repeat all of the above at mobile width.
