import assert from "node:assert/strict";
import test from "node:test";

import { findActiveLiveChatId, pollOnce, type FetchLike } from "../src/lib/youtube/chat-poller.ts";
import type { NormalizedChatMessage } from "../src/lib/chat-adapters/normalize.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";

function textItem(id: string, text: string, at: string) {
  return {
    id,
    snippet: {
      type: "textMessageEvent",
      publishedAt: at,
      textMessageDetails: { messageText: text },
    },
    authorDetails: { displayName: `user-${id}`, profileImageUrl: "" },
  };
}

// A scripted "YouTube": returns pages in order and records every request it saw.
function fakeYouTube(pages: unknown[]) {
  const requests: string[] = [];
  const headers: Array<Record<string, string> | undefined> = [];
  let index = 0;
  const fetchFn: FetchLike = async (url, init) => {
    requests.push(url);
    headers.push(init?.headers);
    const body = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchFn, requests, headers };
}

test("finds the live chat id of the active broadcast, or null when not live", async () => {
  const live = fakeYouTube([{ items: [{ snippet: { channelId: "UC-1", liveChatId: "chat-1" } }] }]);
  assert.equal(await findActiveLiveChatId(live.fetchFn, "tok", "UC-1"), "chat-1");
  assert.match(live.requests[0]!, /broadcastStatus=active/);
  assert.equal(live.headers[0]?.["Authorization"], "Bearer tok");
  const offline = fakeYouTube([{ items: [] }]);
  assert.equal(await findActiveLiveChatId(offline.fetchFn, "tok", "UC-1"), null);
});

test("polls pages in order, advances the cursor, and drops non-text events", async () => {
  const yt = fakeYouTube([
    {
      items: [
        textItem("a", "first", "2026-09-21T10:00:00Z"),
        { id: "s", snippet: { type: "superChatEvent" } },
      ],
      nextPageToken: "tok-2",
      pollingIntervalMillis: 6000,
    },
    { items: [textItem("b", "second", "2026-09-21T10:00:05Z")], nextPageToken: "tok-3" },
  ]);
  const seen: NormalizedChatMessage[] = [];
  const ingest = async (message: NormalizedChatMessage) => void seen.push(message);

  const first = await pollOnce({
    fetchFn: yt.fetchFn,
    accessToken: "tok",
    liveChatId: "chat-1",
    eventId: EVENT,
    pageToken: null,
    ingest,
  });
  assert.equal(first.ingested, 1);
  assert.equal(first.nextPageToken, "tok-2");
  assert.equal(first.waitMs, 6000);
  assert.doesNotMatch(yt.requests[0]!, /pageToken/);

  const second = await pollOnce({
    fetchFn: yt.fetchFn,
    accessToken: "tok",
    liveChatId: "chat-1",
    eventId: EVENT,
    pageToken: first.nextPageToken,
    ingest,
  });
  assert.match(yt.requests[1]!, /pageToken=tok-2/);
  assert.equal(second.nextPageToken, "tok-3");
  assert.deepEqual(
    seen.map((m) => [m.externalId, m.body, m.source]),
    [
      ["youtube:a", "first", "youtube"],
      ["youtube:b", "second", "youtube"],
    ],
  );
});

test("never polls faster than the quota-safe floor and keeps the cursor on empty pages", async () => {
  const yt = fakeYouTube([{ items: [], pollingIntervalMillis: 200 }]);
  const result = await pollOnce({
    fetchFn: yt.fetchFn,
    accessToken: "tok",
    liveChatId: "chat-1",
    eventId: EVENT,
    pageToken: "keep-me",
    ingest: async () => {},
  });
  assert.equal(result.waitMs, 5000);
  assert.equal(result.nextPageToken, "keep-me");
  assert.equal(result.ingested, 0);
});

test("surfaces API failures instead of swallowing them", async () => {
  const fetchFn: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    () =>
      pollOnce({
        fetchFn,
        accessToken: "tok",
        liveChatId: "chat-1",
        eventId: EVENT,
        pageToken: null,
        ingest: async () => {},
      }),
    /403/,
  );
});
