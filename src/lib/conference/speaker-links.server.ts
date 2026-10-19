export async function createProtectedSpeakerLink(guestUrl: string) {
  const parsed = new URL(guestUrl);
  if (
    parsed.protocol !== "https:" ||
    !(parsed.hostname === "restream.io" || parsed.hostname.endsWith(".restream.io"))
  ) {
    throw new Error("Speaker guest URL must be an HTTPS Restream URL.");
  }
  const key = await loadKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(parsed.toString()),
  );
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64Url(tokenBytes);
  return {
    token,
    ciphertext: base64Url(new Uint8Array(encrypted)),
    iv: base64Url(iv),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export async function decryptSpeakerLink(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv) },
    await loadKey(),
    fromBase64Url(ciphertext),
  );
  const value = new TextDecoder().decode(decrypted);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    !(parsed.hostname === "restream.io" || parsed.hostname.endsWith(".restream.io"))
  ) {
    throw new Error("Stored speaker URL is invalid.");
  }
  return parsed.toString();
}

async function loadKey() {
  const encoded = process.env["SPEAKER_LINK_SECRET"];
  if (!encoded) throw new Error("SPEAKER_LINK_SECRET is not configured.");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) throw new Error("SPEAKER_LINK_SECRET must encode exactly 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
