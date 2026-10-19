// Slice 3 of the nationwide multi-state ingestion port. Behavioral contract
// ported from the source's tests/mississippi-rankin-pdf.test.mjs and
// tests/mississippi-rankin-ingestion.test.mjs, focused on the positioned
// three-column parser, published-summary reconciliation, and normalization
// this slice ports.
import assert from "node:assert/strict";
import test from "node:test";

import { sha256ArtifactBytes } from "../src/lib/property-intelligence/nationwide-artifact-store.ts";
import {
  archiveMississippiRankinTaxSalePdf,
  normalizeMississippiRankinTaxSaleRow,
  parseMississippiRankinPositionedPages,
  parseMississippiRankinTaxSalePdf,
} from "../src/lib/property-intelligence/nationwide-ms-rankin-pdf.ts";
import type { PositionedPdfTextPage } from "../src/lib/property-intelligence/nationwide-pdf-text-layout.ts";

function word(text: string, x0: number, y: number) {
  return { text, x0, x1: x0 + Math.max(text.length, 1) * 5, y };
}

const document = {
  url: "https://www.rankincounty.org/egov/documents/rankin_2025_tax_sale.pdf",
  title: "Rankin County 2025 Delinquent Tax Land Sale",
  sha256: "b".repeat(64),
  retrievedAt: "2026-08-01T12:00:00.000Z",
  publishedAt: null,
  objectStorageKey: "nationwide/mississippi/rankin-county-tax-sale/fixture.pdf",
  mimeType: "application/pdf",
  byteSize: 1_000,
};

function pageOne(recordLines: Array<Array<string | string[]>>): PositionedPdfTextPage {
  const words = [
    word("Source: LRMSAL13 newspaper print file, 6/1/2025. Sale file updated 6/15/2025", 30, 780),
    word("Live bid auction begins Monday, August 25, 2025", 30, 770),
    word(
      "Rankin County, Mississippi — 2025 Delinquent Tax Land Sale (Tax Year 2025) Page 1 of 2",
      30,
      20,
    ),
  ];
  let y = 700;
  for (const lines of recordLines) {
    for (const entry of lines) {
      if (Array.isArray(entry)) {
        entry.forEach((text, index) => words.push(word(text, 30 + index * 40, y)));
      } else {
        words.push(word(entry, 30, y));
      }
      y -= 10;
    }
  }
  return { pageNumber: 1, width: 612, height: 792, words };
}

function summaryPage(): PositionedPdfTextPage {
  const words = [
    word("Summary of Amounts Due", 30, 700),
    word("*TOTAL AMOUNT DUE 0.00 0.00 0.00 823.00", 30, 680),
    word("To be Sold Count........ 1", 30, 670),
    word("Parcels Not Published........ 0", 30, 660),
    word("Total Records Processed. 1", 30, 650),
    word("* 823.00 Total amount Published for sale. 1 Parcels Published", 30, 640),
    word("Options for this Report........ ALL", 30, 630),
    word(
      "Rankin County, Mississippi — 2025 Delinquent Tax Land Sale (Tax Year 2025) Page 2 of 2",
      30,
      20,
    ),
  ];
  return { pageNumber: 2, width: 612, height: 792, words };
}

const oneRecordLines: Array<string | string[]> = [
  "SMITH JOHN",
  ["Receipt No.", "100", "PPIN", "12345"],
  "Sec-17 Twnship-1N Rng-5E TD-01",
  "Sale Sequence 1",
  "LOT 1 BLOCK A",
  "Parcel# - R012345",
  "Acres 1.5",
  "**TOTAL TAX & COST 823.00",
];

test("the positioned Rankin parser recovers owner/PPIN/section/parcel/acres and the total tax and cost", () => {
  const pages = [pageOne([oneRecordLines]), summaryPage()];
  const parsed = parseMississippiRankinPositionedPages({ pages, document });
  assert.equal(parsed.taxYear, 2025);
  assert.equal(parsed.saleDate, "2025-08-25");
  assert.equal(parsed.rows.length, 1);
  const row = parsed.rows[0];
  assert.equal(row?.assessedOwnerName, "SMITH JOHN");
  assert.equal(row?.ppin, "12345");
  assert.equal(row?.receiptNumber, "100");
  assert.equal(row?.section, "17");
  assert.equal(row?.township, "1N");
  assert.equal(row?.range, "5E");
  assert.equal(row?.taxDistrict, "01");
  assert.equal(row?.saleSequence, "1");
  assert.equal(row?.parcelNumber, "R012345");
  assert.equal(row?.acres, 1.5);
  assert.equal(row?.totalTaxAndCost, 823);
  assert.deepEqual(row?.descriptionLines, ["LOT 1 BLOCK A"]);
});

test("reconciliation fails closed when the published total does not tie to the row total", () => {
  const pages = [pageOne([oneRecordLines]), summaryPage()];
  const badSummary = summaryPage();
  badSummary.words = badSummary.words.map((entry) =>
    entry.text.startsWith("*TOTAL AMOUNT DUE")
      ? { ...entry, text: "*TOTAL AMOUNT DUE 0.00 0.00 0.00 999.00" }
      : entry,
  );
  assert.throws(
    () =>
      parseMississippiRankinPositionedPages({
        pages: [pages[0] as PositionedPdfTextPage, badSummary],
        document,
      }),
    /does not match total amount due/i,
  );
});

test("parseMississippiRankinTaxSalePdf hash-verifies the PDF signature before invoking the injected extractor", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  await assert.rejects(
    parseMississippiRankinTaxSalePdf({
      pdfBytes: new TextEncoder().encode("not a pdf"),
      document: { ...document, sha256 },
      extractPages: async () => {
        throw new Error("must not be reached without a PDF signature");
      },
    }),
    /PDF signature/i,
  );
  await assert.rejects(
    parseMississippiRankinTaxSalePdf({
      pdfBytes,
      document: { ...document, sha256: "0".repeat(64) },
      extractPages: async () => {
        throw new Error("must not be reached on a hash mismatch");
      },
    }),
    /immutable source document SHA-256/i,
  );
});

test("the Rankin PDF is hash-verified and content-addressed before archival", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  const writes: unknown[] = [];
  const artifactStore = {
    async putCanonicalJson() {},
    async putBytes(input: unknown) {
      writes.push(input);
    },
  };
  const archived = await archiveMississippiRankinTaxSalePdf({
    pdfBytes,
    document: { ...document, sha256 },
    artifactStore,
  });
  assert.equal(writes.length, 1);
  assert.equal(
    archived.sourceArtifact.objectStorageKey,
    `nationwide/mississippi/rankin-county-tax-sale/${sha256}.pdf`,
  );
});

test("normalizeMississippiRankinTaxSaleRow requires an owner-mailing-free candidate resolution reason and preserves acres as a published observation", async () => {
  const pages = [pageOne([oneRecordLines]), summaryPage()];
  const parsed = parseMississippiRankinPositionedPages({ pages, document });
  const row = parsed.rows[0];
  if (!row) throw new Error("expected a parsed row");
  const bundle = await normalizeMississippiRankinTaxSaleRow(row);
  assert.equal(bundle.resolution.status, "candidate");
  assert.equal(bundle.propertyCandidate.observations[0]?.factType, "published_acres");
  assert.equal(bundle.propertyCandidate.observations[0]?.value, 1.5);
  assert.equal(bundle.auction.amounts[0]?.amount, 823);
  assert.equal(bundle.auction.legalDescription, "LOT 1 BLOCK A");
});
