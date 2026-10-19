import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptRestreamToken,
  encryptRestreamToken,
  normalizeRestreamTokenResponse,
  type RestreamTokenResponse,
} from "@/lib/restream/tokens";

const TOKEN_ENDPOINT = "https://api.restream.io/oauth/token";

export async function exchangeRestreamCode(code: string, redirectUri: string) {
  return requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

export async function getFreshRestreamAccessToken() {
  const { data, error } = await supabaseAdmin.rpc("private_get_provider_connection", {
    p_provider: "restream",
    p_environment: "live",
  });
  if (error) throw error;
  const connection = data?.[0];
  if (!connection?.access_token_ciphertext || !connection.access_token_iv) {
    throw new Error("Restream OAuth is not connected.");
  }
  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 5 * 60_000) {
    return {
      accessToken: await decryptRestreamToken(
        connection.access_token_ciphertext,
        connection.access_token_iv,
        requiredEnv("RESTREAM_TOKEN_ENCRYPTION_KEY"),
      ),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  if (!connection.refresh_token_ciphertext || !connection.refresh_token_iv) {
    throw new Error("Restream refresh token is unavailable.");
  }
  const refreshToken = await decryptRestreamToken(
    connection.refresh_token_ciphertext,
    connection.refresh_token_iv,
    requiredEnv("RESTREAM_TOKEN_ENCRYPTION_KEY"),
  );
  const tokens = await requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  await storeRestreamTokens(tokens);
  return { accessToken: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
}

export async function storeRestreamTokens(tokens: Awaited<ReturnType<typeof requestTokens>>) {
  const encryptionKey = requiredEnv("RESTREAM_TOKEN_ENCRYPTION_KEY");
  const [access, refresh] = await Promise.all([
    encryptRestreamToken(tokens.accessToken, encryptionKey),
    encryptRestreamToken(tokens.refreshToken, encryptionKey),
  ]);
  const { error } = await supabaseAdmin.rpc("private_upsert_provider_connection", {
    p_provider: "restream",
    p_environment: "live",
    p_secret_reference: "RESTREAM_TOKEN_ENCRYPTION_KEY",
    p_access_token_ciphertext: access.ciphertext,
    p_access_token_iv: access.iv,
    p_refresh_token_ciphertext: refresh.ciphertext,
    p_refresh_token_iv: refresh.iv,
    p_access_token_expires_at: tokens.accessTokenExpiresAt,
    p_refresh_token_expires_at: tokens.refreshTokenExpiresAt,
    p_granted_scopes: tokens.scopes,
  });
  if (error) throw error;
}

async function requestTokens(body: URLSearchParams) {
  const clientId = requiredEnv("RESTREAM_CLIENT_ID");
  const clientSecret = requiredEnv("RESTREAM_CLIENT_SECRET");
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json()) as RestreamTokenResponse & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `Restream token request failed (${response.status}).`,
    );
  }
  return normalizeRestreamTokenResponse(payload);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
