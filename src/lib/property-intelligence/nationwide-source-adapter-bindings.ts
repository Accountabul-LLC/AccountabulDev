// Slice 4 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1, Slice 3 68d2ae9). Replaces Slice 3's
// `notImplemented` scope-boundary error: each of the six bindings' `execute`
// now runs the FULL pipeline -- fetch stub -> parse/normalize (Slice 3) ->
// resolve (this slice's nationwide-postgres-property-resolver.ts) -> write
// (this slice's nationwide-postgres-writer.ts) -> a replay-safe ingestion
// run (this slice's nationwide-postgres-run-store.ts) -- and is code-complete
// and wired end-to-end.
//
// It is still never triggered from this repo or this session: every
// dependency below is required with NO DEFAULT. `createNationwideSourceAdapterBindings`
// takes a `NationwideSourceAdapterDependencies` bag whose `database` is a
// `PostgresTransactionHost` (nowhere in this repo constructed against a real
// connection -- see nationwide-pg-transaction-host.ts's header) and whose
// six `fetchRows` functions are the injected "fetch stub" -- each one is
// exactly the raw-row shape the matching Slice 3 `normalize*` function
// already declares (via `Parameters<typeof normalize...>[0]`), so calling
// `execute()` for real would still require a caller to supply real network
// access (or real PDF bytes) through that function, which nothing in this
// repo does. `nationwideSourceAdapterRegistry` is no longer a ready-built
// singleton for the same reason: it is now
// `createNationwideSourceAdapterRegistry(dependencies)`, so importing this
// module never itself requires a live connection -- only calling that
// factory with a real `NationwideSourceAdapterDependencies` would, and
// nothing here does that either.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import { normalizeMississippiCountyTaxSale } from "./nationwide-ms-county-tax-sale-normalize.ts";
import { normalizeMississippiRankinTaxSaleRow } from "./nationwide-ms-rankin-pdf.ts";
import { normalizeMississippiSosInventory } from "./nationwide-ms-sos-normalize.ts";
import {
  normalizeMississippiDesotoLandrollProperty,
  normalizeStLouisOfficialLraProperty,
} from "./nationwide-property-record-intake.ts";
import { normalizeStLouisSheriffTaxSaleRow } from "./nationwide-st-louis-sheriff-pdf.ts";
import type {
  NormalizedIntakeBundle,
  NormalizedPropertyRecordBundle,
} from "./nationwide-property-intake-types.ts";
import { createNationwidePostgresPropertyResolver } from "./nationwide-postgres-property-resolver.ts";
import {
  persistNormalizedAuctionBundle,
  persistNormalizedPropertyRecordBundle,
} from "./nationwide-postgres-writer.ts";
import {
  finalizeSnapshotIngestionRun,
  startSnapshotIngestionRun,
  persistSnapshotBatchResult,
} from "./nationwide-postgres-run-store.ts";
import {
  createNationwideSourceExecutorRegistry,
  type NationwideSourceExecutorBinding,
  type NationwideSourceExecutorRegistry,
} from "./nationwide-source-executor-registry.ts";

const RESOLUTION_ALGORITHM_VERSION = "accountabul-nationwide-resolution-v1";

// Each entry pairs a source's raw-row fetch stub with the real Slice 3
// normalize function whose input shape it must match exactly (enforced by
// `Parameters<typeof normalize...>[0]`, not hand-copied field lists).
type AuctionRowFetcher<Input> = () => Promise<{
  rows: Input[];
  sourceObjectIds: string[];
  reportedCount: number;
}>;

export type NationwideSourceAdapterDependencies = {
  // No default: a real PostgreSQL-backed transaction host, e.g. from
  // withNationwidePgTransactionHost -- nothing in this repo constructs one.
  database: PostgresTransactionHost;
  jurisdictionIds: {
    mo_st_louis_lra_inventory_v1: string;
    mo_st_louis_sheriff_tax_sale_v1: string;
    ms_county_tax_sale_report_v1: string;
    ms_desoto_county_landroll_2026_prelim_v1: string;
    ms_rankin_county_tax_sale_report_v1: string;
    ms_sos_active_tax_forfeited_inventory_v1: string;
  };
  sourceDefinitionIds: {
    mo_st_louis_lra_inventory_v1: string;
    mo_st_louis_sheriff_tax_sale_v1: string;
    ms_county_tax_sale_report_v1: string;
    ms_desoto_county_landroll_2026_prelim_v1: string;
    ms_rankin_county_tax_sale_report_v1: string;
    ms_sos_active_tax_forfeited_inventory_v1: string;
  };
  // The injected "fetch stub": each function is expected to internally
  // perform whatever real discovery/fetch/PDF-extraction Slice 3's adapter
  // for that source requires (discoverX/fetchXBatch/parseXPdf, all already
  // injected-dependency, no-default themselves -- see each adapter's own
  // header) and hand back raw rows/features ready for the paired
  // `normalize*` call below, plus the source object IDs that identify them
  // for replay-safe run bookkeeping.
  fetchRows: {
    mo_st_louis_lra_inventory_v1: AuctionRowFetcher<
      Parameters<typeof normalizeStLouisOfficialLraProperty>[0]
    >;
    mo_st_louis_sheriff_tax_sale_v1: AuctionRowFetcher<
      Parameters<typeof normalizeStLouisSheriffTaxSaleRow>[0]
    >;
    ms_county_tax_sale_report_v1: AuctionRowFetcher<
      Parameters<typeof normalizeMississippiCountyTaxSale>[0]
    >;
    ms_desoto_county_landroll_2026_prelim_v1: AuctionRowFetcher<
      Parameters<typeof normalizeMississippiDesotoLandrollProperty>[0]
    >;
    ms_rankin_county_tax_sale_report_v1: AuctionRowFetcher<
      Parameters<typeof normalizeMississippiRankinTaxSaleRow>[0]
    >;
    ms_sos_active_tax_forfeited_inventory_v1: AuctionRowFetcher<
      Parameters<typeof normalizeMississippiSosInventory>[0]
    >;
  };
};

function requiredUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

// Shared fetch -> normalize -> resolve -> write -> run-store pipeline. `write`
// picks persistNormalizedAuctionBundle or persistNormalizedPropertyRecordBundle
// depending on which bundle shape `normalize` produces (auction sources --
// including ms_sos, whose "state_forfeited_inventory" sale mechanism is
// still an auction_events row -- vs. the two land-inventory record sources).
// Whatever lands in ingestion_batches.error_summary is read by other
// operators, so a raw error -- which can carry a DSN, a signed URL or a row's
// contents -- is never written straight through.
const UNSAFE_ERROR_PATTERN =
  /(?:https?:\/\/|postgres(?:ql)?:\/\/|bearer\s|password|credential|secret|access[_ -]?token|api[_ -]?key|[?&](?:token|key|sig)=)/i;

export function safeIngestionErrorSummary(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!summary || UNSAFE_ERROR_PATTERN.test(summary)) {
    return "nationwide snapshot ingestion failed";
  }
  return summary;
}

async function runSnapshotIngestion<RawRow>(options: {
  database: PostgresTransactionHost;
  sourceDefinitionId: string;
  jurisdictionId: string;
  runKey: string;
  scheduledFor: string;
  attempt: number;
  serviceMaximum: number;
  fetch: AuctionRowFetcher<RawRow>;
  normalize: (row: RawRow) => Promise<NormalizedIntakeBundle> | NormalizedIntakeBundle;
  write: (
    database: PostgresTransactionHost,
    input: {
      bundle: NormalizedIntakeBundle;
      sourceDefinitionId: string;
      jurisdictionId: string;
      ingestionRunId: string;
      resolution: Awaited<ReturnType<ReturnType<typeof createNationwidePostgresPropertyResolver>>>;
      resolutionAlgorithmVersion: string;
    },
  ) => Promise<{ sourceRecordId: string }>;
  sourceDefinitionKey: string;
  contractVersion: number;
}): Promise<{ runId: string }> {
  const { rows, sourceObjectIds, reportedCount } = await options.fetch();
  if (rows.length !== sourceObjectIds.length) {
    throw new Error("fetchRows must return one sourceObjectId per row");
  }
  const startedAt = options.scheduledFor;
  const discoverySha256 = await stableSha256({ runKey: options.runKey, sourceObjectIds });
  const started = await startSnapshotIngestionRun(options.database, {
    sourceDefinitionId: options.sourceDefinitionId,
    runKey: options.runKey,
    scheduledFor: options.scheduledFor,
    attempt: options.attempt,
    mappingVersion: 1,
    initiatedBy: "nationwide-source-adapter-bindings",
    serviceMaximum: options.serviceMaximum,
    reportedCount,
    expectedIds: sourceObjectIds,
    withdrawalMode: "append_only",
    discoveryStatus: "succeeded",
    discoveryArtifact: {
      sha256: discoverySha256,
      objectStorageKey: `${options.sourceDefinitionKey}/${options.runKey}/discovery.json`,
      mimeType: "application/json",
      byteSize: JSON.stringify(sourceObjectIds).length,
    },
    startedAt,
  });

  if (!started.replayed) {
    const resolutionAsOf = options.scheduledFor;
    const resolve = createNationwidePostgresPropertyResolver({
      database: options.database,
      sourceDefinitionId: options.sourceDefinitionId,
      sourceDefinitionKey: options.sourceDefinitionKey,
      contractVersion: options.contractVersion,
      resolutionAsOf,
    });

    // The batch is recorded AFTER the rows it covers, so it states what
    // actually happened. Recording it succeeded up front (as this did) meant
    // a row that failed to normalize, resolve or write still left a
    // succeeded batch behind, and `finalizeSnapshotIngestionRun` rolled that
    // up as complete coverage with withdrawals allowed -- a partial ingest
    // published as a whole snapshot.
    let failure: unknown = null;
    try {
      for (const row of rows) {
        const bundle = await options.normalize(row);
        const resolution = await resolve(bundle);
        await options.write(options.database, {
          bundle,
          sourceDefinitionId: options.sourceDefinitionId,
          jurisdictionId: options.jurisdictionId,
          ingestionRunId: started.runId,
          resolution,
          resolutionAlgorithmVersion: RESOLUTION_ALGORITHM_VERSION,
        });
      }
    } catch (error) {
      failure = error;
    }

    await persistSnapshotBatchResult(options.database, {
      runId: started.runId,
      batchNumber: 1,
      requestedIds: sourceObjectIds,
      // Nothing is claimed as returned when the batch failed, so coverage
      // reconciles as incomplete and withdrawals stay suppressed.
      returnedIds: failure === null ? sourceObjectIds : [],
      status: failure === null ? "succeeded" : "failed",
      error: failure === null ? null : safeIngestionErrorSummary(failure),
      startedAt,
      completedAt: startedAt,
      // A failed batch has no response to archive; the run store requires an
      // artifact only for a non-failed one.
      artifact:
        failure === null
          ? {
              sha256: discoverySha256,
              objectStorageKey: `${options.sourceDefinitionKey}/${options.runKey}/batch-00001.json`,
              mimeType: "application/json",
              byteSize: JSON.stringify(sourceObjectIds).length,
            }
          : null,
    });

    if (failure !== null) {
      // Finalize before rethrowing. Without this the ingestion_runs row stays
      // open with no completed_at while the dispatch is marked failed, so the
      // two records disagree and the run is only noticed hours later by the
      // stale-open-run health alert.
      await finalizeSnapshotIngestionRun(options.database, {
        runId: started.runId,
        completedAt: startedAt,
      });
      throw failure;
    }
  }

  const finalized = await finalizeSnapshotIngestionRun(options.database, {
    runId: started.runId,
    completedAt: startedAt,
  });
  return { runId: finalized.runId };
}

async function writeAuctionBundle(
  database: PostgresTransactionHost,
  input: Parameters<typeof persistNormalizedAuctionBundle>[1],
) {
  return persistNormalizedAuctionBundle(database, input);
}

async function writePropertyRecordBundle(
  database: PostgresTransactionHost,
  input: {
    bundle: NormalizedIntakeBundle;
    sourceDefinitionId: string;
    jurisdictionId: string;
    ingestionRunId: string;
    resolution: Parameters<typeof persistNormalizedPropertyRecordBundle>[1]["resolution"];
    resolutionAlgorithmVersion: string;
  },
) {
  return persistNormalizedPropertyRecordBundle(database, {
    ...input,
    bundle: input.bundle as unknown as NormalizedPropertyRecordBundle,
  });
}

export function createNationwideSourceAdapterBindings(
  dependencies: NationwideSourceAdapterDependencies,
): readonly NationwideSourceExecutorBinding[] {
  const database = dependencies.database;
  if (!database || typeof database.transaction !== "function") {
    throw new Error(
      "createNationwideSourceAdapterBindings requires an injected database (PostgresTransactionHost)",
    );
  }
  for (const [sourceKey, sourceDefinitionId] of Object.entries(dependencies.sourceDefinitionIds)) {
    requiredUuid(sourceDefinitionId, `sourceDefinitionIds.${sourceKey}`);
  }
  for (const [sourceKey, jurisdictionId] of Object.entries(dependencies.jurisdictionIds)) {
    requiredUuid(jurisdictionId, `jurisdictionIds.${sourceKey}`);
  }

  return [
    {
      sourceKey: "mo_st_louis_lra_inventory_v1",
      contractVersion: 3,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId: dependencies.sourceDefinitionIds.mo_st_louis_lra_inventory_v1,
          jurisdictionId: dependencies.jurisdictionIds.mo_st_louis_lra_inventory_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.mo_st_louis_lra_inventory_v1,
          normalize: (row) =>
            normalizeStLouisOfficialLraProperty(row) as unknown as Promise<NormalizedIntakeBundle>,
          write: writePropertyRecordBundle,
          sourceDefinitionKey: "mo_st_louis_lra_inventory_v1",
          contractVersion: 3,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId: dependencies.sourceDefinitionIds.mo_st_louis_sheriff_tax_sale_v1,
          jurisdictionId: dependencies.jurisdictionIds.mo_st_louis_sheriff_tax_sale_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.mo_st_louis_sheriff_tax_sale_v1,
          normalize: normalizeStLouisSheriffTaxSaleRow,
          write: writeAuctionBundle,
          sourceDefinitionKey: "mo_st_louis_sheriff_tax_sale_v1",
          contractVersion: 3,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
    {
      sourceKey: "ms_county_tax_sale_report_v1",
      contractVersion: 1,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId: dependencies.sourceDefinitionIds.ms_county_tax_sale_report_v1,
          jurisdictionId: dependencies.jurisdictionIds.ms_county_tax_sale_report_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.ms_county_tax_sale_report_v1,
          normalize: normalizeMississippiCountyTaxSale,
          write: writeAuctionBundle,
          sourceDefinitionKey: "ms_county_tax_sale_report_v1",
          contractVersion: 1,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
    {
      sourceKey: "ms_desoto_county_landroll_2026_prelim_v1",
      contractVersion: 1,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId:
            dependencies.sourceDefinitionIds.ms_desoto_county_landroll_2026_prelim_v1,
          jurisdictionId: dependencies.jurisdictionIds.ms_desoto_county_landroll_2026_prelim_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.ms_desoto_county_landroll_2026_prelim_v1,
          normalize: (row) =>
            normalizeMississippiDesotoLandrollProperty(
              row,
            ) as unknown as Promise<NormalizedIntakeBundle>,
          write: writePropertyRecordBundle,
          sourceDefinitionKey: "ms_desoto_county_landroll_2026_prelim_v1",
          contractVersion: 1,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
    {
      sourceKey: "ms_rankin_county_tax_sale_report_v1",
      contractVersion: 1,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId: dependencies.sourceDefinitionIds.ms_rankin_county_tax_sale_report_v1,
          jurisdictionId: dependencies.jurisdictionIds.ms_rankin_county_tax_sale_report_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.ms_rankin_county_tax_sale_report_v1,
          normalize: normalizeMississippiRankinTaxSaleRow,
          write: writeAuctionBundle,
          sourceDefinitionKey: "ms_rankin_county_tax_sale_report_v1",
          contractVersion: 1,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
    {
      sourceKey: "ms_sos_active_tax_forfeited_inventory_v1",
      contractVersion: 1,
      async execute(context) {
        const { runId } = await runSnapshotIngestion({
          database,
          sourceDefinitionId:
            dependencies.sourceDefinitionIds.ms_sos_active_tax_forfeited_inventory_v1,
          jurisdictionId: dependencies.jurisdictionIds.ms_sos_active_tax_forfeited_inventory_v1,
          runKey: context.dispatch.dispatchId,
          scheduledFor: context.dispatch.scheduledFor,
          attempt: context.dispatch.attempt,
          serviceMaximum: 2_000,
          fetch: dependencies.fetchRows.ms_sos_active_tax_forfeited_inventory_v1,
          normalize: normalizeMississippiSosInventory,
          write: writeAuctionBundle,
          sourceDefinitionKey: "ms_sos_active_tax_forfeited_inventory_v1",
          contractVersion: 1,
        });
        return {
          sourceDefinitionId: context.dispatch.sourceDefinitionId,
          runKey: context.dispatch.dispatchId,
          runId,
        };
      },
    },
  ];
}

// No default: building the registry requires the same injected, no-default
// `NationwideSourceAdapterDependencies` as the bindings above. Nothing in
// this repo calls this with a real database, so importing this module (or
// even calling this factory with a fake in-memory database in a test) never
// reaches a network or a live PostgreSQL connection.
export function createNationwideSourceAdapterRegistry(
  dependencies: NationwideSourceAdapterDependencies,
): NationwideSourceExecutorRegistry {
  return createNationwideSourceExecutorRegistry(
    createNationwideSourceAdapterBindings(dependencies),
  );
}
