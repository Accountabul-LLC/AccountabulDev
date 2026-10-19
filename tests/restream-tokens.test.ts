import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptRestreamToken,
  encryptRestreamToken,
  normalizeRestreamTokenResponse,
} from "../src/lib/restream/tokens.ts";

test("normalizes official Restream token fields, expirations, and scopes", () => {
  const now = Date.parse("2026-08-26T12:00:00.000Z");
  const tokens = normalizeRestreamTokenResponse(
    {
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      refreshTokenExpiresIn: 7200,
      scope: "profile.read,channels.read chat.read profile.read",
    },
    now,
  );

  assert.deepEqual(tokens, {
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: "2026-08-26T13:00:00.000Z",
    refreshTokenExpiresAt: "2026-08-26T14:00:00.000Z",
    scopes: ["profile.read", "channels.read", "chat.read"],
  });
});

test("rejects incomplete Restream token pairs", () => {
  assert.throws(
    () => normalizeRestreamTokenResponse({ access_token: "access" }),
    /incomplete token pair/,
  );
});

test("Restream tokens round-trip through AES-GCM and reject tampering", async () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = await encryptRestreamToken("sensitive-token", key);
  assert.equal(
    await decryptRestreamToken(encrypted.ciphertext, encrypted.iv, key),
    "sensitive-token",
  );

  const tampered = Buffer.from(encrypted.ciphertext, "base64");
  tampered[0] ^= 1;
  await assert.rejects(decryptRestreamToken(tampered.toString("base64"), encrypted.iv, key));
  await assert.rejects(
    encryptRestreamToken("token", Buffer.alloc(31).toString("base64")),
    /32-byte/,
  );
});
