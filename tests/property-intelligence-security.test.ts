import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { findActiveLiveChatId, pollOnce } from "../src/lib/youtube/chat-poller.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";

function fakeFetch(body: unknown) {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

test("ACC-20260923-001: a YouTube mapping only resolves its own channel's broadcast", async () => {
  const broadcasts = {
    items: [
      { snippet: { channelId: "UC-alpha", liveChatId: "chat-alpha" } },
      { snippet: { channelId: "UC-bravo", liveChatId: "chat-bravo" } },
    ],
  };
  assert.equal(await findActiveLiveChatId(fakeFetch(broadcasts), "t", "UC-bravo"), "chat-bravo");
  assert.equal(await findActiveLiveChatId(fakeFetch(broadcasts), "t", "UC-other"), null);
  assert.equal(await findActiveLiveChatId(fakeFetch(broadcasts), "t", ""), null);
});

test("ACC-20260923-002: one failing message does not pin the YouTube cursor", async () => {
  const text = (id: string) => ({
    id,
    snippet: { type: "textMessageEvent", textMessageDetails: { messageText: `m ${id}` } },
    authorDetails: { displayName: "A" },
  });
  const seen: string[] = [];
  const result = await pollOnce({
    fetchFn: fakeFetch({ items: [text("a"), text("b"), text("c")], nextPageToken: "next" }),
    accessToken: "t",
    liveChatId: "chat",
    eventId: EVENT,
    pageToken: "start",
    ingest: async (message) => {
      if (message.externalId === "youtube:b") throw new Error("moderation down");
      seen.push(message.externalId);
    },
  });
  assert.deepEqual(seen, ["youtube:a", "youtube:c"]);
  assert.equal(result.failed, 1);
  assert.equal(result.nextPageToken, "next");
});

test("ACC-20260923-003: saved scenarios are capped per account in the database", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260923150000_property_deal_scenario_quota.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /before insert on public\.property_deal_scenarios/);
  assert.match(sql, />= 100 then/);
  assert.match(sql, /pg_advisory_xact_lock/);
  const fn = await readFile(
    new URL("../src/lib/property-intelligence/property-intelligence.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(fn, /property_deal_scenario_quota_exceeded/);
});
