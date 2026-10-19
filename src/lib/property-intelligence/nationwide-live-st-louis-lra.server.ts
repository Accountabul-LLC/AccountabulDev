// Live-execution proof, step 3 (owner-approved staged rollout: apply the
// nationwide migrations to the live Supabase project -- now DONE -- then
// bring ONE adapter live first as a proof: St. Louis LRA only, source key
// mo_st_louis_lra_inventory_v1, contract version 3).
//
// This wires Slice 4's `createNationwideSourceAdapterRegistry` with a real
// database (an injected `PostgresTransactionHost` the CALLER constructs --
// see below) and this slice's real fetch implementation
// (nationwide-st-louis-lra-live-fetch.server.ts) for St. Louis LRA only.
//
// `pg` is now an approved dependency (owner sign-off) and
// nationwide-postgres-client.server.ts provides a real, `pg`-backed
// `PostgresTransactionHost` via `withRealNationwidePgTransactionHost` --
// `runLiveStLouisLraIngestionWithRealDatabase` below wraps that with this
// module's fetch/registry wiring. `runLiveStLouisLraIngestion` itself still
// takes `database` as a required, no-default parameter so it stays testable
// against a fake host without ever needing a real connection.
//
// The other five nationwide source keys (mo_st_louis_sheriff_tax_sale_v1,
// ms_county_tax_sale_report_v1, ms_desoto_county_landroll_2026_prelim_v1,
// ms_rankin_county_tax_sale_report_v1, ms_sos_active_tax_forfeited_inventory_v1)
// are NOT wired to anything real HERE. `createNationwideSourceAdapterBindings`
// requires a fetchRows entry and a valid-format sourceDefinitionId/
// jurisdictionId for all six source keys (see its own validation), so this
// module fills those five with an inert placeholder UUID and a fetchRows
// stub that throws if ever called; `runLiveStLouisLraIngestion` only ever
// dispatches the mo_st_louis_lra_inventory_v1 contract.
//
// Read that as a property of THIS module, not of the port. Every one of the
// five now HAS a real live fetch implementation
// (nationwide-st-louis-sheriff-live-fetch.server.ts,
// nationwide-ms-rankin-live-fetch.server.ts,
// nationwide-ms-desoto-landroll-live-fetch.server.ts,
// nationwide-ms-sos-live-fetch.server.ts and
// nationwide-ms-desoto-tax-sale-live-fetch.server.ts). What they do not have
// is a registered jurisdiction and source_definition row to run against --
// seeding those against the live project is an operator decision, not a code
// gap -- and each needs its own dependencies supplied (an artifact store for
// all of them, plus a PDF text extractor for the three report sources, the
// authorized transport for MS SOS, and a reviewed retrieval guard for the
// DeSoto tax sale). Wiring one of them here is a matter of passing its
// fetcher and its two real row IDs in place of the placeholder, exactly as
// the LRA binding below does.
//
// Nothing in this module runs, opens a network connection, or reads an
// environment variable at import time or at module scope. Credentials
// (Supabase service role key, for the artifact store this module defaults
// to when the caller doesn't supply one) are read from `process.env` only
// inside a function body, the same lazy-init pattern as
// src/integrations/supabase/client.server.ts.
//
// Activation (owner go-ahead given) is now wired:
// `runLiveStLouisLraIngestionWithRealDatabase` is called by the ops route
// src/routes/api/internal/ops/nationwide-st-louis-lra-ingest.ts, which is
// bearer-guarded by OPERATIONS_API_KEY and answers 503 until the two live
// row IDs are configured in the environment. A deployment that sets neither
// those IDs nor NATIONWIDE_DATABASE_URL stays exactly as inert as before.
import {
  createNationwideSourceAdapterRegistry,
  type NationwideSourceAdapterDependencies,
} from "./nationwide-source-adapter-bindings.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import { createStLouisLraLiveFetchRows } from "./nationwide-st-louis-lra-live-fetch.server.ts";

const LIVE_SOURCE_KEY = "mo_st_louis_lra_inventory_v1" as const;
const LIVE_CONTRACT_VERSION = 3 as const;

// Never a real jurisdiction or source-definition row. Format-valid only so
// `createNationwideSourceAdapterBindings`'s UUID check passes; the other
// five bindings that use it never execute from this module.
const INERT_PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

const INERT_SOURCE_KEYS = [
  "mo_st_louis_sheriff_tax_sale_v1",
  "ms_county_tax_sale_report_v1",
  "ms_desoto_county_landroll_2026_prelim_v1",
  "ms_rankin_county_tax_sale_report_v1",
  "ms_sos_active_tax_forfeited_inventory_v1",
] as const;

function inertFetchRows(sourceKey: string) {
  return async () => {
    throw new Error(
      `${sourceKey} has no live fetch implementation in this repo -- only ${LIVE_SOURCE_KEY} is wired live`,
    );
  };
}

async function defaultArtifactStore(): Promise<ImmutableJsonArtifactStore> {
  // Read only inside this function, never at module scope -- matches
  // client.server.ts's lazy-init pattern. Importing this module never
  // touches process.env or constructs a Supabase client.
  const [{ supabaseAdmin }, { createNationwideSupabaseArtifactStore }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./nationwide-supabase-artifact-store.ts"),
  ]);
  // The real @supabase/storage-js bucket client is a structural superset of
  // this repo's small injected SupabaseStorageBucket interface (its error
  // shape carries a couple of extra optional fields) -- see
  // nationwide-supabase-artifact-store.ts's header for why that interface is
  // intentionally narrower than the real SDK type.
  return createNationwideSupabaseArtifactStore(
    supabaseAdmin.storage.from("nationwide-source-artifacts") as unknown as Parameters<
      typeof createNationwideSupabaseArtifactStore
    >[0],
  );
}

export type LiveStLouisLraIngestionOptions = {
  // No default: a real PostgreSQL-backed transaction host. See the blocker
  // note above -- nothing in this repo constructs one yet.
  database: PostgresTransactionHost;
  // The real property_ingest.source_definitions / geography_catalog row IDs
  // for mo_st_louis_lra_inventory_v1, from the live database once the
  // nationwide migrations are applied there.
  sourceDefinitionId: string;
  jurisdictionId: string;
  // Defaults to a real Supabase Storage-backed store (bucket
  // "nationwide-source-artifacts", read lazily) when omitted.
  artifactStore?: ImmutableJsonArtifactStore;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  dispatchId?: string;
  scheduledFor?: string;
  attempt?: number;
};

// The only entrypoint this slice adds that can perform a real ingestion run.
// Takes `database` injected so it stays testable against a fake host; the
// ops route goes through the WithRealDatabase wrapper below instead.
export async function runLiveStLouisLraIngestion(options: LiveStLouisLraIngestionOptions) {
  if (!options.database || typeof options.database.transaction !== "function") {
    throw new Error("runLiveStLouisLraIngestion requires an injected PostgresTransactionHost");
  }
  if (!options.sourceDefinitionId || !options.jurisdictionId) {
    throw new Error(
      "runLiveStLouisLraIngestion requires the live sourceDefinitionId and jurisdictionId",
    );
  }

  const artifactStore = options.artifactStore ?? (await defaultArtifactStore());
  const liveFetchRows = createStLouisLraLiveFetchRows({
    artifactStore,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.batchSize !== undefined ? { batchSize: options.batchSize } : {}),
  });

  const dependencies: NationwideSourceAdapterDependencies = {
    database: options.database,
    sourceDefinitionIds: {
      mo_st_louis_lra_inventory_v1: options.sourceDefinitionId,
      mo_st_louis_sheriff_tax_sale_v1: INERT_PLACEHOLDER_ID,
      ms_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
      ms_desoto_county_landroll_2026_prelim_v1: INERT_PLACEHOLDER_ID,
      ms_rankin_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
      ms_sos_active_tax_forfeited_inventory_v1: INERT_PLACEHOLDER_ID,
    },
    jurisdictionIds: {
      mo_st_louis_lra_inventory_v1: options.jurisdictionId,
      mo_st_louis_sheriff_tax_sale_v1: INERT_PLACEHOLDER_ID,
      ms_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
      ms_desoto_county_landroll_2026_prelim_v1: INERT_PLACEHOLDER_ID,
      ms_rankin_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
      ms_sos_active_tax_forfeited_inventory_v1: INERT_PLACEHOLDER_ID,
    },
    fetchRows: {
      mo_st_louis_lra_inventory_v1: liveFetchRows,
      ...Object.fromEntries(
        INERT_SOURCE_KEYS.map((sourceKey) => [sourceKey, inertFetchRows(sourceKey)]),
      ),
    } as NationwideSourceAdapterDependencies["fetchRows"],
  };

  const registry = createNationwideSourceAdapterRegistry(dependencies);
  const dispatchId = options.dispatchId ?? crypto.randomUUID();
  const scheduledFor = options.scheduledFor ?? new Date().toISOString();
  const attempt = options.attempt ?? 1;
  const dispatch = {
    sourceKey: LIVE_SOURCE_KEY,
    contractVersion: LIVE_CONTRACT_VERSION,
    dispatchId,
    sourceDefinitionId: options.sourceDefinitionId,
    scheduledFor,
    attempt,
  };

  return registry.execute({
    dispatch,
    renewLease: async () => dispatch,
  });
}

export type LiveStLouisLraIngestionWithRealDatabaseOptions = Omit<
  LiveStLouisLraIngestionOptions,
  "database"
>;

/**
 * Same as `runLiveStLouisLraIngestion`, but opens a real PostgreSQL session
 * (via nationwide-postgres-client.server.ts, `NATIONWIDE_DATABASE_URL` read
 * lazily) instead of taking an injected `database`. This is the function a
 * ops route calls. Throws before any connection attempt if
 * `NATIONWIDE_DATABASE_URL` is unset, which it is in this repo's own
 * environment.
 */
export async function runLiveStLouisLraIngestionWithRealDatabase(
  options: LiveStLouisLraIngestionWithRealDatabaseOptions,
) {
  const { withRealNationwidePgTransactionHost } =
    await import("./nationwide-postgres-client.server.ts");
  return withRealNationwidePgTransactionHost((database) =>
    runLiveStLouisLraIngestion({ ...options, database }),
  );
}
