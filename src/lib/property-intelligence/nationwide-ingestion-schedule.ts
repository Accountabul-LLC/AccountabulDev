// Ported from property-intelligence-app's app/lib/nationwide-ingestion-schedule.ts
// (Slice 2 of the nationwide multi-state ingestion port). Pure cadence
// decision logic: given a source manifest, the current time, and the last
// scheduled slot (if any), which slots are due now and how large is the
// remaining catch-up backlog. It never reads or writes a database itself --
// the source's `planRegisteredNationwideSchedule` (which looks up
// `lastScheduledFor` via a PostgresTransactionHost) is NOT ported here for
// that reason; a caller supplies `lastScheduledFor` directly, matching this
// slice's "given a manifest + run history, what should run next" scope.
import {
  validateNationwideSourceManifest,
  type NationwideSourceManifest,
} from "./nationwide-source-manifest.ts";

export type NationwideSchedulePlan = {
  sourceKey: string;
  dueScheduledFor: string[];
  backlogRemaining: number;
};

function canonicalUtc(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return date;
}

// Inactive sources, and sources on a manual schedule, are never scheduled --
// no due slots, no backlog, regardless of how much time has passed.
export function planNationwideSchedule(input: {
  manifest: NationwideSourceManifest;
  now: string;
  lastScheduledFor?: string | null;
}): NationwideSchedulePlan {
  const manifest = validateNationwideSourceManifest(input.manifest);
  const now = canonicalUtc(input.now, "now");
  if (!manifest.active || manifest.schedulePolicy.mode === "manual") {
    return { sourceKey: manifest.sourceKey, dueScheduledFor: [], backlogRemaining: 0 };
  }
  const anchor = canonicalUtc(manifest.schedulePolicy.anchorUtc, "schedulePolicy.anchorUtc");
  const intervalMs = manifest.schedulePolicy.intervalMinutes * 60_000;
  if (now.valueOf() < anchor.valueOf()) {
    return { sourceKey: manifest.sourceKey, dueScheduledFor: [], backlogRemaining: 0 };
  }
  const latestSlotIndex = Math.floor((now.valueOf() - anchor.valueOf()) / intervalMs);
  let firstSlotIndex = latestSlotIndex;
  if (input.lastScheduledFor) {
    const last = canonicalUtc(input.lastScheduledFor, "lastScheduledFor");
    const offset = last.valueOf() - anchor.valueOf();
    if (offset < 0 || offset % intervalMs !== 0) {
      throw new Error("lastScheduledFor is not aligned to the source schedule");
    }
    firstSlotIndex = offset / intervalMs + 1;
  }
  if (firstSlotIndex > latestSlotIndex) {
    return { sourceKey: manifest.sourceKey, dueScheduledFor: [], backlogRemaining: 0 };
  }
  const totalDue = latestSlotIndex - firstSlotIndex + 1;
  const plannedCount = Math.min(totalDue, manifest.schedulePolicy.catchUpLimit);
  const dueScheduledFor = Array.from({ length: plannedCount }, (_, index) =>
    new Date(anchor.valueOf() + (firstSlotIndex + index) * intervalMs).toISOString(),
  );
  return {
    sourceKey: manifest.sourceKey,
    dueScheduledFor,
    backlogRemaining: totalDue - plannedCount,
  };
}
