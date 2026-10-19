// Ported from property-intelligence-app's app/lib/nationwide-ingestion-health-delivery.ts
// (Slice 2 of the nationwide multi-state ingestion port). The source's
// `executeNextNationwideHealthDelivery` claims one queued outbox row inside
// a database transaction and calls an injected delivery sink
// (nationwide-health-webhook-sink.ts, a real HTTP POST). This slice ports
// the OUTBOX DRAIN decision logic -- given a queue of pending notifications,
// which one is next, and how a delivery attempt's outcome (success, or an
// error under/over the retry budget) should update that queue -- without any
// database.
//
// The delivery sink is an injected dependency with NO default: `deliver` is
// a required field on `NationwideHealthDeliverySink`, so a caller MUST
// explicitly construct and pass a real sink (e.g. a webhook POST) for any
// delivery to happen at all. Nothing in this repo constructs one, so it is
// structurally impossible for this module to make an HTTP request on its
// own -- the same injection pattern nationwide-r2-artifact-store.ts /
// nationwide-supabase-artifact-store.ts use for their storage binding, and
// nationwide-source-executor-registry.ts uses for its adapter bindings.
import type { NationwideIngestionIncidentTransition } from "./nationwide-ingestion-health-monitor.ts";

export type NationwideHealthOutboxEntry = {
  outboxId: string;
  idempotencyKey: string;
  transition: NationwideIngestionIncidentTransition;
  status: "queued" | "succeeded" | "failed";
  claimCount: number;
  enqueuedAt: string;
  availableAt: string;
  providerDeliveryId: string | null;
  errorSummary: string | null;
};

export type NationwideHealthNotification = NationwideIngestionIncidentTransition & {
  claimCount: number;
  enqueuedAt: string;
};

export type NationwideHealthDeliverySink = {
  deliver(input: {
    notification: NationwideHealthNotification;
    idempotencyKey: string;
  }): Promise<void | { providerDeliveryId?: string }>;
};

export type NationwideHealthDeliveryOutcome =
  | { status: "idle" }
  | {
      status: "succeeded" | "retry_scheduled" | "failed";
      outboxId: string;
      providerDeliveryId: string | null;
      errorSummary: string | null;
      availableAt: string | null;
    };

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

// Which queued outbox entry should be attempted next: earliest-available,
// earliest-enqueued, ties broken by outboxId -- a stable, side-effect-free
// selection any caller (this repo's or the source's) can reuse before
// claiming a row for real.
export function selectNextNationwideHealthDelivery(
  queue: readonly NationwideHealthOutboxEntry[],
  now: string,
): NationwideHealthOutboxEntry | null {
  canonicalUtc(now, "now");
  const ready = queue.filter((entry) => entry.status === "queued" && entry.availableAt <= now);
  if (ready.length === 0) return null;
  return [...ready].sort(
    (left, right) =>
      left.availableAt.localeCompare(right.availableAt) ||
      left.enqueuedAt.localeCompare(right.enqueuedAt) ||
      left.outboxId.localeCompare(right.outboxId),
  )[0]!;
}

function retryDelaySeconds(claimCount: number, baseDelaySeconds: number) {
  // Exponential backoff, capped at one hour, matching the source's retry
  // cadence intent (claimCount 1 -> base, 2 -> 2x, 3 -> 4x, ...).
  return Math.min(baseDelaySeconds * 2 ** Math.max(0, claimCount - 1), 3_600);
}

// Attempt delivery of the next ready outbox entry via the (required,
// injected) sink, and report the plan for how the queue should be updated --
// this does not mutate `queue` itself; a caller applies the outcome to its
// own persisted state.
export async function deliverNextNationwideHealthNotification(input: {
  queue: readonly NationwideHealthOutboxEntry[];
  sink: NationwideHealthDeliverySink;
  now: string;
  maxAttempts?: number;
  retryDelaySeconds?: number;
  safeErrorSummary?: (error: unknown) => string;
}): Promise<NationwideHealthDeliveryOutcome> {
  const now = canonicalUtc(input.now, "now");
  const maxAttempts = input.maxAttempts ?? 5;
  const baseDelaySeconds = input.retryDelaySeconds ?? 60;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error("maxAttempts must be a positive integer");
  if (!Number.isInteger(baseDelaySeconds) || baseDelaySeconds < 1) {
    throw new Error("retryDelaySeconds must be a positive integer");
  }
  const entry = selectNextNationwideHealthDelivery(input.queue, now);
  if (!entry) return { status: "idle" };

  const claimCount = entry.claimCount + 1;
  const notification: NationwideHealthNotification = {
    ...entry.transition,
    claimCount,
    enqueuedAt: entry.enqueuedAt,
  };
  try {
    const result = await input.sink.deliver({ notification, idempotencyKey: entry.idempotencyKey });
    const providerDeliveryId =
      result && "providerDeliveryId" in result ? (result.providerDeliveryId ?? null) : null;
    return {
      status: "succeeded",
      outboxId: entry.outboxId,
      providerDeliveryId,
      errorSummary: null,
      availableAt: null,
    };
  } catch (error) {
    const summary = input.safeErrorSummary
      ? input.safeErrorSummary(error)
      : error instanceof Error
        ? error.message
        : "health delivery failed";
    if (claimCount >= maxAttempts) {
      return {
        status: "failed",
        outboxId: entry.outboxId,
        providerDeliveryId: null,
        errorSummary: summary,
        availableAt: null,
      };
    }
    const availableAt = new Date(
      Date.parse(now) + retryDelaySeconds(claimCount, baseDelaySeconds) * 1_000,
    ).toISOString();
    return {
      status: "retry_scheduled",
      outboxId: entry.outboxId,
      providerDeliveryId: null,
      errorSummary: summary,
      availableAt,
    };
  }
}
