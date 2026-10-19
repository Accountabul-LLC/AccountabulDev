export type LiveHostRole = "admin" | "moderator";
export type DeviceCheck = "idle" | "ok" | "fail";

export type GreenRoomChecks = {
  camera: DeviceCheck;
  mic: DeviceCheck;
  speaker: DeviceCheck;
};

export function canHostLiveStudio(roles: readonly string[]) {
  return roles.includes("admin") || roles.includes("moderator");
}

export function hostStudioPath(slug: string) {
  return `/live/${encodeURIComponent(slug)}/studio`;
}

export function hostStudioUrl(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}${hostStudioPath(slug)}`;
}

export function greenRoomIsReady(checks: GreenRoomChecks) {
  return checks.camera === "ok" && checks.mic === "ok" && checks.speaker === "ok";
}

export function eventIsPublicLive(status: string) {
  return status === "live";
}
