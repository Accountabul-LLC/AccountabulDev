// The scheduled production tick, ported from the source app's
// `executeNationwideProductionWorkerTick` (app/lib/nationwide-production-worker.ts)
// together with `executeNextNationwideCatalogDispatch`
// (app/lib/nationwide-source-executor-registry.ts), which is small enough
// that keeping it in a module of its own would only hide it.
//
// This is the last composition layer: one tick opens a database connection,
// builds the configured source registry, and works dispatches off the queue
// until the queue is empty or the per-tick limit is reached. Everything
// underneath it is already ported and tested -- the registry
// (nationwide-production-source-registry.ts), the worker loop
// (nationwide-dispatch-worker.ts), and each source's live fetch.
//
// Bounded on purpose, in both directions:
//
//   * `maxDispatchesPerTick` (default 2, max 20) keeps one invocation from
//     running until it is killed mid-dispatch by a platform timeout, which
//     would leave a claimed row to expire.
//   * An idle result stops the tick immediately rather than spinning through
//     the remaining budget against an empty queue. Note that the idle tick
//     itself is not counted as claimed work -- `results` records it, but
//     `claimed` does not.
//   * `leaseSeconds` defaults to 900 and is capped at an hour, so a wedged
//     run's lease does expire and the expired-lease health alert can fire.
//
// The error redaction is the security-relevant part and is why
// `safeErrorSummary` is wrapped rather than used as given. Whatever a
// caller's summary returns is written to `ingestion_dispatches.error_summary`,
// a row other operators read; an unredacted error here is the realistic way
// a connection string or a bearer token gets persisted. So a caller's
// summary is rejected -- replaced by a fixed, uninformative string -- if it
// is empty, over-long, multi-line, throws, or matches anything resembling a
// URL, credential or token. Refusing a suspicious summary loses detail; not
// refusing it persists secrets.
import {
  createNationwideProductionSourceRegistry,
  type NationwideProductionSourceConfig,
} from "./nationwide-production-source-registry.ts";
import {
  executeNextNationwideDispatch,
  type NationwideDispatchWorkerResult,
} from "./nationwide-dispatch-worker.ts";
import type { NationwideSourceExecutorRegistry } from "./nationwide-source-executor-registry.ts";
import type { ImmutableArtifactStore } from "./nationwide-artifact-store.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";

const PRODUCTION_SOURCE_CONFIG_KEYS = new Set([
  "officialStLouisLra",
  "officialStLouisSheriffTaxSale",
  "desotoCountyTaxSale",
  "desotoCountyLandroll",
  "rankinCountyTaxSale",
  "mississippiSos",
]);

// Anything that looks like a URL, a DSN, a credential or a token. Matched
// against the SUMMARY, not the error, because the summary is what gets
// written to a row other operators read.
const UNSAFE_ERROR_PATTERN =
  /(?:https?:\/\/|postgres(?:ql)?:\/\/|bearer\s|password|credential|secret|access[_ -]?token|api[_ -]?key|[?&](?:token|key|sig)=)/i;

function defaultSafeErrorSummary() {
  return "nationwide source execution failed";
}

export function productionSafeErrorSummary(callback?: (error: unknown) => string) {
  return (error: unknown) => {
    if (!callback) return defaultSafeErrorSummary();
    try {
      const summary = callback(error).trim();
      if (
        !summary ||
        summary.length > 240 ||
        /[\r\n]/.test(summary) ||
        UNSAFE_ERROR_PATTERN.test(summary)
      ) {
        return defaultSafeErrorSummary();
      }
      return summary;
    } catch {
      // A summariser that throws must not take the tick down with it, and
      // must not leave the dispatch unrecorded.
      return defaultSafeErrorSummary();
    }
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number,
  minimum = 1,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved;
}

/**
 * One dispatch, claimed only from the contracts this registry advertises.
 * The registry decides which sources those are, so a deployment that has not
 * configured a source cannot claim its work.
 */
export function executeNextNationwideCatalogDispatch(input: {
  database: PostgresTransactionHost;
  registry: NationwideSourceExecutorRegistry;
  workerId: string;
  leaseSeconds: number;
  safeErrorSummary: (error: unknown) => string;
  clock?: () => string;
}): Promise<NationwideDispatchWorkerResult> {
  return executeNextNationwideDispatch({
    database: input.database,
    workerId: input.workerId,
    leaseSeconds: input.leaseSeconds,
    allowedSourceContracts: [...input.registry.allowedSourceContracts],
    execute: (context) => input.registry.execute(context),
    safeErrorSummary: input.safeErrorSummary,
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
}

export type ExecuteNationwideProductionWorkerTickInput = {
  // Injected, no default: the caller owns the connection, exactly as
  // everywhere else in this subsystem. The source app takes a connection
  // string and opens the pool itself; here the host is passed in so a tick
  // stays testable without a database, and so the ops path can keep using
  // withRealNationwidePgTransactionHost.
  database: PostgresTransactionHost;
  artifactStore: ImmutableArtifactStore;
  workerId: string;
  sources: NationwideProductionSourceConfig;
  leaseSeconds?: number;
  maxDispatchesPerTick?: number;
  fetchImpl?: typeof fetch;
  safeErrorSummary?: (error: unknown) => string;
  clock?: () => string;
};

export type NationwideProductionWorkerTickResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  stoppedBecause: "idle" | "limit_reached";
  results: NationwideDispatchWorkerResult[];
};

export async function executeNationwideProductionWorkerTick(
  input: ExecuteNationwideProductionWorkerTickInput,
): Promise<NationwideProductionWorkerTickResult> {
  if (typeof input.workerId !== "string" || !input.workerId.trim()) {
    throw new Error("workerId is required");
  }
  const sources = input.sources ?? {};
  // A misspelled source key would otherwise configure nothing and leave the
  // tick quietly claiming a smaller set than the operator intended.
  const unknownSources = Object.keys(sources).filter(
    (key) => !PRODUCTION_SOURCE_CONFIG_KEYS.has(key),
  );
  if (unknownSources.length > 0) {
    throw new Error(
      `production worker source configuration contains unknown keys: ${unknownSources.sort().join(", ")}`,
    );
  }
  const leaseSeconds = boundedInteger(input.leaseSeconds, 900, "leaseSeconds", 3_600, 60);
  const maxDispatchesPerTick = boundedInteger(
    input.maxDispatchesPerTick,
    2,
    "maxDispatchesPerTick",
    20,
  );
  const safeErrorSummary = productionSafeErrorSummary(input.safeErrorSummary);

  const registry = createNationwideProductionSourceRegistry({
    database: input.database,
    artifactStore: input.artifactStore,
    sources,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });

  const results: NationwideDispatchWorkerResult[] = [];
  for (let index = 0; index < maxDispatchesPerTick; index += 1) {
    const result = await executeNextNationwideCatalogDispatch({
      database: input.database,
      registry,
      workerId: input.workerId,
      leaseSeconds,
      safeErrorSummary,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
    });
    results.push(result);
    if (result.status === "idle") {
      return {
        // The idle probe is recorded in `results` but is not claimed work.
        claimed: results.length - 1,
        succeeded: results.filter((item) => item.status === "succeeded").length,
        failed: results.filter((item) => item.status === "failed").length,
        stoppedBecause: "idle",
        results,
      };
    }
  }
  return {
    claimed: results.length,
    succeeded: results.filter((item) => item.status === "succeeded").length,
    failed: results.filter((item) => item.status === "failed").length,
    stoppedBecause: "limit_reached",
    results,
  };
}
