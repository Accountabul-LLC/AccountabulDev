import { DEFAULT_HOST_PRESET, DEFAULT_VIEWER_PRESET } from "@/lib/conference/live-session";

/**
 * Cloudflare RealtimeKit REST client.
 *
 * SECURITY: the app id and API token are server-only and are never returned to
 * the browser. The browser only ever receives a participant-scoped auth token,
 * and only after the caller's event entitlement has been checked.
 */

const DEFAULT_BASE_URL = "https://api.realtime.cloudflare.com/v2";

export type RealtimeKitConfig = {
  baseUrl: string;
  appId: string;
  apiToken: string;
  hostPreset: string;
  viewerPreset: string;
};

export function readRealtimeKitConfig(env = process.env): RealtimeKitConfig {
  const appId = env["CLOUDFLARE_REALTIMEKIT_APP_ID"];
  const apiToken = env["CLOUDFLARE_REALTIMEKIT_API_TOKEN"];
  const missing = [
    ...(appId ? [] : ["CLOUDFLARE_REALTIMEKIT_APP_ID"]),
    ...(apiToken ? [] : ["CLOUDFLARE_REALTIMEKIT_API_TOKEN"]),
  ];
  if (missing.length) {
    throw new Error(
      `Accountabul Live media is not configured. Set ${missing.join(", ")} in the server environment.`,
    );
  }
  return {
    baseUrl: (env["CLOUDFLARE_REALTIMEKIT_BASE_URL"] || DEFAULT_BASE_URL).replace(/\/$/, ""),
    appId: appId!,
    apiToken: apiToken!,
    hostPreset: env["CLOUDFLARE_REALTIMEKIT_HOST_PRESET"] || DEFAULT_HOST_PRESET,
    viewerPreset: env["CLOUDFLARE_REALTIMEKIT_VIEWER_PRESET"] || DEFAULT_VIEWER_PRESET,
  };
}

export function realtimeKitIsConfigured(env = process.env) {
  return Boolean(env["CLOUDFLARE_REALTIMEKIT_APP_ID"] && env["CLOUDFLARE_REALTIMEKIT_API_TOKEN"]);
}

export function realtimeKitAuthorizationHeader(config: RealtimeKitConfig) {
  return `Basic ${Buffer.from(`${config.appId}:${config.apiToken}`).toString("base64")}`;
}

async function realtimeKitFetch<T>(
  config: RealtimeKitConfig,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: realtimeKitAuthorizationHeader(config),
      "Content-Type": "application/json",
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    // Never echo the provider body verbatim; it can carry request metadata.
    throw new Error(`RealtimeKit request failed (${response.status}) for ${path}.`);
  }

  const parsed = text ? (JSON.parse(text) as { data?: T; success?: boolean }) : {};
  if (parsed.data === undefined) {
    throw new Error(`RealtimeKit returned no data for ${path}.`);
  }
  return parsed.data;
}

export async function createLiveMeeting(
  title: string,
  config = readRealtimeKitConfig(),
): Promise<string> {
  const data = await realtimeKitFetch<{ id: string }>(config, "/meetings", {
    method: "POST",
    body: {
      title: title.slice(0, 120),
      preferred_region: "us-east-1",
      record_on_start: false,
    },
  });
  if (!data.id) throw new Error("RealtimeKit did not return a meeting id.");
  return data.id;
}

export type IssuedParticipantToken = {
  participantId: string;
  authToken: string;
  meetingId: string;
};

/**
 * Adds (or re-adds) a participant and returns their auth token. The preset is
 * chosen by the server from the caller's role, never supplied by the browser.
 */
export async function issueParticipantToken(
  input: { meetingId: string; userId: string; displayName: string; role: "host" | "viewer" },
  config = readRealtimeKitConfig(),
): Promise<IssuedParticipantToken> {
  const data = await realtimeKitFetch<{ id: string; token: string }>(
    config,
    `/meetings/${encodeURIComponent(input.meetingId)}/participants`,
    {
      method: "POST",
      body: {
        name: input.displayName.slice(0, 80),
        preset_name: input.role === "host" ? config.hostPreset : config.viewerPreset,
        custom_participant_id: input.userId,
      },
    },
  );
  if (!data.token) throw new Error("RealtimeKit did not return a participant token.");
  return { participantId: data.id, authToken: data.token, meetingId: input.meetingId };
}

/** Host-only stage control: let a named participant publish. */
export async function grantStageAccess(
  meetingId: string,
  participantIds: readonly string[],
  config = readRealtimeKitConfig(),
) {
  await realtimeKitFetch<unknown>(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/participants/stage/grant`,
    { method: "POST", body: { participantIds: [...participantIds] } },
  );
}

/** Host-only stage control: return a caller to the audience, still in the room. */
export async function revokeStageAccess(
  meetingId: string,
  participantIds: readonly string[],
  config = readRealtimeKitConfig(),
) {
  await realtimeKitFetch<unknown>(
    config,
    `/meetings/${encodeURIComponent(meetingId)}/participants/stage/kick`,
    { method: "POST", body: { participantIds: [...participantIds] } },
  );
}
