// Contract for canonical-property-feed, the read layer over the nationwide
// property_api.* projections (property_search, auction_lot_search,
// property_record_search) that 20260924170000 adds. Ported from
// property-intelligence-app@785747d; assertions ported from that repo's
// tests/canonical-property-search.test.mjs.
//
// The invariant worth guarding here is that a malformed search request is
// rejected BEFORE any network call: the fetch implementation passed below
// throws if it is ever reached, so a test that passes proves validation runs
// first rather than forwarding junk to the upstream API.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalPropertySearchPayload,
  normalizeCanonicalPropertySearchRequest,
} from "../src/lib/property-intelligence/canonical-property-feed.ts";

const config = {
  supabaseUrl: "https://example.supabase.co",
  anonKey: "public-test-key",
};

const networkMustNotRun = (async () => {
  throw new Error("network must not run");
}) as unknown as typeof fetch;

test("a search request is normalized into bounded, canonical parameters", () => {
  const request = normalizeCanonicalPropertySearchRequest({
    query: "  road  ",
    stateCode: "MS",
    sort: "record_order",
    pageSize: 2,
  });
  assert.equal(request.query, "road", "surrounding whitespace is trimmed");
  assert.equal(request.stateCode, "MS");
  assert.equal(request.pageSize, 2);
});

test("state code must be an exact two-letter USPS code", () => {
  assert.throws(
    () => normalizeCanonicalPropertySearchRequest({ stateCode: "ms" }),
    /exact two-letter USPS code/i,
  );
  assert.throws(
    () => normalizeCanonicalPropertySearchRequest({ stateCode: "MISS" }),
    /exact two-letter USPS code/i,
  );
});

test("page size is bounded so one request cannot drain the projection", () => {
  assert.throws(
    () => normalizeCanonicalPropertySearchRequest({ pageSize: 76 }),
    /between 1 and 75/i,
  );
  assert.throws(
    () => normalizeCanonicalPropertySearchRequest({ pageSize: 0 }),
    /between 1 and 75/i,
  );
  assert.equal(normalizeCanonicalPropertySearchRequest({ pageSize: 75 }).pageSize, 75);
});

test("an invalid cursor is rejected before any network access", async () => {
  await assert.rejects(
    getCanonicalPropertySearchPayload(
      config,
      { query: "different", cursor: "bm90LWEtY3Vyc29y" },
      networkMustNotRun,
    ),
    /cursor is invalid/i,
  );
});
