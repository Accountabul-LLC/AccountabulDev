// Slice 3 of the nationwide multi-state ingestion port. Ported behavioral
// contract from the source's tests/st-louis-official-sheriff-tax-sale.test.mjs,
// focused on the positioned-column parser and normalization this slice
// ports (the source test additionally exercises the DB-writing orchestrator,
// which is out of scope through this slice -- see this repo's
// nationwide-ingestion-orchestrator.ts).
import assert from "node:assert/strict";
import test from "node:test";

import { sha256ArtifactBytes } from "../src/lib/property-intelligence/nationwide-artifact-store.ts";
import {
  archiveStLouisSheriffTaxSalePdf,
  normalizeStLouisSheriffTaxSaleRow,
  parseStLouisSheriffTaxSalePages,
  parseStLouisSheriffTaxSalePdf,
  type StLouisSheriffTaxSaleRow,
} from "../src/lib/property-intelligence/nationwide-st-louis-sheriff-pdf.ts";
import type { PositionedPdfTextPage } from "../src/lib/property-intelligence/nationwide-pdf-text-layout.ts";

function word(text: string, x0: number, y: number) {
  return { text, x0, x1: x0 + text.length * 5, y };
}

function sheriffPage(input: {
  saleNumber: string;
  pageNumber: number;
  pageCount: number;
  footerDate: string;
  rows: Array<{ landTax: string; owner: string; address: string; total: string }>;
}): PositionedPdfTextPage {
  const words = [
    word(`Sale ${input.saleNumber}`, 200, 760),
    word("Property Listing", 200, 740),
    word("This property address is intended for guidance only.", 20, 725),
    word("OFFICIAL notice is published in the St. Louis Daily Record.", 20, 715),
    word("Land Tax #", 54.2, 630),
    word("Owner", 125.9, 630),
    word("Address", 332, 630),
    word("Total", 490, 630),
    word(`Page ${input.pageNumber} of ${input.pageCount}`, 250, 50),
    word(input.footerDate, 20, 40),
  ];
  input.rows.forEach((row, index) => {
    const y = 617.6 - index * 10;
    words.push(word(row.landTax, 54.2, y));
    words.push(word(row.owner, 125.9, y));
    words.push(word(row.address, 332, y));
    words.push(word(row.total, 490, y));
  });
  return { pageNumber: input.pageNumber, width: 612.16, height: 792.07, words };
}

const document = {
  url: "https://www.stlouis-mo.gov/government/departments/sheriff/documents/upload/123-tax-sale.pdf",
  title: "Sale 123: August 25, 2026",
  sha256: "a".repeat(64),
  retrievedAt: "2026-08-01T12:00:00.000Z",
  publishedAt: "2026-07-01T12:00:00.000Z",
};

test("the positioned Sheriff parser recovers land-tax/owner/address/total columns and the footer date", () => {
  const page = sheriffPage({
    saleNumber: "123",
    pageNumber: 1,
    pageCount: 1,
    footerDate: "Wednesday, July 1, 2026",
    rows: [
      { landTax: "123-1", owner: "SMITH JOHN", address: "100 MAIN ST", total: "$1,234.56" },
      { landTax: "123-2", owner: "DOE JANE", address: "200 ELM AV", total: "$500.00" },
    ],
  });
  const parsed = parseStLouisSheriffTaxSalePages({
    pages: [page],
    document: { ...document, publishedAt: "2026-07-01T12:00:00.000Z" },
    saleNumber: "123",
    saleDate: "2026-08-25",
  });
  assert.equal(parsed.publishedDate, "2026-07-01");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.landTaxNumber, "123-1");
  assert.equal(parsed.rows[0]?.owner, "SMITH JOHN");
  assert.equal(parsed.rows[0]?.address, "100 MAIN ST");
  assert.equal(parsed.rows[0]?.totalDue, 1_234.56);
  assert.equal(parsed.rows[1]?.totalDue, 500);
});

test("a shifted land-tax column fails closed", () => {
  const page = sheriffPage({
    saleNumber: "123",
    pageNumber: 1,
    pageCount: 1,
    footerDate: "Wednesday, July 1, 2026",
    rows: [{ landTax: "123-1", owner: "SMITH JOHN", address: "100 MAIN ST", total: "$1,234.56" }],
  });
  page.words = page.words.map((entry) => (entry.text === "123-1" ? { ...entry, x0: 999 } : entry));
  assert.throws(
    () =>
      parseStLouisSheriffTaxSalePages({
        pages: [page],
        document,
        saleNumber: "123",
        saleDate: "2026-08-25",
      }),
    /unclassified data-region line|shifted land-tax column/i,
  );
});

test("parseStLouisSheriffTaxSalePdf hash-verifies the PDF signature before invoking the injected extractor", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  await assert.rejects(
    parseStLouisSheriffTaxSalePdf({
      pdfBytes: new TextEncoder().encode("not a pdf"),
      document: { ...document, sha256 },
      saleNumber: "123",
      saleDate: "2026-08-25",
      extractPages: async () => {
        throw new Error("must not be reached without a valid PDF signature");
      },
    }),
    /PDF signature/i,
  );
  await assert.rejects(
    parseStLouisSheriffTaxSalePdf({
      pdfBytes,
      document: { ...document, sha256: "0".repeat(64) },
      saleNumber: "123",
      saleDate: "2026-08-25",
      extractPages: async () => {
        throw new Error("must not be reached on a hash mismatch");
      },
    }),
    /immutable source document SHA-256/i,
  );
});

test("the Sheriff PDF is hash-verified and content-addressed before archival", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  const writes: unknown[] = [];
  const artifactStore = {
    async putCanonicalJson() {},
    async putBytes(input: unknown) {
      writes.push(input);
    },
  };
  const archived = await archiveStLouisSheriffTaxSalePdf({
    pdfBytes,
    document: { ...document, sha256 },
    artifactStore,
  });
  assert.equal(writes.length, 1);
  assert.equal(
    archived.sourceArtifact.objectStorageKey,
    `nationwide/missouri/st-louis/sheriff-tax-sale/${sha256}.pdf`,
  );
  await assert.rejects(
    archiveStLouisSheriffTaxSalePdf({
      pdfBytes,
      document: { ...document, sha256: "0".repeat(64) },
      artifactStore,
    }),
    /expected source document SHA-256 before archival/i,
  );
});

test("normalizeStLouisSheriffTaxSaleRow produces an unresolved auction lot with the amount owed", async () => {
  const row: StLouisSheriffTaxSaleRow = {
    saleNumber: "123",
    saleDate: "2026-08-25",
    publishedDate: "2026-07-01",
    landTaxNumber: "123-1",
    owner: "SMITH JOHN",
    address: "100 MAIN ST",
    totalDue: 1_234.56,
    pageNumber: 1,
    pageRowNumber: 1,
    documentRowNumber: 1,
    document,
  };
  const bundle = await normalizeStLouisSheriffTaxSaleRow(row);
  assert.equal(bundle.resolution.status, "unresolved");
  assert.equal(bundle.auction.amounts[0]?.amount, 1_234.56);
  assert.equal(
    bundle.auction.parties.some(
      (party) => party.role === "assessed_owner" && party.publishedName === "SMITH JOHN",
    ),
    true,
  );
  assert.equal(
    bundle.propertyCandidate.identifiers[0]?.identifierType,
    "tax_sale_parcel_reference",
  );
});
