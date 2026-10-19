export type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type YouTubeTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  scopes: string[];
};

/**
 * Google only returns a refresh_token on the first consent; a refresh grant
 * omits it, so the caller passes the refresh token it already holds.
 */
export function normalizeGoogleTokenResponse(
  payload: GoogleTokenResponse,
  existingRefreshToken?: string,
  nowMs = Date.now(),
): YouTubeTokens {
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token || existingRefreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error("Google returned an incomplete token pair.");
  }
  const seconds =
    typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 3600;
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(nowMs + seconds * 1000).toISOString(),
    scopes: [...new Set(payload.scope?.split(/\s+/) ?? [])].filter(Boolean),
  };
}
