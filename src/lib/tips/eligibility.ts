const TIPPABLE_STATUSES = new Set(["scheduled", "live"]);

export function eventAcceptsTips(event: { tips_enabled: boolean; status: string }) {
  return event.tips_enabled && TIPPABLE_STATUSES.has(event.status);
}
