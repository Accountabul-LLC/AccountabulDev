import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  normalizeKickChatMessage,
  normalizeTwitchChatMessage,
} from "../src/lib/chat-adapters/normalize.ts";
import {
  verifyKickSignature,
  verifyTwitchSignature,
} from "../src/lib/chat-adapters/webhook-signatures.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const STAMP = "2026-09-23T11:59:30.000Z";

test("normalizes a Kick chat.message.sent body", () => {
  const message = normalizeKickChatMessage(
    {
      message_id: "k1",
      broadcaster: { user_id: 42 },
      sender: { username: "kai", profile_picture: "https://example.com/k.png" },
      content: " gm ",
      created_at: "2026-09-23T11:59:00Z",
    },
    EVENT,
  );
  assert.deepEqual(message, {
    eventId: EVENT,
    source: "kick",
    externalId: "kick:k1",
    authorDisplayName: "kai",
    authorAvatarUrl: "https://example.com/k.png",
    body: "gm",
    sourceCreatedAt: "2026-09-23T11:59:00.000Z",
  });
  assert.equal(normalizeKickChatMessage({ message_id: "k2", content: "  " }, EVENT), null);
});

test("Twitch webhook bodies take the timestamp from the header", () => {
  const message = normalizeTwitchChatMessage(
    { event: { message_id: "t1", chatter_user_name: "Sam", message: { text: "yo" } } },
    EVENT,
    STAMP,
  );
  assert.equal(message?.sourceCreatedAt, STAMP);
});

test("verifies Twitch HMAC and rejects tampering and replays", async () => {
  const secret = "s3cret-value-for-tests";
  const rawBody = '{"event":{}}';
  const signature =
    "sha256=" +
    createHmac("sha256", secret)
      .update("id1" + STAMP + rawBody)
      .digest("hex");
  const base = { secret, messageId: "id1", timestamp: STAMP, rawBody, signature, nowMs: NOW };
  assert.equal(await verifyTwitchSignature(base), true);
  assert.equal(await verifyTwitchSignature({ ...base, rawBody: '{"event":{"x":1}}' }), false);
  assert.equal(await verifyTwitchSignature({ ...base, nowMs: NOW + 11 * 60_000 }), false);
  assert.equal(await verifyTwitchSignature({ ...base, signature: "" }), false);
});

test("verifies Kick RSA signatures against the pinned key", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const rawBody = '{"message_id":"k1"}';
  const signature = sign("sha256", Buffer.from(`m1.${STAMP}.${rawBody}`), privateKey).toString(
    "base64",
  );
  const base = { publicKeyPem, messageId: "m1", timestamp: STAMP, rawBody, signature, nowMs: NOW };
  assert.equal(await verifyKickSignature(base), true);
  assert.equal(await verifyKickSignature({ ...base, messageId: "m2" }), false);
  assert.equal(await verifyKickSignature({ ...base, signature: "bm90LWEtc2ln" }), false);
  assert.equal(await verifyKickSignature({ ...base, publicKeyPem: "garbage" }), false);
});
