// Slice 4 of the nationwide multi-state ingestion port. Proves that all six
// named source adapters are registered into Slice 2's
// `createNationwideSourceExecutorRegistry` under the exact (source_key,
// contract_version) pairs the source app's own
// NATIONWIDE_PILOT_SOURCE_MANIFESTS uses, and that building the registry --
// and importing this module at all -- never reaches a network or a
// database: `createNationwideSourceAdapterBindings` /
// `createNationwideSourceAdapterRegistry` both require an injected
// dependency bag with NO DEFAULT (see nationwide-source-adapter-bindings.ts's
// header), so this test constructs one from small stand-in fakes that never
// touch a real connection, the same way every other Slice 4 test does.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createNationwideSourceAdapterBindings,
  createNationwideSourceAdapterRegistry,
  type NationwideSourceAdapterDependencies,
} from "../src/lib/property-intelligence/nationwide-source-adapter-bindings.ts";
import type { PostgresTransactionHost } from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

const EXPECTED_CONTRACTS = [
  { sourceKey: "mo_st_louis_lra_inventory_v1", contractVersion: 3 },
  { sourceKey: "mo_st_louis_sheriff_tax_sale_v1", contractVersion: 3 },
  { sourceKey: "ms_county_tax_sale_report_v1", contractVersion: 1 },
  { sourceKey: "ms_desoto_county_landroll_2026_prelim_v1", contractVersion: 1 },
  { sourceKey: "ms_rankin_county_tax_sale_report_v1", contractVersion: 1 },
  { sourceKey: "ms_sos_active_tax_forfeited_inventory_v1", contractVersion: 1 },
] as const;

const UUID = "11111111-1111-4111-8111-111111111111";

function uuidsFor<T>(value: T) {
  return {
    mo_st_louis_lra_inventory_v1: value,
    mo_st_louis_sheriff_tax_sale_v1: value,
    ms_county_tax_sale_report_v1: value,
    ms_desoto_county_landroll_2026_prelim_v1: value,
    ms_rankin_county_tax_sale_report_v1: value,
    ms_sos_active_tax_forfeited_inventory_v1: value,
  };
}

function neverFetches(): never {
  throw new Error("must not be called -- this test never invokes execute()");
}

function fakeDependencies(): NationwideSourceAdapterDependencies {
  const database: PostgresTransactionHost = {
    transaction: async () => {
      throw new Error("must not be called -- building bindings never opens a transaction");
    },
  };
  return {
    database,
    sourceDefinitionIds: uuidsFor(UUID),
    jurisdictionIds: uuidsFor(UUID),
    fetchRows: uuidsFor(
      neverFetches,
    ) as unknown as NationwideSourceAdapterDependencies["fetchRows"],
  };
}

test("every named source adapter is registered under its exact (source_key, contract_version)", () => {
  const registry = createNationwideSourceAdapterRegistry(fakeDependencies());
  const registered = [...registry.allowedSourceContracts].sort(
    (left, right) =>
      left.sourceKey.localeCompare(right.sourceKey) || left.contractVersion - right.contractVersion,
  );
  const expected = [...EXPECTED_CONTRACTS].sort(
    (left, right) =>
      left.sourceKey.localeCompare(right.sourceKey) || left.contractVersion - right.contractVersion,
  );
  assert.deepEqual(registered, expected);
});

test("building the bindings requires an injected database -- there is no default connection", () => {
  const dependencies = fakeDependencies();
  // @ts-expect-error -- exercising the runtime guard for a caller that skips the type system
  assert.throws(
    () => createNationwideSourceAdapterBindings({ ...dependencies, database: undefined }),
    /requires an injected database/,
  );
});

test("an unregistered contract is rejected by the routing mechanism before any binding runs", async () => {
  const registry = createNationwideSourceAdapterRegistry(fakeDependencies());
  await assert.rejects(
    registry.execute({
      dispatch: {
        sourceKey: "unregistered_source_v1",
        contractVersion: 1,
        dispatchId: "11111111-1111-4111-8111-111111111111",
        sourceDefinitionId: "22222222-2222-4222-8222-222222222222",
        scheduledFor: "2026-08-20T00:00:00.000Z",
        attempt: 1,
      },
      renewLease: async () => {
        throw new Error("must not be reached for an unregistered contract");
      },
    }),
    /no executor is registered/i,
  );
});

test("calling execute for a registered contract reaches the injected fetch stub, never a real connection", async () => {
  const registry = createNationwideSourceAdapterRegistry(fakeDependencies());
  const dispatch = {
    sourceKey: "ms_sos_active_tax_forfeited_inventory_v1",
    contractVersion: 1,
    dispatchId: "11111111-1111-4111-8111-111111111111",
    sourceDefinitionId: UUID,
    scheduledFor: "2026-08-20T00:00:00.000Z",
    attempt: 1,
  };
  // The fake `fetchRows` throws synchronously -- proving execute() actually
  // reaches into the injected dependency (the wiring is exercised) without
  // ever touching a network or a database.
  await assert.rejects(
    registry.execute({ dispatch, renewLease: async () => dispatch }),
    /must not be called -- this test never invokes execute\(\)/,
  );
});
