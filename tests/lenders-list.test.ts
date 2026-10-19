import assert from "node:assert/strict";
import test from "node:test";

import { resolveLendersListUrl } from "../src/lib/lenders-list.ts";

test("lenders list URL accepts https and hides everything else", () => {
  assert.equal(
    resolveLendersListUrl("https://lenders.accountabul.com"),
    "https://lenders.accountabul.com",
  );
  assert.equal(
    resolveLendersListUrl("  https://lenders.accountabul.com  "),
    "https://lenders.accountabul.com",
  );
  assert.equal(resolveLendersListUrl(""), null);
  assert.equal(resolveLendersListUrl(undefined), null);
  assert.equal(resolveLendersListUrl("http://lenders.accountabul.com"), null);
  assert.equal(
    resolveLendersListUrl("https://lenders-list.outstanding-address-f7a.workers.dev"),
    "https://lenders-list.outstanding-address-f7a.workers.dev",
  );
});

test("lenders list URL allows localhost only when local http is opted in", () => {
  assert.equal(resolveLendersListUrl("http://127.0.0.1:5173"), null);
  assert.equal(resolveLendersListUrl("http://127.0.0.1:5173", true), "http://127.0.0.1:5173");
  assert.equal(resolveLendersListUrl("http://localhost:5173", true), "http://localhost:5173");
  assert.equal(resolveLendersListUrl("http://example.com", true), null);
});
