// Contract for the St. Louis Sheriff landing-page discovery, ported from
// property-intelligence-app's nationwide-st-louis-sheriff-tax-sale.ts.
//
// This parser's output becomes a URL something later fetches, so the tests
// here are mostly adversarial: an injected PDF link, a renamed page, a
// mismatched sale number, or a URL carrying credentials must all fail the
// parse rather than produce a fetchable target.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStLouisSheriffRetrievalUrl,
  parseStLouisSheriffLandingPage,
  ST_LOUIS_SHERIFF_CURRENT_LIST_URL,
} from "../src/lib/property-intelligence/nationwide-st-louis-sheriff-landing.ts";

const PREFIX = "/government/departments/sheriff/documents/upload/";

function landingPage(anchors: string, options: { identity?: boolean } = {}) {
  const identity =
    options.identity === false
      ? "<p>Some other page entirely.</p>"
      : `<h1>Current Land Tax Sale Properties</h1>
         <p>The Land Tax Sale Properties List is posted two weeks prior to the sale.</p>`;
  return `<html><body>${identity}${anchors}${"<!-- padding -->".repeat(60)}</body></html>`;
}

const goodAnchor = `<a href="${PREFIX}231-land-tax-sale.pdf">Sale 231: March 12, 2026</a>`;

test("the current sale is read from the single reviewed PDF anchor", () => {
  const contract = parseStLouisSheriffLandingPage(landingPage(goodAnchor));
  assert.equal(contract.currentSale?.saleNumber, "231");
  assert.equal(contract.currentSale?.saleDate, "2026-03-12");
  assert.equal(
    contract.currentSale?.pdfUrl,
    `https://www.stlouis-mo.gov${PREFIX}231-land-tax-sale.pdf`,
  );
});

test("a page with no sale PDF reports no current sale rather than failing", () => {
  const contract = parseStLouisSheriffLandingPage(landingPage(""));
  assert.equal(contract.currentSale, null);
});

test("an unreviewed PDF target fails the whole parse instead of being filtered out", () => {
  const injected = `${goodAnchor}<a href="https://evil.example.com/steal.pdf">Sale 999: April 1, 2026</a>`;
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(injected)),
    /unreviewed PDF target/i,
    "filtering would let an injected link sit beside the genuine one unnoticed",
  );
});

test("a PDF on the city origin but outside the reviewed document path is refused", () => {
  const offPath = `<a href="/government/elsewhere/231-land-tax-sale.pdf">Sale 231: March 12, 2026</a>`;
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(offPath)),
    /unreviewed PDF target/i,
  );
});

test("a page that no longer identifies itself is treated as a changed contract", () => {
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(goodAnchor, { identity: false })),
    /landing-page identity changed/i,
  );
});

test("two competing sale PDFs are ambiguous and refused", () => {
  const second = `<a href="${PREFIX}232-land-tax-sale.pdf">Sale 232: April 9, 2026</a>`;
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(goodAnchor + second)),
    /at most one current sale PDF/i,
  );
});

test("a label that does not match the sale-number-and-date shape is refused", () => {
  const vague = `<a href="${PREFIX}231-land-tax-sale.pdf">Current sale list</a>`;
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(vague)),
    /expected sale number and date/i,
  );
});

test("a filename that disagrees with the label's sale number is refused", () => {
  const mismatch = `<a href="${PREFIX}999-land-tax-sale.pdf">Sale 231: March 12, 2026</a>`;
  assert.throws(
    () => parseStLouisSheriffLandingPage(landingPage(mismatch)),
    /reviewed city document contract/i,
  );
});

test("an impossible calendar date is refused", () => {
  const badDate = `<a href="${PREFIX}231-land-tax-sale.pdf">Sale 231: February 31, 2026</a>`;
  assert.throws(() => parseStLouisSheriffLandingPage(landingPage(badDate)), /invalid date/i);
});

test("an implausibly small or large page is refused before parsing", () => {
  assert.throws(() => parseStLouisSheriffLandingPage("<html></html>"), /supported size boundary/i);
  assert.throws(
    () => parseStLouisSheriffLandingPage("x".repeat(2_000_001)),
    /supported size boundary/i,
  );
});

test("retrieval URLs are restricted to the reviewed page and document path", () => {
  assert.equal(
    assertStLouisSheriffRetrievalUrl(ST_LOUIS_SHERIFF_CURRENT_LIST_URL, "landing"),
    ST_LOUIS_SHERIFF_CURRENT_LIST_URL,
  );
  assert.throws(
    () => assertStLouisSheriffRetrievalUrl("https://www.stlouis-mo.gov/other", "landing"),
    /reviewed city page/i,
  );
  assert.equal(
    assertStLouisSheriffRetrievalUrl(
      `https://www.stlouis-mo.gov${PREFIX}231-land-tax-sale.pdf`,
      "pdf",
    ),
    `https://www.stlouis-mo.gov${PREFIX}231-land-tax-sale.pdf`,
  );
  assert.throws(
    () =>
      assertStLouisSheriffRetrievalUrl(
        `https://user:pass@www.stlouis-mo.gov${PREFIX}231-land-tax-sale.pdf`,
        "pdf",
      ),
    /reviewed city document path/i,
  );
  assert.throws(
    () =>
      assertStLouisSheriffRetrievalUrl(
        `https://www.stlouis-mo.gov${PREFIX}231-land-tax-sale.pdf?x=1`,
        "pdf",
      ),
    /reviewed city document path/i,
  );
  assert.throws(
    () => assertStLouisSheriffRetrievalUrl("https://evil.example.com/a.pdf", "pdf"),
    /reviewed city document path/i,
  );
});
