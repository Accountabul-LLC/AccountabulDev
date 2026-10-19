// nationwide-postgres-client.server.ts is the real `pg`-backed
// PostgresTransactionHost implementation. `pg` is now an approved
// dependency, but this module still never connects at import time or module
// scope -- NATIONWIDE_DATABASE_URL is read lazily, inside a function, and
// this repo's own environment has no real value for it anywhere.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { withRealNationwidePgTransactionHost } from "../src/lib/property-intelligence/nationwide-postgres-client.server.ts";

const MODULE_PATH = "../src/lib/property-intelligence/nationwide-postgres-client.server.ts";

function moduleSource() {
  return readFileSync(fileURLToPath(new URL(MODULE_PATH, import.meta.url)), "utf8");
}

test("importing the module (already done above, statically) never connects or throws", () => {
  // If this module read NATIONWIDE_DATABASE_URL or constructed a pg.Client
  // at module scope, the static import above -- which ran before this test
  // body -- would already have failed the whole file.
  assert.equal(typeof withRealNationwidePgTransactionHost, "function");
});

test("withRealNationwidePgTransactionHost throws on a missing NATIONWIDE_DATABASE_URL before opening any connection", async () => {
  const originalUrl = process.env["NATIONWIDE_DATABASE_URL"];
  delete process.env["NATIONWIDE_DATABASE_URL"];
  let callbackCalls = 0;
  try {
    await assert.rejects(
      withRealNationwidePgTransactionHost(async () => {
        callbackCalls += 1;
        throw new Error("must not be called -- the env var is missing");
      }),
      /Missing NATIONWIDE_DATABASE_URL environment variable/,
    );
  } finally {
    if (originalUrl !== undefined) process.env["NATIONWIDE_DATABASE_URL"] = originalUrl;
  }
  assert.equal(
    callbackCalls,
    0,
    "the callback must never run when the connection string is missing",
  );
});

test("withRealNationwidePgTransactionHost rejects an empty-string NATIONWIDE_DATABASE_URL the same way", async () => {
  const originalUrl = process.env["NATIONWIDE_DATABASE_URL"];
  process.env["NATIONWIDE_DATABASE_URL"] = "";
  try {
    await assert.rejects(
      withRealNationwidePgTransactionHost(async () => {
        throw new Error("must not be called");
      }),
      /Missing NATIONWIDE_DATABASE_URL environment variable/,
    );
  } finally {
    if (originalUrl === undefined) delete process.env["NATIONWIDE_DATABASE_URL"];
    else process.env["NATIONWIDE_DATABASE_URL"] = originalUrl;
  }
});

test("process.env is read only inside a function body, never destructured at module scope", () => {
  const source = moduleSource();
  for (const line of source.split("\n")) {
    assert.doesNotMatch(
      line,
      /^(const|let|var)\s.*process\.env/,
      `must only read process.env inside a function body, never destructured at module scope: "${line}"`,
    );
    assert.ok(
      !/^process\.env/.test(line),
      `must only read process.env inside a function body, never at module scope: "${line}"`,
    );
  }
});

test("the pg Client is constructed only inside createRealNationwidePgClient, never at module scope", () => {
  const source = moduleSource();
  for (const line of source.split("\n")) {
    assert.doesNotMatch(
      line,
      /^(const|let|var)\s.*new Client\(/,
      `must only construct a pg Client inside a function body, never at module scope: "${line}"`,
    );
  }
});
