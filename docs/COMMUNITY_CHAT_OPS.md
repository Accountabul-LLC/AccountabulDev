# Community chat rooms — admin capability and member chat

Community chat rooms are **dynamic data, not code**. An operator creates a room in the
Operations Console and it appears in the member chat interface immediately. Adding
General, Real Estate, Vendor Network, Accountabul Help, or Deal Evaluation requires no
code change, no migration, and no deployment.

Room creation and permissioning are **operator-only**. Members hold no write grant on
`community_rooms` or `community_room_grants`, and the console payload (which includes
inactive and deleted rooms) is never served to a member session.

## Where each part lives

| Piece                        | Location                                                                  |
| ---------------------------- | ------------------------------------------------------------------------- |
| Tables, enums, RLS           | `supabase/migrations/20260909165841_community_chat.sql`                   |
| Operations API               | `src/routes/api/internal/ops/community-rooms.ts` (this repo)              |
| Request validation (shared)  | `src/lib/community-chat/room-admin.ts` (this repo)                        |
| Console screen               | `src/routes/chat-rooms.tsx` (Ops Hub repo)                                |
| Console contract and mappers | `src/lib/ops-contract.ts`, `src/lib/ops-mappers.ts` (Ops Hub repo)        |
| Console server functions     | `listChatRooms`, `saveChatRoom`, `deleteChatRoom` in `ops.functions.ts`   |
| Member chat routes           | `src/routes/chat.tsx` (room rail), `chat.index.tsx`, `chat.$slug.tsx`     |
| Member chat components       | `src/components/community-chat/`                                          |
| Member write path            | `postCommunityMessage` in `src/lib/community-chat/community.functions.ts` |
| Member chat rules (pure)     | `src/lib/community-chat/chat.ts`                                          |

## API contract

All four methods require `Authorization: Bearer <OPERATIONS_API_KEY>`. Missing
configuration returns 503, a missing bearer 401, an incorrect bearer 403.

### `GET /api/internal/ops/community-rooms`

Returns `{ items }` with **every** room — active, inactive, and soft-deleted — ordered by
`sort_order` then `name`. Each item carries the room columns plus:

- `grants`: role grants (`grant_kind: "role"`, `role`) and people grants
  (`grant_kind: "user"`, `user_id`, plus `handle` and `display_name` when the profile has
  them, so the console can label a person without a second lookup).
- `message_count`: undeleted messages in the room.

### `POST` (create) and `PATCH` (update)

camelCase body; `PATCH` additionally requires `id`.

| Field          | Rule                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| `name`         | Required, 1–80 characters.                                                         |
| `slug`         | Optional; derived from `name` when omitted. `^[a-z0-9][a-z0-9-]{0,59}$`.           |
| `description`  | Optional, ≤ 280 characters. Empty becomes `null`.                                  |
| `roomKind`     | Optional, defaults to `community`, ≤ 40 characters. Reserved for later room types. |
| `sortOrder`    | Integer 0–10 000. Lower sorts first.                                               |
| `isActive`     | Defaults to `true`. `false` hides the room from members without deleting it.       |
| `accessPolicy` | `signed_in`, `verified_vendor`, `role_allowlist`, or `user_allowlist`.             |
| `roleGrants`   | `app_role` values. Only for `role_allowlist`.                                      |
| `userGrants`   | Member UUIDs or `@handles`. Only for `user_allowlist`.                             |
| `restore`      | `PATCH` only. `true` clears `deleted_at`, bringing a deleted room back.            |

Grants are **fully replaced** on every write, so the payload is the complete access list.
The parser rejects mixing grant kinds (a role-allowlist room cannot carry people, and the
reverse), unresolvable handles or ids (named in the 400 message rather than silently
dropped), and more than 200 grants on one room. An empty allowlist is accepted and admits
nobody.

Responses: `201` on create, `200` on update, `400` on a validation failure, `404` when the
room id does not exist, `409` when the slug is already in use — including by a deleted
room, which keeps its slug so its history stays attributable. Restore that room or choose
a different slug.

### `DELETE`

Takes `id` in the body or as `?id=`. Sets `deleted_at` and `is_active = false`; it never
removes a row. `community_messages.room_id` is `on delete restrict`, so a hard delete
would either fail or orphan history. Deleting an already-deleted room returns `409`.

Every write appends `ops.community_room.created|updated|deleted` to `audit_log` against
`target_table = "community_rooms"`.

## Who can open a room

`community_room_visible_to` is the single decision point, used by the member read policy
on both `community_rooms` and `community_messages`:

| Policy            | Admits                                                       |
| ----------------- | ------------------------------------------------------------ |
| `signed_in`       | Any signed-in member.                                        |
| `verified_vendor` | Verified vendors, plus moderators and admins.                |
| `role_allowlist`  | Members holding one of the room's granted `app_role` values. |
| `user_allowlist`  | Exactly the people granted on the room.                      |

A deleted or inactive room admits nobody regardless of policy. The console screen is a
convenience over this policy, not a second gate: a member who calls the database directly
sees exactly the same rooms.

## Console screen

`/chat-rooms` in the Operations Console, in the sidebar under Conference room. It uses the
Ops Hub console shell, tokens, and Fraunces/Public Sans pairing — not the Accountabul
member theme.

- A table of every room: name and address, a plain-language summary of who can open it,
  message count, Active / Inactive / Deleted badge, last update, and per-row actions.
- **Create chat room** and **Edit** open the same dialog: name (the address follows the
  name until it is edited by hand, and never changes itself on an existing room),
  description with a character count, access policy with one line explaining each choice,
  role checkboxes or a people textarea depending on the policy, display order, and an
  Active switch.
- The dialog validates against the same bounds as the server, so an operator sees "Choose
  at least one role, or nobody will be able to open this room" in the form rather than a
  400 from the API.
- Delete asks for confirmation and states plainly that messages are kept and the room can
  be restored. A deleted row's action becomes **Restore**.

## Member chat interface

`/chat` is linked from the signed-in navigation. It lists the rooms open to the
member and shows one room at a time at `/chat/<slug>`.

- **Rooms come from the database.** The browser reads `community_rooms` with the
  member's own session; row level security returns only the rooms their access policy
  admits. A room an admin creates appears on the member's next fetch — nothing is
  hard-coded and no deploy is needed.
- **Reads** use only the columns granted to `authenticated`, and RLS returns only
  published, undeleted, unhidden messages. The newest 100 messages are shown, polled
  every 5 seconds. A realtime subscription accelerates new messages and restores; it
  cannot accelerate a hide, because Supabase Realtime enforces RLS on the row being
  broadcast and a newly hidden row fails the member-read policy on its new state, so
  that specific UPDATE is never delivered to member subscribers.
- **Messages publish immediately.** Chat is publish-first, like YouTube live chat. There
  is no approval queue and no moderation latency: `postCommunityMessage` inserts the
  message already published, and other members see it on their next poll or realtime
  event. The only checks on the send path are cheap gates that never read the message's
  meaning — a verified session, room access, an active mute or ban, acceptance of the
  current Chat Policy, the rate limit (20 a minute per member per room), and an exact
  duplicate sent within 30 seconds. The server also stores the author's name, handle,
  avatar, and badge (admin › moderator › vendor › member), and treats a repeated
  `client_attempt_id` as already sent.
- **Safeguards run after publication.** Automated screening, member reports, and staff
  review can flag, hide, or delete a message afterwards, and can mute, remove, or ban
  its author. See [`COMMUNITY_CHAT_MODERATION.md`](COMMUNITY_CHAT_MODERATION.md).
- **Report** appears on every message except the member's own.
- **Signed-out visitors** see a sign-in prompt. A room that is closed or not open to the
  member reads "This room is not available" without saying which.

## Built to extend

The first version stays deliberately small, but the shape supports the next steps without
a rewrite:

- `room_kind` is already stored, so property-specific or deal-specific room types can be
  added by value rather than by schema change.
- `community_room_grants` is a general (room, principal) table; private rooms and
  invite-only rooms are new policy values over the same grants.
- `community_messages.metadata` is `jsonb`, which is where a shared Deal Calculator result
  attaches to a Deal Evaluation message.
- `sort_order` and `is_active` already let an operator stage a room before members see it.
