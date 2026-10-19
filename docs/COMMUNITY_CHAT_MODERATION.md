# Community chat moderation

Community chat is **publish-first**. A message is live the moment it is sent. Automated
safeguards, member reports, and staff review act on messages that are already published.
Moderators are involved only when something needs attention.

```
Member sends a message
  → the message is published (same request, no content check)
  → other members see it immediately
  → automated safeguards run after the response
  → a problem is flagged, hidden, or reported
  → staff review what was flagged or reported, when they need to
```

There is **no approval queue**. Nothing in chat waits for a moderator before it
appears. The one moderated-before-publication flow on the platform is paid on-air comments
in live events, which are unrelated to community chat and keep their own rules and
Community Standards.

## What can stop a send

Only cheap checks that do not read what the message says. Each refuses the send with a
plain explanation; none of them holds a message for review.

| Check                                     | Where                               | Member sees                              |
| ----------------------------------------- | ----------------------------------- | ---------------------------------------- |
| Signed in                                 | `requireSupabaseAuth`               | Sign-in prompt                           |
| Can open the room                         | `can_access_community_room`         | "This room is not open to your account." |
| Not muted, removed, or banned             | `community_chat_restriction`        | What the restriction is and when it ends |
| Accepted the current Chat Policy          | `community_chat_policy_acceptances` | The policy gate replaces the composer    |
| Rate limit: 20 messages a minute per room | `throwIfRateLimited`                | "Too many requests. Try again shortly."  |
| Same text, same room, within 30 seconds   | `content_sha256` lookup             | "You just sent that message."            |

All of these run in one parallel batch before the insert.

## Automated safeguards (after publication)

`postCommunityMessage` inserts the message already published, then schedules
`screenCommunityMessage` with `runAfterResponse`. On Cloudflare Workers that registers
the work with the request's `waitUntil`, so the isolate finishes screening after the
response has gone out. The sender and everyone else see the message first.

Screening combines two sources of signals
(`src/lib/community-chat/safeguards.ts`):

- **Deterministic rules** — instant and local. Link shorteners, IP-address links, and
  punycode hosts (low severity); links with embedded credentials or executable downloads
  (high); scam and spam phrases, shouting, and repeated characters (low); explicit threats
  and self-harm encouragement (high). Ordinary `https` links to real sites, such as listings,
  are normal in chat and raise nothing.
- **Moderation provider** — `omni-moderation-latest` via `moderateWithProvider`. Flagged
  categories become low-severity signals. The most severe ones (`sexual/minors`,
  `*/threatening`, `violence/graphic`, `self-harm/intent`, `self-harm/instructions`,
  `illicit/violent`) are high severity. **An unavailable or unconfigured provider adds no
  signals**, so an outage never flags or hides ordinary conversation.

| Signals           | Outcome                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| None              | Nothing. The message stays up and is marked screened.                                                                               |
| Only low severity | An automated flag in the review queue. The message **stays visible**.                                                               |
| Any high severity | An automated flag, and the message is **hidden** straight away. The hide is recorded in history as done by the automated safeguard. |

**Backstop.** If background work is ever lost, the message stays unscreened
(`screened_at is null`). Opening the moderation console runs `sweepUnscreenedMessages`
after its response. It screens real messages that are more than two minutes old and less
than seven days old, and skips seed data. A message is only marked screened once its
result is in hand, so a lost worker leaves it for the sweep.

## Reports

Every message except a member's own has **Report**. The member picks a reason (spam,
harassment, hateful conduct, threats, sexual content, self-harm, illegal activity, harmful
link, or something else) and can add up to 500 characters.

- Reports go through `reportCommunityMessage`. It reads the message with the reporter's
  own session, so nobody can report a message they cannot see.
- A member can report a message once. A second attempt says "already reported".
- Reports are limited to 10 per member per 10 minutes.
- **Three distinct open reports hide the message** until staff look at it. Only open
  reports count, so once staff dismiss the reports and restore a message, those old
  reports cannot hide it again.
- The author is never told who reported them.

Automated flags and member reports share one table (`community_message_flags`) and one
review queue.

## Staff tools

The Operations Console has a **Chat moderation** area (`/chat-moderation`), separate from
**Chat rooms**:

- **Needs review** — one card per message with open flags: author, room, timestamp,
  message text, whether it is visible, hidden, or deleted, the flag reasons, member report
  and automated counts, each reporter, and the rules that fired. Actions: **Dismiss — no
  action**, **Hide / Unhide**, **Delete / Restore**, and **Restrict author**.
- **Restricted members** — every active mute, room removal, and ban, with scope, reason,
  expiry, and who applied it. **Lift** ends a restriction early.
- **Moderation history** — every action, by staff or automated safeguards. It is
  append-only: a database trigger rejects updates and deletes.

| Action             | Effect                                          | Reason required | Open flags become |
| ------------------ | ----------------------------------------------- | --------------- | ----------------- |
| `hide_message`     | Invisible to members, restorable                | Yes             | actioned          |
| `unhide_message`   | Visible again                                   | No              | dismissed         |
| `delete_message`   | Removed for members, kept in the database       | Yes             | actioned          |
| `restore_message`  | Neither deleted nor hidden                      | No              | dismissed         |
| `dismiss_flags`    | No change to the message                        | No              | dismissed         |
| `mute_user`        | Can read, cannot post, for 1 hour to 30 days    | Yes             | actioned          |
| `remove_from_room` | Loses one room, timed or until lifted           | Yes             | actioned          |
| `ban_user`         | Loses all community chat, timed or until lifted | Yes             | actioned          |
| `lift_restriction` | Restriction ends now                            | No              | —                 |

Hiding and deleting are both soft and reversible. Restrictions are **lifted**, never
deleted, so history stays complete. Bans and room removals are enforced inside
`community_room_visible_to`, the same function that governs every member read, so a
restricted member cannot get around them by querying the database directly.

### API

`/api/internal/ops/community-moderation`, with the same bearer authentication as every
other operations endpoint.

- `GET ?view=queue` → `{ items }`, one per message with open flags.
- `GET ?view=restrictions` → `{ items }`, active restrictions only.
- `GET ?view=history` → `{ items }`, the newest 300 actions.
- `POST { action, messageId?, userId?, roomId?, restrictionId?, durationMinutes?, reason?, operator? }`
  performs one action and returns `{ action, moderationActionId, restrictionId, resolvedFlags }`.
  Restriction actions can name the member through `messageId` instead of `userId`.
  Responses: `400` for an invalid request, `404` for an unknown message, and `409` when the
  message is already in the requested state or a restriction was already lifted.

Every action also writes `ops.community_moderation.<action>` to `audit_log`. The console
sets `operator` from its verified session, never from the browser. It is recorded as
`actor_reference` and asserted by the console behind its bearer credential.

## Chat Policy

`community_chat_policy_versions` holds the platform-wide chat policy, and only one version
can be active. The first version, `2026-09-17`, says members are responsible for what they
post; that spam, scams, and flooding, harassment, threats, and hateful conduct, and
illegal, exploitative, or harmful content are prohibited; that members can report
messages; and that Accountabul may remove content and restrict accounts.

Members accept it once per version, the first time they go to post. Publishing a new
version, and making it the only active one, asks everyone again. The exact wording can be
refined by publishing a new version; no code change is needed.

## Data model

| Table                                                                  | Purpose                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `community_messages`                                                   | Adds `hidden_at`, `hidden_reason`, `screened_at`, `screening`, and `report_count`. Members read only messages where `published_at` is set and `deleted_at` and `hidden_at` are both null. |
| `community_message_flags`                                              | Member reports and automated flags. Open, actioned, or dismissed. One report per member per message.                                                                                      |
| `community_chat_restrictions`                                          | Mute, room removal, or ban. Scoped to one room or all chat, timed or indefinite, lifted rather than deleted.                                                                              |
| `community_moderation_actions`                                         | Append-only history of staff and automated actions.                                                                                                                                       |
| `community_chat_policy_versions` / `community_chat_policy_acceptances` | The policy and who accepted which version.                                                                                                                                                |

Members have no write grants on any of these. Every write goes through server code that
holds the service role.

**Migration note.** `20260917100000_community_chat_post_moderation.sql` converts any
message held under the earlier pre-moderation model into a hidden message with an open
automated flag (`legacy_pre_moderation_hold`). Those messages show up in **Needs review**,
where staff can restore or remove them.

## Built to extend

- New automated checks are new signals in `safeguards.ts`. They never change the send path.
- New report reasons are new values of `community_flag_category`.
- Per-room moderators, a warning step before a mute, appeals, and escalation are new
  action kinds over the same history table.
- Edited messages can be re-screened by clearing `screened_at`.

## Not yet built

- Members cannot delete or edit their own messages.
- Instant hide/delete. Supabase Realtime enforces RLS on the row being broadcast, so an
  UPDATE that hides a message fails the member-read policy on its new state and is never
  delivered to member subscribers — only the 5-second poll catches it. A restore/unhide
  _is_ delivered live, since its new state passes RLS. Closing this the rest of the way
  needs a broadcast channel from the server (not RLS-gated the same way), which is future
  work rather than something shipped untested against a live client.
- Moderators inside the member chat. Staff act from the Operations Console only.
- Warnings and appeals.
