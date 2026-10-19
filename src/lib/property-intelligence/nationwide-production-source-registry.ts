// The production composition root, ported from the source app's
// `createNationwideProductionSourceRegistry`
// (app/lib/nationwide-production-source-registry.ts).
//
// It is the piece that turns "this repository contains six live fetch
// implementations" into "this deployment runs these two sources": it takes
// whichever sources an operator has actually configured, builds each one's
// real fetcher from its config, and returns an executor registry that
// advertises ONLY those contracts.
//
// I previously reported this as unportable until the live jurisdiction and
// source_definition rows were seeded. That was wrong, and the shape of the
// source module is what shows it: every dependency here is injected and
// every entry in NationwideProductionSourceConfig is optional, so the
// registry is constructible -- and testable -- with no configured sources at
// all. Seeding is what a run needs, not what this function needs.
//
// The structural difference from the source follows the split this
// repository already made everywhere else. The source composes per-source
// `execute*Snapshot` functions; here those were refactored into one
// `createNationwideSourceAdapterBindings` pipeline, so this module's job is
// to assemble that pipeline's `fetchRows`/id maps rather than to re-derive
// the pipeline. Each configured source contributes its own live fetcher --
// the same factories the ops path uses -- and nothing about normalization,
// resolution or run bookkeeping is restated here.
//
// The safety property worth stating plainly, because it is the whole reason
// this is not just an object literal: `allowedSourceContracts` covers only
// the CONFIGURED sources. `createNationwideSourceAdapterBindings` demands a
// fetcher and a format-valid id for all six keys, so the unconfigured ones
// are filled with a placeholder id and a fetcher that throws. A worker
// claims work by contract (see nationwide-dispatch-worker.ts's mandatory
// claim scope), so restricting the advertised contracts is what keeps a
// dispatch for an unconfigured source from being claimed and burned through
// its retry budget by a worker that could never have run it. The throwing
// fetcher is the backstop for that, not the mechanism.
import {
  createNationwideSourceAdapterBindings,
  type NationwideSourceAdapterDependencies,
} from "./nationwide-source-adapter-bindings.ts";
import {
  createNationwideSourceExecutorRegistry,
  type NationwideSourceExecutorBinding,
  type NationwideSourceExecutorRegistry,
} from "./nationwide-source-executor-registry.ts";
import { createMississippiDesotoLandrollLiveFetchRows } from "./nationwide-ms-desoto-landroll-live-fetch.server.ts";
import { createMississippiDesotoTaxSaleLiveFetchRows } from "./nationwide-ms-desoto-tax-sale-live-fetch.server.ts";
import { createMississippiRankinLiveFetchRows } from "./nationwide-ms-rankin-live-fetch.server.ts";
import { createMississippiSosLiveFetchRows } from "./nationwide-ms-sos-live-fetch.server.ts";
import { createStLouisLraLiveFetchRows } from "./nationwide-st-louis-lra-live-fetch.server.ts";
import { createStLouisSheriffLiveFetchRows } from "./nationwide-st-louis-sheriff-live-fetch.server.ts";
import type { ImmutableArtifactStore } from "./nationwide-artifact-store.ts";
import type { ExtractPositionedPdfTextPages } from "./nationwide-pdf-text-layout.ts";
import type { MississippiSosAuthorizedTransport } from "./nationwide-ms-sos-arcgis.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";
import { UUID_V1_TO_V5 as UUID_PATTERN } from "../validation/patterns.ts";

export const NATIONWIDE_PRODUCTION_SOURCE_KEYS = [
  "mo_st_louis_lra_inventory_v1",
  "mo_st_louis_sheriff_tax_sale_v1",
  "ms_county_tax_sale_report_v1",
  "ms_desoto_county_landroll_2026_prelim_v1",
  "ms_rankin_county_tax_sale_report_v1",
  "ms_sos_active_tax_forfeited_inventory_v1",
] as const;

export type NationwideProductionSourceKey = (typeof NATIONWIDE_PRODUCTION_SOURCE_KEYS)[number];

// Contract versions are the registered ones for each pilot source; a
// dispatch is claimed by (sourceKey, contractVersion) together.
const CONTRACT_VERSIONS: Record<NationwideProductionSourceKey, number> = {
  mo_st_louis_lra_inventory_v1: 3,
  mo_st_louis_sheriff_tax_sale_v1: 3,
  ms_county_tax_sale_report_v1: 1,
  ms_desoto_county_landroll_2026_prelim_v1: 1,
  ms_rankin_county_tax_sale_report_v1: 1,
  ms_sos_active_tax_forfeited_inventory_v1: 1,
};

// Format-valid only, so the bindings' UUID check passes for sources this
// deployment has not configured. Never a real row.
const INERT_PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

// Every configured source names the two real rows it writes under.
type RegisteredRows = {
  sourceDefinitionId: string;
  jurisdictionId: string;
};

export type StLouisLraSourceConfig = RegisteredRows & { batchSize?: number };

export type StLouisSheriffSourceConfig = RegisteredRows & {
  extractPages: ExtractPositionedPdfTextPages;
  maxPdfBytes?: number;
};

export type MississippiDesotoLandrollSourceConfig = RegisteredRows & { batchSize?: number };

export type MississippiDesotoTaxSaleSourceConfig = RegisteredRows & {
  reportUrl: string;
  // Required, and deliberately not defaulted: this repository carries no
  // reviewed retrieval contract for the DeSoto tax-sale report. See
  // nationwide-ms-desoto-tax-sale-live-fetch.server.ts's header.
  assertUrl: (url: string) => string;
  extractPages: ExtractPositionedPdfTextPages;
  expectedSha256?: string;
  maxPdfBytes?: number;
};

export type MississippiRankinSourceConfig = RegisteredRows & {
  reportUrl: string;
  extractPages: ExtractPositionedPdfTextPages;
  expectedSha256?: string;
  maxPdfBytes?: number;
};

export type MississippiSosSourceConfig = RegisteredRows & {
  transport: MississippiSosAuthorizedTransport;
  jurisdiction: { stateCode: string; countyName: string; countyFips: string };
  batchSize?: number;
};

export type NationwideProductionSourceConfig = {
  officialStLouisLra?: StLouisLraSourceConfig;
  officialStLouisSheriffTaxSale?: StLouisSheriffSourceConfig;
  desotoCountyTaxSale?: MississippiDesotoTaxSaleSourceConfig;
  desotoCountyLandroll?: MississippiDesotoLandrollSourceConfig;
  rankinCountyTaxSale?: MississippiRankinSourceConfig;
  mississippiSos?: MississippiSosSourceConfig;
};

export type CreateNationwideProductionSourceRegistryInput = {
  database: PostgresTransactionHost;
  // One store serves every source. ImmutableArtifactStore is the byte-capable
  // superset, which the three PDF sources need; the ArcGIS sources use only
  // its JSON half.
  artifactStore: ImmutableArtifactStore;
  sources: NationwideProductionSourceConfig;
  fetchImpl?: typeof fetch;
};

function registeredRows(config: RegisteredRows, label: string) {
  if (!UUID_PATTERN.test(config.sourceDefinitionId)) {
    throw new Error(`${label} sourceDefinitionId must be a UUID`);
  }
  if (!UUID_PATTERN.test(config.jurisdictionId)) {
    throw new Error(`${label} jurisdictionId must be a UUID`);
  }
  return config;
}

function inertFetchRows(sourceKey: NationwideProductionSourceKey) {
  return async () => {
    throw new Error(
      `${sourceKey} is not configured in this deployment's nationwide production source registry`,
    );
  };
}

export function createNationwideProductionSourceRegistry(
  input: CreateNationwideProductionSourceRegistryInput,
): NationwideSourceExecutorRegistry {
  if (!input.database || typeof input.database.transaction !== "function") {
    throw new Error(
      "createNationwideProductionSourceRegistry requires an injected PostgresTransactionHost",
    );
  }
  if (!input.artifactStore || typeof input.artifactStore.putCanonicalJson !== "function") {
    throw new Error("createNationwideProductionSourceRegistry requires an injected artifactStore");
  }
  const sources = input.sources ?? {};
  const artifactStore = input.artifactStore;
  const fetchOverride = input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl };

  const configured = new Set<NationwideProductionSourceKey>();
  const jurisdictionIds: Record<NationwideProductionSourceKey, string> = {
    mo_st_louis_lra_inventory_v1: INERT_PLACEHOLDER_ID,
    mo_st_louis_sheriff_tax_sale_v1: INERT_PLACEHOLDER_ID,
    ms_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
    ms_desoto_county_landroll_2026_prelim_v1: INERT_PLACEHOLDER_ID,
    ms_rankin_county_tax_sale_report_v1: INERT_PLACEHOLDER_ID,
    ms_sos_active_tax_forfeited_inventory_v1: INERT_PLACEHOLDER_ID,
  };
  const sourceDefinitionIds: Record<NationwideProductionSourceKey, string> = {
    ...jurisdictionIds,
  };
  const fetchRows: Record<NationwideProductionSourceKey, () => Promise<never>> = {
    mo_st_louis_lra_inventory_v1: inertFetchRows("mo_st_louis_lra_inventory_v1"),
    mo_st_louis_sheriff_tax_sale_v1: inertFetchRows("mo_st_louis_sheriff_tax_sale_v1"),
    ms_county_tax_sale_report_v1: inertFetchRows("ms_county_tax_sale_report_v1"),
    ms_desoto_county_landroll_2026_prelim_v1: inertFetchRows(
      "ms_desoto_county_landroll_2026_prelim_v1",
    ),
    ms_rankin_county_tax_sale_report_v1: inertFetchRows("ms_rankin_county_tax_sale_report_v1"),
    ms_sos_active_tax_forfeited_inventory_v1: inertFetchRows(
      "ms_sos_active_tax_forfeited_inventory_v1",
    ),
  };

  function register(
    sourceKey: NationwideProductionSourceKey,
    rows: RegisteredRows,
    fetcher: () => Promise<unknown>,
  ) {
    configured.add(sourceKey);
    jurisdictionIds[sourceKey] = rows.jurisdictionId;
    sourceDefinitionIds[sourceKey] = rows.sourceDefinitionId;
    fetchRows[sourceKey] = fetcher as () => Promise<never>;
  }

  const lra = sources.officialStLouisLra;
  if (lra) {
    register(
      "mo_st_louis_lra_inventory_v1",
      registeredRows(lra, "officialStLouisLra"),
      createStLouisLraLiveFetchRows({
        artifactStore,
        ...fetchOverride,
        ...(lra.batchSize === undefined ? {} : { batchSize: lra.batchSize }),
      }),
    );
  }

  const sheriff = sources.officialStLouisSheriffTaxSale;
  if (sheriff) {
    register(
      "mo_st_louis_sheriff_tax_sale_v1",
      registeredRows(sheriff, "officialStLouisSheriffTaxSale"),
      createStLouisSheriffLiveFetchRows({
        artifactStore,
        extractPages: sheriff.extractPages,
        ...fetchOverride,
        ...(sheriff.maxPdfBytes === undefined ? {} : { maxPdfBytes: sheriff.maxPdfBytes }),
      }),
    );
  }

  const desotoTaxSale = sources.desotoCountyTaxSale;
  if (desotoTaxSale) {
    register(
      "ms_county_tax_sale_report_v1",
      registeredRows(desotoTaxSale, "desotoCountyTaxSale"),
      createMississippiDesotoTaxSaleLiveFetchRows({
        artifactStore,
        reportUrl: desotoTaxSale.reportUrl,
        assertUrl: desotoTaxSale.assertUrl,
        extractPages: desotoTaxSale.extractPages,
        ...fetchOverride,
        ...(desotoTaxSale.expectedSha256 === undefined
          ? {}
          : { expectedSha256: desotoTaxSale.expectedSha256 }),
        ...(desotoTaxSale.maxPdfBytes === undefined
          ? {}
          : { maxPdfBytes: desotoTaxSale.maxPdfBytes }),
      }),
    );
  }

  const landroll = sources.desotoCountyLandroll;
  if (landroll) {
    register(
      "ms_desoto_county_landroll_2026_prelim_v1",
      registeredRows(landroll, "desotoCountyLandroll"),
      createMississippiDesotoLandrollLiveFetchRows({
        artifactStore,
        ...fetchOverride,
        ...(landroll.batchSize === undefined ? {} : { batchSize: landroll.batchSize }),
      }),
    );
  }

  const rankin = sources.rankinCountyTaxSale;
  if (rankin) {
    register(
      "ms_rankin_county_tax_sale_report_v1",
      registeredRows(rankin, "rankinCountyTaxSale"),
      createMississippiRankinLiveFetchRows({
        artifactStore,
        reportUrl: rankin.reportUrl,
        extractPages: rankin.extractPages,
        ...fetchOverride,
        ...(rankin.expectedSha256 === undefined ? {} : { expectedSha256: rankin.expectedSha256 }),
        ...(rankin.maxPdfBytes === undefined ? {} : { maxPdfBytes: rankin.maxPdfBytes }),
      }),
    );
  }

  const sos = sources.mississippiSos;
  if (sos) {
    register(
      "ms_sos_active_tax_forfeited_inventory_v1",
      registeredRows(sos, "mississippiSos"),
      createMississippiSosLiveFetchRows({
        artifactStore,
        transport: sos.transport,
        jurisdiction: sos.jurisdiction,
        ...(sos.batchSize === undefined ? {} : { batchSize: sos.batchSize }),
      }),
    );
  }

  const bindings = createNationwideSourceAdapterBindings({
    database: input.database,
    jurisdictionIds,
    sourceDefinitionIds,
    fetchRows,
  } as unknown as NationwideSourceAdapterDependencies);

  // Only the configured contracts are advertised. See the header: this is
  // what stops a worker claiming a dispatch it could never execute.
  const advertised = bindings.filter((binding: NationwideSourceExecutorBinding) =>
    configured.has(binding.sourceKey as NationwideProductionSourceKey),
  );
  if (advertised.length === 0) {
    throw new Error(
      "createNationwideProductionSourceRegistry requires at least one configured source",
    );
  }
  for (const binding of advertised) {
    const expected = CONTRACT_VERSIONS[binding.sourceKey as NationwideProductionSourceKey];
    if (binding.contractVersion !== expected) {
      throw new Error(
        `configured source ${binding.sourceKey} is bound to contract ${binding.contractVersion}, expected ${expected}`,
      );
    }
  }
  return createNationwideSourceExecutorRegistry(advertised);
}
