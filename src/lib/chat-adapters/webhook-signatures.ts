// Webhook authenticity for platform chat. WebCrypto only, so it runs in Workers and Node.

import { bytesToHex } from "../security/hex.ts";
import { constantTimeEqual } from "../security/constant-time.ts";

const encoder = new TextEncoder();
// Twitch recommends rejecting anything older than 10 minutes to stop replays.
const MAX_AGE_MS = 10 * 60_000;

export function isFreshTimestamp(value: string, nowMs = Date.now()) {
  const time = Date.parse(value);
  return Number.isFinite(time) && Math.abs(nowMs - time) <= MAX_AGE_MS;
}

/** Twitch EventSub: HMAC-SHA256(secret, id + timestamp + body), header `sha256=<hex>`. */
export async function verifyTwitchSignature(options: {
  secret: string;
  messageId: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}) {
  if (!options.secret || !options.messageId || !options.signature) return false;
  if (!isFreshTimestamp(options.timestamp, options.nowMs)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(options.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(options.messageId + options.timestamp + options.rawBody),
  );
  return constantTimeEqual(`sha256=${bytesToHex(new Uint8Array(digest))}`, options.signature);
}

function pemToDer(pem: string) {
  const base64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** Kick: RSASSA-PKCS1-v1_5 SHA-256 over `${messageId}.${timestamp}.${body}`, base64 signature. */
export async function verifyKickSignature(options: {
  publicKeyPem: string;
  messageId: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowMs?: number;
}) {
  if (!options.publicKeyPem || !options.messageId || !options.signature) return false;
  if (!isFreshTimestamp(options.timestamp, options.nowMs)) return false;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(options.publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      Uint8Array.from(atob(options.signature), (char) => char.charCodeAt(0)),
      encoder.encode(`${options.messageId}.${options.timestamp}.${options.rawBody}`),
    );
  } catch {
    return false;
  }
}
