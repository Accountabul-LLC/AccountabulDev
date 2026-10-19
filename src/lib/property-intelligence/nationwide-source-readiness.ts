import { NATIONWIDE_PILOT_SOURCE_MANIFESTS } from "./nationwide-source-catalog.ts";

export const NATIONWIDE_SOURCE_REQUIREMENTS = {
  targetSchemaDeployed: "target_schema_deployed",
  sourceContractRegistered: "source_contract_registered",
  sourceCandidatePromoted: "source_candidate_promoted",
  lovableAuditSaved: "lovable_live_audit_saved",
  lovablePublicExportConfigured: "lovable_public_export_configured",
  immutableSourceArtifactArchived: "immutable_source_artifact_archived",
  authorizedSnapshotTransport: "authorized_snapshot_transport",
  immutableArtifactStoreDeployed: "immutable_artifact_store_deployed",
  countyRegistryVerified: "county_registry_verified",
  dispatchWorkerConfigured: "dispatch_worker_configured",
  schedulerActivated: "scheduler_activated",
  productionReconciliationPassed: "production_reconciliation_passed",
  sourceMappingReleasePublished: "source_mapping_release_published",
  officialContinuousSourceContract: "official_continuous_source_contract",
} as const;

export type NationwideSourceRequirement =
  (typeof NATIONWIDE_SOURCE_REQUIREMENTS)[keyof typeof NATIONWIDE_SOURCE_REQUIREMENTS];

export type NationwideSourceCatalogKey = keyof typeof NATIONWIDE_PILOT_SOURCE_MANIFESTS;
export type NationwideSourceImplementationStatus = "runnable" | "normalizer_only";
export type NationwideSourceOperatingModel = "continuous_candidate" | "backfill_only";
export type NationwideMappingExecutionStatus = "released" | "profile_only";

type NationwideSourceCapability = {
  implementationStatus: NationwideSourceImplementationStatus;
  operatingModel: NationwideSourceOperatingModel;
  mappingExecutionStatus: NationwideMappingExecutionStatus;
  executionBoundary: string | null;
  manualRequirements: readonly NationwideSourceRequirement[];
  continuousRequirements: readonly NationwideSourceRequirement[];
};

const commonManualRequirements = [
  NATIONWIDE_SOURCE_REQUIREMENTS.targetSchemaDeployed,
  NATIONWIDE_SOURCE_REQUIREMENTS.sourceContractRegistered,
] as const;

const commonContinuousRequirements = [
  NATIONWIDE_SOURCE_REQUIREMENTS.dispatchWorkerConfigured,
  NATIONWIDE_SOURCE_REQUIREMENTS.schedulerActivated,
  NATIONWIDE_SOURCE_REQUIREMENTS.productionReconciliationPassed,
  NATIONWIDE_SOURCE_REQUIREMENTS.sourceMappingReleasePublished,
] as const;

export const NATIONWIDE_PILOT_SOURCE_CAPABILITIES = {
  mississippiSosActiveInventory: {
    implementationStatus: "runnable",
    operatingModel: "continuous_candidate",
    mappingExecutionStatus: "released",
    executionBoundary: "executeMississippiSosAuthorizedSnapshot",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.authorizedSnapshotTransport,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
      NATIONWIDE_SOURCE_REQUIREMENTS.countyRegistryVerified,
    ],
    continuousRequirements: commonContinuousRequirements,
  },
  desotoCountyTaxSale: {
    implementationStatus: "runnable",
    operatingModel: "continuous_candidate",
    mappingExecutionStatus: "released",
    executionBoundary: "executeMississippiDesotoTaxSalePdf",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: commonContinuousRequirements,
  },
  rankinCountyTaxSale: {
    implementationStatus: "runnable",
    operatingModel: "backfill_only",
    mappingExecutionStatus: "profile_only",
    executionBoundary: "executeMississippiRankinTaxSalePdf",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.sourceCandidatePromoted,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: [NATIONWIDE_SOURCE_REQUIREMENTS.officialContinuousSourceContract],
  },
  desotoCountyLandroll: {
    implementationStatus: "runnable",
    operatingModel: "continuous_candidate",
    mappingExecutionStatus: "released",
    executionBoundary: "executeMississippiDesotoLandrollSnapshot",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: commonContinuousRequirements,
  },
  legacyStLouisLra: {
    implementationStatus: "runnable",
    operatingModel: "backfill_only",
    mappingExecutionStatus: "profile_only",
    executionBoundary: "captureAndExecuteLegacyLraBackfill",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.lovablePublicExportConfigured,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: [NATIONWIDE_SOURCE_REQUIREMENTS.officialContinuousSourceContract],
  },
  officialStLouisLra: {
    implementationStatus: "runnable",
    operatingModel: "continuous_candidate",
    mappingExecutionStatus: "released",
    executionBoundary: "executeStLouisOfficialLraSnapshot",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: commonContinuousRequirements,
  },
  legacyStLouisSheriffTaxSale: {
    implementationStatus: "runnable",
    operatingModel: "backfill_only",
    mappingExecutionStatus: "profile_only",
    executionBoundary: "captureAndExecuteLegacyStLouisTaxSaleBackfill",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.lovablePublicExportConfigured,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: [NATIONWIDE_SOURCE_REQUIREMENTS.officialContinuousSourceContract],
  },
  officialStLouisSheriffTaxSale: {
    implementationStatus: "runnable",
    operatingModel: "continuous_candidate",
    mappingExecutionStatus: "released",
    executionBoundary: "captureAndExecuteCurrentStLouisSheriffTaxSale",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableArtifactStoreDeployed,
    ],
    continuousRequirements: commonContinuousRequirements,
  },
  legacyCookCountyAssessor: {
    implementationStatus: "runnable",
    operatingModel: "backfill_only",
    mappingExecutionStatus: "profile_only",
    executionBoundary: "executeLegacyCookCountyBackfill",
    manualRequirements: [
      ...commonManualRequirements,
      NATIONWIDE_SOURCE_REQUIREMENTS.lovableAuditSaved,
      NATIONWIDE_SOURCE_REQUIREMENTS.immutableSourceArtifactArchived,
    ],
    continuousRequirements: [NATIONWIDE_SOURCE_REQUIREMENTS.officialContinuousSourceContract],
  },
} as const satisfies Record<NationwideSourceCatalogKey, NationwideSourceCapability>;

export type NationwideSourceReadinessBlocker =
  | NationwideSourceRequirement
  | "execution_boundary_missing"
  | "released_mapping_executor_missing"
  | "interval_schedule_not_configured"
  | "manifest_inactive";

export type NationwideSourceReadiness = {
  catalogKey: NationwideSourceCatalogKey;
  sourceKey: string;
  stateCode: string;
  countyFips: string | null;
  recordLane: "auction" | "property_record";
  manifestActive: boolean;
  scheduleMode: "manual" | "interval";
  implementationStatus: NationwideSourceImplementationStatus;
  operatingModel: NationwideSourceOperatingModel;
  mappingExecutionStatus: NationwideMappingExecutionStatus;
  executionBoundary: string | null;
  manualIngestionReady: boolean;
  continuousIngestionReady: boolean;
  manualBlockers: NationwideSourceReadinessBlocker[];
  continuousBlockers: NationwideSourceReadinessBlocker[];
};

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function missingRequirements(
  requirements: readonly NationwideSourceRequirement[],
  satisfied: ReadonlySet<NationwideSourceRequirement>,
) {
  return requirements.filter((requirement) => !satisfied.has(requirement));
}

export function evaluateNationwideSourceReadiness(
  input: {
    satisfiedRequirements?: Iterable<NationwideSourceRequirement>;
  } = {},
): NationwideSourceReadiness[] {
  const satisfied = new Set(input.satisfiedRequirements ?? []);
  return (Object.keys(NATIONWIDE_PILOT_SOURCE_MANIFESTS) as NationwideSourceCatalogKey[]).map(
    (catalogKey) => {
      const manifest = NATIONWIDE_PILOT_SOURCE_MANIFESTS[catalogKey];
      const capability = NATIONWIDE_PILOT_SOURCE_CAPABILITIES[catalogKey];
      const manualBlockers: NationwideSourceReadinessBlocker[] = [
        ...(capability.implementationStatus === "runnable"
          ? []
          : ["execution_boundary_missing" as const]),
        ...missingRequirements(capability.manualRequirements, satisfied),
      ];
      const continuousBlockers: NationwideSourceReadinessBlocker[] = [
        ...(capability.implementationStatus === "runnable"
          ? []
          : ["execution_boundary_missing" as const]),
        ...(capability.operatingModel === "continuous_candidate" &&
        capability.mappingExecutionStatus !== "released"
          ? ["released_mapping_executor_missing" as const]
          : []),
        ...(manifest.schedulePolicy.mode === "interval"
          ? []
          : ["interval_schedule_not_configured" as const]),
        ...(manifest.active ? [] : ["manifest_inactive" as const]),
        ...missingRequirements(capability.manualRequirements, satisfied),
        ...missingRequirements(capability.continuousRequirements, satisfied),
      ];
      return {
        catalogKey,
        sourceKey: manifest.sourceKey,
        stateCode: manifest.jurisdiction.stateCode,
        countyFips: manifest.jurisdiction.countyFips,
        recordLane: manifest.recordLane,
        manifestActive: manifest.active,
        scheduleMode: manifest.schedulePolicy.mode,
        implementationStatus: capability.implementationStatus,
        operatingModel: capability.operatingModel,
        mappingExecutionStatus: capability.mappingExecutionStatus,
        executionBoundary: capability.executionBoundary,
        manualIngestionReady: manualBlockers.length === 0,
        continuousIngestionReady: continuousBlockers.length === 0,
        manualBlockers: unique(manualBlockers),
        continuousBlockers: unique(continuousBlockers),
      };
    },
  );
}
