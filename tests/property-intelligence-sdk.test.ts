import assert from "node:assert/strict";
import test from "node:test";

import {
  AccountabulApiError,
  AccountabulClient,
  type PropertySearchFilters,
} from "../src/lib/property-intelligence/property-intelligence-sdk.ts";

function fakeListResponse(overrides: Record<string, unknown> = {}) {
  return {
    object: "list",
    data: [],
    meta: {
      request_id: "req_11111111-1111-4111-8111-111111111111",
      fetched_at: "2026-09-24T00:00:00.000Z",
      total: 0,
      next_cursor: null,
      limit: 25,
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("SDK sends documented filters + bearer auth, doesn't mutate input", async () => {
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedHeaders = new Headers(init?.headers);
    return jsonResponse(fakeListResponse());
  };

  const client = new AccountabulClient({
    apiKey: "acct_test_key",
    baseUrl: "https://api.accountabul.example",
    fetch: fetchImpl as typeof fetch,
  });

  const filters: PropertySearchFilters = { q: "Main St", ward: 7, sort: "address_asc" };
  const frozenFilters = JSON.stringify(filters);

  await client.properties.list(filters);

  assert.equal(
    frozenFilters,
    JSON.stringify(filters),
    "the caller's filters object must never be mutated",
  );
  assert.equal(
    capturedUrl,
    "https://api.accountabul.example/api/public/property-intelligence/v1/parcels?q=Main+St&ward=7&sort=address_asc",
  );
  assert.equal(capturedHeaders?.get("authorization"), "Bearer acct_test_key");
  assert.equal(capturedHeaders?.get("accept"), "application/json");
});

test("SDK validates filters client-side before ever sending a request", async () => {
  const client = new AccountabulClient({
    apiKey: "k",
    fetch: (async () => jsonResponse(fakeListResponse())) as unknown as typeof fetch,
  });

  await assert.rejects(client.properties.list({ zip: "123" }), TypeError);
  await assert.rejects(client.properties.list({ parcelId: "abc" }), TypeError);
  await assert.rejects(client.properties.list({ ward: 0 }), TypeError);
  await assert.rejects(client.properties.list({ limit: 76 }), TypeError);
  await assert.rejects(client.properties.list({ sort: "bogus" as never }), TypeError);
});

test("SDK surfaces API errors with code/status/requestId/rateLimit intact", async () => {
  const fetchImpl = async () =>
    jsonResponse(
      {
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests.",
          request_id: "req_abc",
        },
      },
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700000000",
          "retry-after": "30",
        },
      },
    );

  const client = new AccountabulClient({ apiKey: "k", fetch: fetchImpl as typeof fetch });

  await assert.rejects(client.properties.list(), (error: unknown) => {
    assert.ok(error instanceof AccountabulApiError);
    assert.equal(error.code, "rate_limit_exceeded");
    assert.equal(error.status, 429);
    assert.equal(error.requestId, "req_abc");
    assert.equal(error.rateLimit.limit, 60);
    assert.equal(error.rateLimit.remaining, 0);
    assert.equal(error.rateLimit.retryAfter, 30);
    return true;
  });
});

test("SDK rejects a response that doesn't match the documented list shape", async () => {
  const client = new AccountabulClient({
    apiKey: "k",
    fetch: (async () => jsonResponse({ not: "a list response" })) as unknown as typeof fetch,
  });
  await assert.rejects(client.properties.list(), /invalid list response/);
});

test("SDK iterate() follows next_cursor across pages and stops at null", async () => {
  const pages = [
    fakeListResponse({ next_cursor: "page_2" }),
    fakeListResponse({ next_cursor: null }),
  ];
  pages[0].data = [{ id: "a" }];
  pages[1].data = [{ id: "b" }];
  let call = 0;
  const fetchImpl = async () => jsonResponse(pages[call++]);

  const client = new AccountabulClient({ apiKey: "k", fetch: fetchImpl as typeof fetch });
  const seen: unknown[] = [];
  for await (const record of client.properties.iterate()) seen.push(record);
  assert.deepEqual(seen, [{ id: "a" }, { id: "b" }]);
  assert.equal(call, 2);
});

test("SDK iterate() throws if the server repeats a pagination cursor", async () => {
  const looping = fakeListResponse({ next_cursor: "page_1" });
  const fetchImpl = async () => jsonResponse(looping);
  const client = new AccountabulClient({ apiKey: "k", fetch: fetchImpl as typeof fetch });

  await assert.rejects(
    (async () => {
      for await (const _record of client.properties.iterate({}, { maxPages: 5 })) {
        // draining
      }
    })(),
    /repeated a pagination cursor/,
  );
});

test("baseUrl must be HTTPS except for localhost", () => {
  assert.throws(
    () => new AccountabulClient({ apiKey: "k", baseUrl: "http://example.com" }),
    TypeError,
  );
  assert.doesNotThrow(
    () => new AccountabulClient({ apiKey: "k", baseUrl: "http://localhost:3000" }),
  );
});
