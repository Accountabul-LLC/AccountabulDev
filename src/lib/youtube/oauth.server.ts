import { supabaseAdmin } from "@/integrations/supabase/client.server";
// Generic AES-256-GCM helpers; the Restream name is historical.
import { decryptRestreamToken, encryptRestreamToken } from "@/lib/restream/tokens";
import { normalizeGoogleTokenResponse, type GoogleTokenResponse } from "@/lib/youtube/tokens";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PROVIDER = "youtube";
const ENVIRONMENT = "live";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export async function exchangeYouTubeCode(code: string, redirectUri: string) {
  return normalizeGoogleTokenResponse(
    await requestTokens(
      new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    ),
  );
}

export async function getFreshYouTubeAccessToken() {
  const { data, error } = await supabaseAdmin.rpc("private_get_provider_connection", {
    p_provider: PROVIDER,
    p_environment: ENVIRONMENT,
  });
  if (error) throw error;
  const connection = data?.[0];
  if (
    !connection?.access_token_ciphertext ||
    !connection.access_token_iv ||
    !connection.refresh_token_ciphertext ||
    !connection.refresh_token_iv
  ) {
    throw new Error("YouTube OAuth is not connected.");
  }
  const key = requiredEnv("YOUTUBE_TOKEN_ENCRYPTION_KEY");
  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (expiresAt > Date.now() + 5 * 60_000) {
    return {
      accessToken: await decryptRestreamToken(
        connection.access_token_ciphertext,
        connection.access_token_iv,
        key,
      ),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
  const refreshToken = await decryptRestreamToken(
    connection.refresh_token_ciphertext,
    connection.refresh_token_iv,
    key,
  );
  const tokens = normalizeGoogleTokenResponse(
    await requestTokens(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    ),
    refreshToken,
  );
  await storeYouTubeTokens(tokens);
  return { accessToken: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
}

export async function storeYouTubeTokens(tokens: ReturnType<typeof normalizeGoogleTokenResponse>) {
  const key = requiredEnv("YOUTUBE_TOKEN_ENCRYPTION_KEY");
  const [access, refresh] = await Promise.all([
    encryptRestreamToken(tokens.accessToken, key),
    encryptRestreamToken(tokens.refreshToken, key),
  ]);
  const { error } = await supabaseAdmin.rpc("private_upsert_provider_connection", {
    p_provider: PROVIDER,
    p_environment: ENVIRONMENT,
    p_secret_reference: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    p_access_token_ciphertext: access.ciphertext,
    p_access_token_iv: access.iv,
    p_refresh_token_ciphertext: refresh.ciphertext,
    p_refresh_token_iv: refresh.iv,
    p_access_token_expires_at: tokens.accessTokenExpiresAt,
    // Google does not report refresh-token expiry; in Testing mode it lapses after 7 days.
    p_refresh_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    p_granted_scopes: tokens.scopes,
  });
  if (error) throw error;
}

async function requestTokens(body: URLSearchParams) {
  body.set("client_id", requiredEnv("YOUTUBE_CLIENT_ID"));
  body.set("client_secret", requiredEnv("YOUTUBE_CLIENT_SECRET"));
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as GoogleTokenResponse & { error_description?: string };
  if (!response.ok) {
    throw new Error(
      payload.error_description || `Google token request failed (${response.status}).`,
    );
  }
  return payload;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
