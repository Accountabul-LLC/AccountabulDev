// Live-execution proof (staged rollout: St. Louis LRA only,
// mo_st_louis_lra_inventory_v1, contract version 3). This slice's two new
// modules perform real I/O by design once invoked
// (nationwide-st-louis-lra-live-fetch.server.ts calls the real ArcGIS
// endpoint; nationwide-live-st-louis-lra.server.ts wires a real injected
// PostgresTransactionHost), so unlike every prior slice's pure/injected-
// dependency code, this is NOT round-trip-testable without a real network
// or database. Instead this test proves the one thing that actually
// regresses silently: importing these modules, and building their exported
// factories, never itself reaches the network, a database, or a credential
// -- every real effect happens only when the function they return/export is
// explicitly invoked, and every environment variable they might one day
// read is read inside a function body, never destructured at module scope.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createStLouisLraLiveFetchRows } from "../src/lib/property-intelligence/nationwide-st-louis-lra-live-fetch.server.ts";
import {
  runLiveStLouisLraIngestion,
  runLiveStLouisLraIngestionWithRealDatabase,
} from "../src/lib/property-intelligence/nationwide-live-st-louis-lra.server.ts";
import type { PostgresTransactionHost } from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

const LIVE_MODULE_PATHS = [
  "../src/lib/property-intelligence/nationwide-st-louis-lra-live-fetch.server.ts",
  "../src/lib/property-intelligence/nationwide-live-st-louis-lra.server.ts",
] as const;

function sourceOf(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("importing the live modules (already done above, statically) never throws or reaches out", () => {
  // If either module attempted a real fetch, a real `pg` connection, or a
  // process.env read that threw on a missing variable at import time, the
  // static imports above -- which ran before this test body -- would already
  // have failed the whole test file. Reaching this line IS the assertion.
  assert.equal(typeof createStLouisLraLiveFetchRows, "function");
  assert.equal(typeof runLiveStLouisLraIngestion, "function");
  assert.equal(typeof runLiveStLouisLraIngestionWithRealDatabase, "function");
});

test("runLiveStLouisLraIngestionWithRealDatabase throws on the missing env var before any pg import resolves", async () => {
  const originalUrl = process.env["NATIONWIDE_DATABASE_URL"];
  delete process.env["NATIONWIDE_DATABASE_URL"];
  try {
    await assert.rejects(
      runLiveStLouisLraIngestionWithRealDatabase({
        sourceDefinitionId: "11111111-1111-4111-8111-111111111111",
        jurisdictionId: "11111111-1111-4111-8111-111111111111",
        artifactStore: { putCanonicalJson: async () => {} },
      }),
      /Missing NATIONWIDE_DATABASE_URL/,
    );
  } finally {
    if (originalUrl !== undefined) process.env["NATIONWIDE_DATABASE_URL"] = originalUrl;
  }
});

test("createStLouisLraLiveFetchRows never calls fetchImpl before its returned function is invoked", () => {
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    throw new Error("must not be called -- this test never invokes the returned fetchRows");
  }) as unknown as typeof fetch;
  const artifactStore = {
    putCanonicalJson: async () => {
      throw new Error("must not be called -- this test never invokes the returned fetchRows");
    },
  };

  const fetchRows = createStLouisLraLiveFetchRows({ fetchImpl, artifactStore });

  assert.equal(typeof fetchRows, "function");
  assert.equal(fetchCalls, 0, "constructing the fetcher must not perform any HTTP request");
});

test("createStLouisLraLiveFetchRows requires an injected artifactStore -- no default store", () => {
  assert.throws(() => {
    // @ts-expect-error -- exercising the runtime guard for a caller that skips the type system
    createStLouisLraLiveFetchRows({});
  }, /requires an injected artifactStore/);
});

test("runLiveStLouisLraIngestion requires an injected database -- there is no default connection", async () => {
  await assert.rejects(
    runLiveStLouisLraIngestion({
      // @ts-expect-error -- exercising the runtime guard for a caller that skips the type system
      database: undefined,
      sourceDefinitionId: "11111111-1111-4111-8111-111111111111",
      jurisdictionId: "11111111-1111-4111-8111-111111111111",
      artifactStore: { putCanonicalJson: async () => {} },
    }),
    /requires an injected PostgresTransactionHost/,
  );
});

test("runLiveStLouisLraIngestion never opens a transaction before its own validation runs", async () => {
  let transactionCalls = 0;
  const database: PostgresTransactionHost = {
    transaction: async () => {
      transactionCalls += 1;
      throw new Error("must not be called -- this call is expected to fail validation first");
    },
  };

  await assert.rejects(
    runLiveStLouisLraIngestion({
      database,
      sourceDefinitionId: "",
      jurisdictionId: "",
      artifactStore: { putCanonicalJson: async () => {} },
    }),
    /requires the live sourceDefinitionId and jurisdictionId/,
  );
  assert.equal(transactionCalls, 0);
});

test("neither live module directly imports the `pg` package -- only nationwide-postgres-client.server.ts does", () => {
  // `pg` is now an approved dependency, but these two modules stay
  // pg-free: nationwide-live-st-louis-lra.server.ts only reaches
  // nationwide-postgres-client.server.ts (the real pg-backed factory) via a
  // dynamic import inside runLiveStLouisLraIngestionWithRealDatabase, and
  // nationwide-st-louis-lra-live-fetch.server.ts never touches Postgres at
  // all -- keeping the testable, injected-database code path (
  // runLiveStLouisLraIngestion) free of any pg import.
  for (const path of LIVE_MODULE_PATHS) {
    const source = sourceOf(path);
    assert.doesNotMatch(
      source,
      /from\s+["']pg["']|require\(\s*["']pg["']\s*\)/,
      `${path} must not directly import "pg"`,
    );
  }
});

test("neither live module reads process.env at column zero (module scope, not inside a function)", () => {
  // Grep-based, matching this repo's existing style for this kind of check
  // (see nationwide-pg-transaction-host.ts / client.server.ts conventions):
  // every real handler in this repo indents a `process.env` read inside a
  // function body, so an unindented occurrence at the start of a line is
  // the module-scope destructuring this guards against. Neither live module
  // reads process.env directly at all today (credentials flow in through
  // injected parameters instead), so this also fails loudly the day one is
  // added at the wrong scope.
  for (const path of LIVE_MODULE_PATHS) {
    const source = sourceOf(path);
    for (const line of source.split("\n")) {
      assert.doesNotMatch(
        line,
        /^(const|let|var)\s.*process\.env/,
        `${path} must only read process.env inside a function body, never destructured at module scope: "${line}"`,
      );
      assert.ok(
        !/^process\.env/.test(line),
        `${path} must only read process.env inside a function body, never at module scope: "${line}"`,
      );
    }
  }
});
