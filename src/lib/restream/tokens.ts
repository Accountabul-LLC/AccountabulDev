export type RestreamTokenResponse = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  accessTokenExpiresIn?: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
  scopeJson?: string[];
};

export type RestreamTokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  scopes: string[];
};

export function normalizeRestreamTokenResponse(
  payload: RestreamTokenResponse,
  nowMs = Date.now(),
): RestreamTokenPair {
  const accessToken = payload.access_token || payload.accessToken;
  const refreshToken = payload.refresh_token || payload.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error("Restream returned an incomplete token pair.");
  }

  const accessSeconds = positiveSeconds(
    payload.expires_in ?? payload.accessTokenExpiresIn,
    60 * 60,
  );
  const refreshSeconds = positiveSeconds(payload.refreshTokenExpiresIn, 365 * 24 * 60 * 60);
  const scopes = [...new Set(payload.scopeJson ?? payload.scope?.split(/[ ,]+/) ?? [])].filter(
    Boolean,
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(nowMs + accessSeconds * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(nowMs + refreshSeconds * 1000).toISOString(),
    scopes,
  };
}

export async function encryptRestreamToken(value: string, base64Key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importRestreamEncryptionKey(base64Key),
    new TextEncoder().encode(value),
  );
  return {
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

export async function decryptRestreamToken(ciphertext: string, iv: string, base64Key: string) {
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    await importRestreamEncryptionKey(base64Key),
    Buffer.from(ciphertext, "base64"),
  );
  return new TextDecoder().decode(clear);
}

async function importRestreamEncryptionKey(base64Key: string) {
  const raw = Buffer.from(base64Key, "base64");
  if (raw.byteLength !== 32) {
    throw new Error("RESTREAM_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function positiveSeconds(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
