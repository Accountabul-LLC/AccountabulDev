// The dispatch worker tick, ported from the source app's
// app/lib/nationwide-dispatch-worker.ts.
//
// nationwide-postgres-dispatch-store.ts already carries every primitive this
// needs -- claim, renew, complete, fail -- and they are tested. What was
// missing is the thing that composes them: before this module,
// `completeNationwideDispatch` had no caller anywhere in `src/`, so the
// queue could be filled and claimed but never actually worked off. This is
// the loop body that does one unit of work.
//
// Three properties are the whole point of the function, and each is a way
// the queue breaks if it is written casually:
//
//   * A claimed dispatch ALWAYS reaches a terminal state. The execute call
//     is wrapped so that a throw becomes `failNationwideDispatch` rather
//     than an escaped exception -- an escaped exception would leave the row
//     claimed, and it would then sit as someone else's expired lease until a
//     health alert noticed. The worker reports the failure to its caller
//     instead of rethrowing, because "this dispatch failed" is a normal
//     outcome of a tick, not an error in the tick.
//   * The claim scope is mandatory. A worker that claimed anything would
//     pick up sources it has no adapter for, fail them, and burn their
//     retry budget, so a tick with neither `allowedSourceKeys` nor
//     `allowedSourceContracts` is refused rather than defaulted to "all".
//   * Every timestamp comes from one injected clock, re-read at each step
//     (`canonicalClock`), so a long execution renews and completes against
//     the time it actually finished rather than the time it started.
//
// `renewLease` is handed to the executor rather than run on a timer here: a
// long ingestion knows when it has made progress, and a timer that renewed
// regardless would keep a wedged run's lease alive forever -- which is
// exactly the state the expired-lease health alert exists to surface.
//
// No I/O of its own: the caller supplies the PostgresTransactionHost, and
// `safeErrorSummary` so that whatever is written to the row is the caller's
// redacted summary rather than a raw error that could carry a connection
// string or a row's contents.
import {
  claimNextNationwideDispatch,
  completeNationwideDispatch,
  failNationwideDispatch,
  renewNationwideDispatchLease,
  type NationwideAllowedSourceContract,
  type NationwideIngestionDispatch,
} from "./nationwide-postgres-dispatch-store.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";

export type NationwideDispatchExecution = {
  ingestionRunId: string;
};

export type NationwideDispatchWorkerResult =
  | { status: "idle" }
  | { status: "succeeded"; dispatch: NationwideIngestionDispatch }
  | { status: "failed"; dispatch: NationwideIngestionDispatch; errorSummary: string };

export type NationwideDispatchClaimScope =
  | { allowedSourceContracts: NationwideAllowedSourceContract[]; allowedSourceKeys?: never }
  | { allowedSourceKeys: string[]; allowedSourceContracts?: never };

export type ExecuteNextNationwideDispatchInput = {
  database: PostgresTransactionHost;
  workerId: string;
  leaseSeconds: number;
  clock?: () => string;
  execute: (context: {
    dispatch: NationwideIngestionDispatch;
    renewLease: () => Promise<NationwideIngestionDispatch>;
  }) => Promise<NationwideDispatchExecution>;
  safeErrorSummary: (error: unknown) => string;
} & NationwideDispatchClaimScope;

function canonicalClock(clock: () => string) {
  const value = clock();
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error("worker clock must return a canonical UTC ISO date-time");
  }
  return value;
}

function requiredText(value: string, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

export async function executeNextNationwideDispatch(
  input: ExecuteNextNationwideDispatchInput,
): Promise<NationwideDispatchWorkerResult> {
  const workerId = requiredText(input.workerId, "workerId");
  if (input.allowedSourceKeys === undefined && input.allowedSourceContracts === undefined) {
    throw new Error("dispatch worker requires an explicit source claim scope");
  }
  if (typeof input.execute !== "function") {
    throw new Error("dispatch worker requires an execute implementation");
  }
  if (typeof input.safeErrorSummary !== "function") {
    throw new Error("dispatch worker requires a safeErrorSummary implementation");
  }
  const clock = input.clock ?? (() => new Date().toISOString());

  const claimed = await claimNextNationwideDispatch(input.database, {
    workerId,
    acquiredAt: canonicalClock(clock),
    leaseSeconds: input.leaseSeconds,
    // Spread rather than passed as undefined: `exactOptionalPropertyTypes`
    // distinguishes an absent key from an explicit undefined, and the claim
    // scope is a discriminated union where only one side is ever present.
    ...(input.allowedSourceKeys === undefined
      ? {}
      : { allowedSourceKeys: input.allowedSourceKeys }),
    ...(input.allowedSourceContracts === undefined
      ? {}
      : { allowedSourceContracts: input.allowedSourceContracts }),
  });
  if (claimed === null) return { status: "idle" };

  try {
    const execution = await input.execute({
      dispatch: claimed,
      renewLease: () =>
        renewNationwideDispatchLease(input.database, {
          dispatchId: claimed.dispatchId,
          workerId,
          renewedAt: canonicalClock(clock),
          leaseSeconds: input.leaseSeconds,
        }),
    });
    const completed = await completeNationwideDispatch(input.database, {
      dispatchId: claimed.dispatchId,
      workerId,
      ingestionRunId: execution.ingestionRunId,
      completedAt: canonicalClock(clock),
    });
    return { status: "succeeded", dispatch: completed };
  } catch (error) {
    // The claimed row must not be left claimed. Whatever went wrong, it is
    // recorded through the caller's redacted summary and reported as a
    // result rather than rethrown.
    const errorSummary = requiredText(input.safeErrorSummary(error), "safeErrorSummary(error)");
    const failed = await failNationwideDispatch(input.database, {
      dispatchId: claimed.dispatchId,
      workerId,
      errorSummary,
      completedAt: canonicalClock(clock),
    });
    return { status: "failed", dispatch: failed, errorSummary };
  }
}
