// Slice 2 of the nationwide multi-state ingestion port. Ported behavioral
// contract from the source's tests/nationwide-source-executor-registry.test.mjs
// ("routes and verifies one exact immutable source contract"), against this
// repo's registry MECHANISM (no real adapters registered -- see the module's
// header). A fake adapter proves the routing/verification the same way the
// source's test does.
import assert from "node:assert/strict";
import test from "node:test";

import { createNationwideSourceExecutorRegistry } from "../src/lib/property-intelligence/nationwide-source-executor-registry.ts";

const sourceDefinitionId = "10000000-0000-4000-8000-000000000001";
const runId = "10000000-0000-4000-8000-000000000002";

function dispatch(overrides: Partial<ReturnType<typeof baseDispatch>> = {}) {
  return { ...baseDispatch(), ...overrides };
}

function baseDispatch() {
  return {
    dispatchId: "10000000-0000-4000-8000-000000000003",
    sourceDefinitionId,
    sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
    contractVersion: 3,
    scheduledFor: "2026-08-20T07:00:00.000Z",
    attempt: 1,
  };
}

test("the executor registry routes and verifies one exact immutable source contract", async () => {
  let renewals = 0;
  let executions = 0;
  const registry = createNationwideSourceExecutorRegistry([
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      async execute({ dispatch: currentDispatch }) {
        executions += 1;
        return { sourceDefinitionId: currentDispatch.sourceDefinitionId, runKey: "run-key", runId };
      },
    },
  ]);
  assert.deepEqual(registry.allowedSourceContracts, [
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
    },
  ]);
  const currentDispatch = dispatch();
  const execution = await registry.execute({
    dispatch: currentDispatch,
    async renewLease() {
      renewals += 1;
      return currentDispatch;
    },
  });
  assert.deepEqual(execution, { ingestionRunId: runId });
  assert.equal(renewals, 1);
  assert.equal(executions, 1);
});

test("the executor registry rejects duplicate bindings and unregistered contracts", async () => {
  assert.throws(
    () =>
      createNationwideSourceExecutorRegistry([
        {
          sourceKey: "a",
          contractVersion: 1,
          async execute() {
            throw new Error("must not execute");
          },
        },
        {
          sourceKey: "a",
          contractVersion: 1,
          async execute() {
            throw new Error("must not execute");
          },
        },
      ]),
    /duplicate contract/i,
  );
  const registry = createNationwideSourceExecutorRegistry([
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      async execute({ dispatch: currentDispatch }) {
        return { sourceDefinitionId: currentDispatch.sourceDefinitionId, runKey: "run-key", runId };
      },
    },
  ]);
  await assert.rejects(
    registry.execute({
      dispatch: dispatch({ contractVersion: 2 }),
      async renewLease() {
        throw new Error("must not renew");
      },
    }),
    /no executor is registered/i,
  );
});

test("the executor registry rejects a finalized run that belongs to another dispatch", async () => {
  const currentDispatch = dispatch();
  const wrongSource = createNationwideSourceExecutorRegistry([
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      async execute() {
        return {
          sourceDefinitionId: "10000000-0000-4000-8000-000000000099",
          runKey: "run-key",
          runId,
        };
      },
    },
  ]);
  await assert.rejects(
    wrongSource.execute({
      dispatch: currentDispatch,
      async renewLease() {
        return currentDispatch;
      },
    }),
    /different source definition/i,
  );

  const wrongRunId = createNationwideSourceExecutorRegistry([
    {
      sourceKey: "mo_st_louis_sheriff_tax_sale_v1",
      contractVersion: 3,
      async execute() {
        return {
          sourceDefinitionId: currentDispatch.sourceDefinitionId,
          runKey: "run-key",
          runId: "not-a-uuid",
        };
      },
    },
  ]);
  await assert.rejects(
    wrongRunId.execute({
      dispatch: currentDispatch,
      async renewLease() {
        return currentDispatch;
      },
    }),
    /invalid ingestion run ID/i,
  );
});
