// Ported from property-intelligence-app's app/lib/nationwide-source-executor-registry.ts
// (Slice 2 of the nationwide multi-state ingestion port). This slice ports
// the registry MECHANISM only -- typed dispatch-by-(sourceKey,
// contractVersion) routing, one executor per exact immutable contract, with
// verification that whatever an executor returns actually belongs to the
// dispatch it was given. It does NOT port the source's binding against
// `NATIONWIDE_PILOT_SOURCE_MANIFESTS` / `NATIONWIDE_PILOT_SOURCE_CAPABILITIES`
// (this repo has no such source catalog -- Slice 3 adds the actual St. Louis
// / Mississippi adapters and their manifests) and NO adapters are registered
// here. `createNationwideSourceExecutorRegistry` accepts whatever bindings a
// caller supplies and is exercised in
// tests/property-intelligence-source-executor-registry.test.ts with a fake
// adapter, proving the routing/verification mechanism the same way the
// source's test does ("routes and verifies one exact immutable source
// contract").
export type NationwideSourceContract = {
  sourceKey: string;
  contractVersion: number;
};

export type NationwideExecutorDispatch = NationwideSourceContract & {
  dispatchId: string;
  sourceDefinitionId: string;
  scheduledFor: string;
  attempt: number;
};

export type NationwideExecutedSnapshot = {
  sourceDefinitionId: string;
  runKey: string;
  runId: string;
};

export type NationwideSourceExecutorContext = {
  dispatch: NationwideExecutorDispatch;
  renewLease: () => Promise<NationwideExecutorDispatch>;
};

export type NationwideSourceExecutorBinding = NationwideSourceContract & {
  execute: (context: NationwideSourceExecutorContext) => Promise<NationwideExecutedSnapshot>;
};

export type NationwideSourceExecutorRegistry = {
  allowedSourceContracts: readonly NationwideSourceContract[];
  execute(context: NationwideSourceExecutorContext): Promise<{ ingestionRunId: string }>;
};

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contractKey(contract: NationwideSourceContract) {
  return `${contract.sourceKey}:c${contract.contractVersion}`;
}

function requiredKey(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function positiveContractVersion(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

export function createNationwideSourceExecutorRegistry(
  bindings: readonly NationwideSourceExecutorBinding[],
): NationwideSourceExecutorRegistry {
  if (bindings.length < 1 || bindings.length > 100) {
    throw new Error("source executor registry requires between one and 100 bindings");
  }
  const byContract = new Map<string, NationwideSourceExecutorBinding>();
  for (const binding of bindings) {
    const sourceKey = requiredKey(binding.sourceKey, "sourceKey");
    const contractVersion = positiveContractVersion(binding.contractVersion, "contractVersion");
    if (typeof binding.execute !== "function") {
      throw new Error(`source executor binding ${sourceKey} must provide execute`);
    }
    const key = contractKey({ sourceKey, contractVersion });
    if (byContract.has(key)) {
      throw new Error(`source executor registry contains duplicate contract ${key}`);
    }
    byContract.set(key, { ...binding, sourceKey, contractVersion });
  }

  const allowedSourceContracts = Object.freeze(
    [...byContract.values()]
      .map((binding) =>
        Object.freeze({ sourceKey: binding.sourceKey, contractVersion: binding.contractVersion }),
      )
      .sort(
        (left, right) =>
          left.sourceKey.localeCompare(right.sourceKey) ||
          left.contractVersion - right.contractVersion,
      ),
  );

  return Object.freeze({
    allowedSourceContracts,
    async execute(context: NationwideSourceExecutorContext) {
      const registered = byContract.get(contractKey(context.dispatch));
      if (!registered) {
        throw new Error(`no executor is registered for ${contractKey(context.dispatch)}`);
      }
      await context.renewLease();
      const result = await registered.execute(context);
      if (result.sourceDefinitionId !== context.dispatch.sourceDefinitionId) {
        throw new Error("source executor returned a run for a different source definition");
      }
      if (!RUN_ID_PATTERN.test(result.runId)) {
        throw new Error("source executor returned an invalid ingestion run ID");
      }
      return { ingestionRunId: result.runId };
    },
  });
}
