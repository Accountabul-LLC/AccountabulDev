import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  authorInitials,
  avatarFromAccountMetadata,
  avatarSource,
  authorLabel,
  COMMUNITY_MESSAGE_MAX_LENGTH,
  describeRoomAudience,
  groupMessages,
  normalizeMessageBody,
  policyAcceptanceRequired,
  resolveAuthorBadge,
  sortRooms,
  validateMessageBody,
  type CommunityMessage,
  type CommunityRoomSummary,
} from "../src/lib/community-chat/chat.ts";

const VIEWER = "0f2b0d0d-5a4b-4a1b-9d3f-9b6a5a4f31cc";
const OTHER = "7a1c2d3e-5a4b-4a1b-9d3f-9b6a5a4f31cc";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260909165841_community_chat.sql");
const postFunction = read("../src/lib/community-chat/community.functions.ts");
const postModeration = read(
  "../supabase/migrations/20260917100000_community_chat_post_moderation.sql",
);
const hooks = read("../src/components/community-chat/use-community-chat.ts");
const header = read("../src/components/site-header.tsx");

function message(overrides: Partial<CommunityMessage> = {}): CommunityMessage {
  return {
    id: "m1",
    room_id: "r1",
    user_id: OTHER,
    body: "Anyone looked at the duplex on Grand?",
    created_at: "2026-09-16T15:00:00.000Z",
    author_display_name: "Amina Carter",
    author_handle: "amina",
    author_badge: "member",
    author_avatar_url: null,
    ...overrides,
  };
}

test("message bodies are normalized and bounded like the database", () => {
  assert.equal(normalizeMessageBody("  hello   \n\n\n\nthere  "), "hello\n\nthere");
  assert.deepEqual(validateMessageBody("   "), { ok: false, error: "Write a message first." });
  assert.equal(validateMessageBody("x".repeat(COMMUNITY_MESSAGE_MAX_LENGTH)).ok, true);
  assert.equal(validateMessageBody("x".repeat(COMMUNITY_MESSAGE_MAX_LENGTH + 1)).ok, false);
  assert.match(migration, /char_length\(body\) <= 500/);
});

test("the highest standing sets the author badge", () => {
  const none = { isAdmin: false, isModerator: false, isVerifiedVendor: false };
  assert.equal(resolveAuthorBadge(none), "member");
  assert.equal(resolveAuthorBadge({ ...none, isVerifiedVendor: true }), "vendor");
  assert.equal(
    resolveAuthorBadge({ ...none, isModerator: true, isVerifiedVendor: true }),
    "moderator",
  );
  assert.equal(
    resolveAuthorBadge({ isAdmin: true, isModerator: true, isVerifiedVendor: true }),
    "admin",
  );
});

test("authors are named from stored fields and never invented", () => {
  assert.equal(authorLabel(message({ user_id: VIEWER }), VIEWER), "You");
  assert.equal(authorLabel(message(), VIEWER), "Amina Carter");
  assert.equal(authorLabel(message({ author_display_name: " " }), VIEWER), "@amina");
  assert.equal(
    authorLabel(message({ author_display_name: null, author_handle: null }), null),
    `Member ${OTHER.slice(0, 6)}`,
  );
  assert.equal(authorInitials(message()), "AC");
  assert.equal(authorInitials(message({ author_display_name: null })), "A");
  assert.equal(
    authorInitials(message({ author_display_name: null, author_handle: null })),
    OTHER.slice(0, 2).toUpperCase(),
  );
});

test("avatars render only from https URLs or the app's own image files", () => {
  assert.equal(
    avatarSource(message({ author_avatar_url: "https://cdn.example.com/a.png" })),
    "https://cdn.example.com/a.png",
  );
  assert.equal(avatarSource(message({ author_avatar_url: "javascript:alert(1)" })), null);
  assert.equal(avatarSource(message({ author_avatar_url: "http://insecure.example/a.png" })), null);
  assert.equal(avatarSource(message({ author_avatar_url: "  " })), null);
  assert.equal(avatarSource(message()), null);

  // Same-origin image files served from public/, such as seeded avatars.
  assert.equal(
    avatarSource(message({ author_avatar_url: "/seed-avatars/dana.svg" })),
    "/seed-avatars/dana.svg",
  );
  // A protocol-relative URL points at another host.
  assert.equal(avatarSource(message({ author_avatar_url: "//evil.example/a.png" })), null);
  assert.equal(avatarSource(message({ author_avatar_url: "/../secrets/a.png" })), null);
  assert.equal(avatarSource(message({ author_avatar_url: "/api/internal/ops/health" })), null);
  assert.equal(avatarSource(message({ author_avatar_url: "data:image/svg+xml,<svg/>" })), null);
  assert.equal(
    avatarSource(message({ author_avatar_url: `https://cdn.example.com/${"a".repeat(3000)}.png` })),
    null,
  );
});

test("a new message carries the member's https account photo when there is one", () => {
  assert.equal(
    avatarFromAccountMetadata({ avatar_url: "https://lh3.googleusercontent.com/a/abc" }),
    "https://lh3.googleusercontent.com/a/abc",
  );
  assert.equal(
    avatarFromAccountMetadata({ picture: " https://lh3.googleusercontent.com/a/xyz " }),
    "https://lh3.googleusercontent.com/a/xyz",
  );
  assert.equal(avatarFromAccountMetadata({ avatar_url: "http://insecure.example/a.png" }), null);
  assert.equal(avatarFromAccountMetadata({ avatar_url: 42 }), null);
  assert.equal(avatarFromAccountMetadata({}), null);
  assert.equal(avatarFromAccountMetadata(null), null);

  assert.match(postFunction, /auth\.admin\.getUserById\(userId\)/);
  assert.match(postFunction, /author_avatar_url: authorAvatarUrl,/);
});

test("messages group by day and fold consecutive posts from one author", () => {
  const now = new Date("2026-09-16T20:00:00");
  const groups = groupMessages(
    [
      message({ id: "a", created_at: new Date("2026-09-15T09:00:00").toISOString() }),
      message({ id: "b", created_at: new Date("2026-09-16T09:00:00").toISOString() }),
      message({ id: "c", created_at: new Date("2026-09-16T09:01:00").toISOString() }),
      message({ id: "d", created_at: new Date("2026-09-16T09:30:00").toISOString() }),
      message({
        id: "e",
        user_id: VIEWER,
        created_at: new Date("2026-09-16T09:30:30").toISOString(),
      }),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Yesterday", "Today"],
  );
  assert.deepEqual(
    groups[1]!.messages.map((entry) => [entry.id, entry.continuesAuthor]),
    [
      ["b", false],
      ["c", true],
      ["d", false],
      ["e", false],
    ],
  );
  assert.equal(groupMessages([], now).length, 0);
});

test("rooms sort by the admin's display order, then by name", () => {
  const room = (overrides: Partial<CommunityRoomSummary>): CommunityRoomSummary => ({
    id: overrides.slug ?? "x",
    slug: "x",
    name: "X",
    description: null,
    access_policy: "signed_in",
    room_kind: "community",
    sort_order: 0,
    ...overrides,
  });
  const sorted = sortRooms([
    room({ slug: "deal-evaluation", name: "Deal Evaluation", sort_order: 4 }),
    room({ slug: "real-estate", name: "Real Estate", sort_order: 1 }),
    room({ slug: "general", name: "General", sort_order: 0 }),
    room({ slug: "accountabul-help", name: "Accountabul Help", sort_order: 1 }),
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.slug),
    ["general", "accountabul-help", "real-estate", "deal-evaluation"],
  );
});

test("members are told plainly who a room is for", () => {
  assert.match(describeRoomAudience("signed_in"), /every signed-in/);
  assert.match(describeRoomAudience("user_allowlist"), /private/i);
});

test("posting waits for the current chat policy to be accepted, per version", () => {
  assert.equal(policyAcceptanceRequired(null, []), false);
  assert.equal(policyAcceptanceRequired({ id: "v2" }, []), true);
  assert.equal(policyAcceptanceRequired({ id: "v2" }, ["v1"]), true);
  assert.equal(policyAcceptanceRequired({ id: "v2" }, ["v1", "v2"]), false);
});

test("posting requires a verified session and re-checks room access in the database", () => {
  assert.match(postFunction, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(postFunction, /rpc\(\s*"can_access_community_room"/);
  assert.match(postFunction, /_user_id: userId/);
  assert.match(postFunction, /if \(!accessResult\.data\) throw new Error/);
  assert.match(postFunction, /throwIfRateLimited\(/);
  // The user id comes from the verified token, never from the request payload.
  assert.doesNotMatch(postFunction, /input: \{[^}]*userId/);
});

test("chat publishes every accepted message immediately; screening runs afterwards", () => {
  // Published in the same request, with no pre-publication content check.
  assert.match(postFunction, /moderation_status: "approved",/);
  assert.match(postFunction, /published_at: now,/);
  assert.doesNotMatch(postFunction, /moderateComment|moderateWithProvider|communityPublishStatus/);
  assert.doesNotMatch(postFunction, /published_at: approved/);

  // Screening is scheduled after the insert, and cannot block the response.
  const insertAt = postFunction.indexOf('.from("community_messages")\n      .insert(');
  const screeningAt = postFunction.indexOf('runAfterResponse("community-chat-screening"');
  assert.ok(insertAt > 0 && screeningAt > insertAt);
  assert.doesNotMatch(postFunction, /await runAfterResponse/);

  // Nothing in the chat code or docs promises a moderator approval step.
  assert.doesNotMatch(postFunction, /held for review|awaiting approval|moderator approves/i);
});

test("hidden messages disappear for members through row level security", () => {
  assert.match(
    postModeration,
    /published_at is not null\s+and deleted_at is null\s+and hidden_at is null\s+and public\.can_access_community_room/,
  );
});

test("member reads select only columns the database grants to members", () => {
  const roomGrant = migration.match(/grant select \(\s*([^)]*)\) on public\.community_rooms/);
  const messageGrant = migration.match(/grant select \(\s*([^)]*)\) on public\.community_messages/);
  assert.ok(roomGrant && messageGrant);
  const granted = (list: string) => new Set(list.split(",").map((column) => column.trim()));
  const roomColumns = granted(roomGrant[1]!);
  const messageColumns = granted(messageGrant[1]!);

  const selects = [
    ...hooks.matchAll(/\.from\("(community_rooms|community_messages)"\)\s*\.select\(\s*"([^"]+)"/g),
  ];
  assert.equal(selects.length, 2);
  for (const [, table, columns] of selects) {
    const allowed = table === "community_rooms" ? roomColumns : messageColumns;
    for (const column of columns!.split(",").map((entry) => entry.trim())) {
      assert.ok(allowed.has(column), `${table}.${column} is not granted to members`);
    }
  }
});

test("the member rooms list is read from the database, not hard-coded", () => {
  assert.doesNotMatch(hooks, /Deal Evaluation|Vendor Network|Real Estate/);
  assert.match(header, /\{ to: "\/chat", label: "Chat" \}/);
});
