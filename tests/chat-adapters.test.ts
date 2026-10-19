import assert from "node:assert/strict";
import test from "node:test";

import {
  compareChat,
  normalizeFacebookLiveComment,
  normalizeTwitchChatMessage,
  normalizeYouTubeChatMessage,
} from "../src/lib/chat-adapters/normalize.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";

test("normalizes a Twitch EventSub chat frame", () => {
  const message = normalizeTwitchChatMessage(
    {
      metadata: { message_timestamp: "2026-09-20T12:00:00.000Z" },
      payload: {
        event: { message_id: "abc", chatter_user_name: "Sam", message: { text: " hello " } },
      },
    },
    EVENT,
  );
  assert.deepEqual(message, {
    eventId: EVENT,
    source: "twitch",
    externalId: "twitch:abc",
    authorDisplayName: "Sam",
    authorAvatarUrl: null,
    body: "hello",
    sourceCreatedAt: "2026-09-20T12:00:00.000Z",
  });
  assert.equal(normalizeTwitchChatMessage({ payload: { event: {} } }, EVENT), null);
});

test("normalizes YouTube text messages and drops other event types", () => {
  const item = {
    id: "yt1",
    snippet: {
      type: "textMessageEvent",
      publishedAt: "2026-09-20T12:00:01.000Z",
      textMessageDetails: { messageText: "hi there" },
    },
    authorDetails: { displayName: "Ana", profileImageUrl: "https://example.com/a.png" },
  };
  const message = normalizeYouTubeChatMessage(item, EVENT);
  assert.equal(message?.externalId, "youtube:yt1");
  assert.equal(message?.body, "hi there");
  assert.equal(message?.authorAvatarUrl, "https://example.com/a.png");
  assert.equal(
    normalizeYouTubeChatMessage(
      { ...item, snippet: { ...item.snippet, type: "superChatEvent" } },
      EVENT,
    ),
    null,
  );
});

test("normalizes Facebook comments with and without an author", () => {
  const withAuthor = normalizeFacebookLiveComment(
    { id: "f1", message: "yo", created_time: "2026-09-20T12:00:02+0000", from: { name: "Lee" } },
    EVENT,
  );
  assert.equal(withAuthor?.authorDisplayName, "Lee");
  assert.equal(withAuthor?.sourceCreatedAt, "2026-09-20T12:00:02.000Z");
  const anonymous = normalizeFacebookLiveComment({ id: "f2", message: "hey" }, EVENT);
  assert.equal(anonymous?.authorDisplayName, "Facebook viewer");
  assert.equal(normalizeFacebookLiveComment({ id: "f3", message: "  " }, EVENT), null);
});

test("caps body length and merges platforms in timestamp order", () => {
  const long = normalizeFacebookLiveComment({ id: "f4", message: "x".repeat(900) }, EVENT);
  assert.equal(long?.body.length, 500);
  const a = { sourceCreatedAt: "2026-09-20T12:00:02.000Z", externalId: "twitch:b" };
  const b = { sourceCreatedAt: "2026-09-20T12:00:01.000Z", externalId: "youtube:a" };
  const c = { sourceCreatedAt: "2026-09-20T12:00:02.000Z", externalId: "twitch:a" };
  assert.deepEqual(
    [a, b, c].sort(compareChat).map((m) => m.externalId),
    ["youtube:a", "twitch:a", "twitch:b"],
  );
});
