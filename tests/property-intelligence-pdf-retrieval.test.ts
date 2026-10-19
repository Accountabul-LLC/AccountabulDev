// Contract for the shared nationwide PDF retrieval step.
//
// This is the only place the nationwide PDF path touches the network, and its
// output is archived as the official record of a tax sale, so the tests here
// are about what it REFUSES: an unvouched URL, a redirect off the allowlisted
// origin, plaintext HTTP, an oversized body, and a non-PDF payload served
// with a 200.
import assert from "node:assert/strict";
import test from "node:test";

import { retrieveNationwidePdf } from "../src/lib/property-intelligence/nationwide-pdf-retrieval.server.ts";

const URL_OK = "https://www.example.gov/docs/report.pdf";
const allowExample = (url: string) => {
  const parsed = new URL(url);
  if (parsed.hostname !== "www.example.gov") throw new Error("unreviewed host");
  return parsed.toString();
};

function pdfBytes(body = "%PDF-1.7\nreal report bytes\n") {
  return new TextEncoder().encode(body);
}

function respondWith(bytes: Uint8Array, init: ResponseInit = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    return new Response(bytes as unknown as BodyInit, { status: 200, ...init });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("a retrieved PDF comes back with its bytes, its size and its own SHA-256", async () => {
  const { calls, impl } = respondWith(pdfBytes());
  const result = await retrieveNationwidePdf({
    url: URL_OK,
    assertUrl: allowExample,
    fetchImpl: impl,
  });
  assert.equal(result.url, URL_OK);
  assert.equal(result.byteSize, result.pdfBytes.byteLength);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    calls[0]?.init.redirect,
    "error",
    "a redirect is the cheap way off an allowlisted origin after the guard passed",
  );
});

test("the SHA-256 is of the bytes actually received", async () => {
  const first = await retrieveNationwidePdf({
    url: URL_OK,
    assertUrl: allowExample,
    fetchImpl: respondWith(pdfBytes("%PDF-1.7\nalpha\n")).impl,
  });
  const second = await retrieveNationwidePdf({
    url: URL_OK,
    assertUrl: allowExample,
    fetchImpl: respondWith(pdfBytes("%PDF-1.7\nbeta\n")).impl,
  });
  assert.notEqual(first.sha256, second.sha256, "different bytes must not share a digest");
});

test("a URL the owning source module does not vouch for is never fetched", async () => {
  const { calls, impl } = respondWith(pdfBytes());
  await assert.rejects(
    retrieveNationwidePdf({
      url: "https://evil.example.com/steal.pdf",
      assertUrl: allowExample,
      fetchImpl: impl,
    }),
    /unreviewed host/,
  );
  assert.equal(calls.length, 0, "the guard runs before any request");
});

test("retrieval without a guard is refused outright rather than defaulting to an allowlist", async () => {
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: undefined as unknown as (url: string) => string,
      fetchImpl: respondWith(pdfBytes()).impl,
    }),
    /requires the owning source module's URL guard/,
  );
});

test("plaintext HTTP is refused even when the guard allows it", async () => {
  const { calls, impl } = respondWith(pdfBytes());
  await assert.rejects(
    retrieveNationwidePdf({
      url: "http://www.example.gov/docs/report.pdf",
      assertUrl: (url) => url,
      fetchImpl: impl,
    }),
    /restricted to HTTPS/,
  );
  assert.equal(calls.length, 0);
});

test("a body past the cap fails while reading rather than after buffering it all", async () => {
  const oversized = new Uint8Array(40_000);
  oversized.set(pdfBytes("%PDF-"), 0);
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: allowExample,
      fetchImpl: respondWith(oversized).impl,
      maxBytes: 8_192,
    }),
    /exceeded the maximum allowed size/,
  );
});

test("an HTML error page served with a 200 is not archived as the report", async () => {
  const html = new TextEncoder().encode("<html><body>Service unavailable</body></html>");
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: allowExample,
      fetchImpl: respondWith(html).impl,
    }),
    /did not return PDF bytes/,
  );
});

test("a non-2xx response is a failure, not an empty report", async () => {
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: allowExample,
      fetchImpl: respondWith(pdfBytes(), { status: 503 }).impl,
    }),
    /HTTP 503/,
  );
});

test("the size and timeout bounds are themselves validated", async () => {
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: allowExample,
      fetchImpl: respondWith(pdfBytes()).impl,
      maxBytes: 10,
    }),
    /maxBytes must be an integer/,
  );
  await assert.rejects(
    retrieveNationwidePdf({
      url: URL_OK,
      assertUrl: allowExample,
      fetchImpl: respondWith(pdfBytes()).impl,
      timeoutMillis: 5,
    }),
    /timeoutMillis must be an integer/,
  );
});
