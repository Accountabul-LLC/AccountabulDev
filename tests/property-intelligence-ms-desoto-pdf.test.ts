// Slice 3 of the nationwide multi-state ingestion port. Ported behavioral
// contract from the source's tests/mississippi-desoto-pdf.test.mjs
// ("the positioned DeSoto parser preserves report columns, null money,
// dispositions, and locators") and tests/mississippi-desoto-artifact.test.mjs
// ("DeSoto PDF bytes hash-verified, content-addressed before parsing").
import assert from "node:assert/strict";
import test from "node:test";

import { sha256ArtifactBytes } from "../src/lib/property-intelligence/nationwide-artifact-store.ts";
import {
  archiveMississippiDesotoTaxSalePdf,
  parseMississippiDesotoPdfPage,
  parseMississippiDesotoTaxSalePdf,
  reconcileMississippiDesotoReport,
} from "../src/lib/property-intelligence/nationwide-ms-desoto-pdf.ts";
import type { PositionedPdfTextPage } from "../src/lib/property-intelligence/nationwide-pdf-text-layout.ts";

const desoto2025Document = {
  url: "https://www.desotocountyms.gov/DocumentCenter/View/10467/2025-TAX-SALE-ALL",
  title: "DeSoto County 2025 Land Sale Listing",
  sha256: "9c1e121074817660c56b3830f844589c50ada8a45527403889f26ed3c89efa4b",
  retrievedAt: "2026-08-19T18:00:00.000Z",
  publishedAt: "2025-09-18T15:41:29-05:00",
};

function word(text: string, x0: number, x1: number, y: number) {
  return { text, x0, x1, y };
}

function line(y: number, values: Array<[string, number, number]>) {
  return values.map(([text, x0, x1]) => word(text, x0, x1, y));
}

function representativePage(): PositionedPdfTextPage {
  return {
    pageNumber: 1,
    width: 950,
    height: 792,
    words: [
      ...line(771.3, [["State ID Order DESOTO COUNTY Date: 9/18/2025 Page: 1", 0, 950]]),
      ...line(747.3, [["Real Property For Land Sale Dates: 8/25/2025 to 8/25/2025", 0, 590]]),
      ...line(711.3, [
        [
          "State Identification LandOwner Name Description Receipt Due Interest Penalty Fees Fees Due Excess",
          0,
          810,
        ],
      ]),
      ...line(699.3, [
        ["105417000", 0, 43.2],
        ["0000200", 72, 105.6],
        ["STAFFORD RONA FAY", 110.4, 192],
        ["SEC-17 TWN-01 RNG-05", 259.2, 364.8],
        ["2024", 374.4, 393.6],
        ["2 00", 436.8, 456],
        ["792.27", 480, 508.8],
        ["27.73", 528, 552],
        ["3.00", 624, 643.2],
        ["823.00", 720, 748.8],
        ["68.00", 782.4, 806.4],
      ]),
      ...line(687.3, [
        ["Sold To Individual", 4.8, 91.2],
        ["5875 HWY 222", 110.4, 168],
        ["17-1-5", 259.2, 288],
        ["To Whom Sold -", 681.6, 748.8],
        ["BROCKET LLC", 753.6, 806.4],
      ]),
      ...line(675.3, [
        ["MASON TN, 38049-0000", 110.4, 206.4],
        ["PT SE1/4", 259.2, 297.6],
      ]),
      ...line(663.3, [["=".repeat(198), 0, 950]]),
      ...line(651.3, [
        ["105932030", 0, 43.2],
        ["0000600", 72, 105.6],
        ["BRAYBOURNE HOMEOWNERS ASSOC", 110.4, 235.2],
        ["SEC-32 TWN-01 RNG-05", 259.2, 364.8],
        ["2024", 374.4, 393.6],
        ["1306 00", 417.6, 456],
        ["2.05", 489.6, 508.8],
        [".07", 537.6, 552],
        ["3.00", 624, 643.2],
        ["5.12", 729.6, 748.8],
      ]),
      ...line(639.3, [
        ["Sold To the State", 4.8, 91.2],
        ["3400 PLAYERS CLUB PKWY STE 100", 110.4, 244.8],
        ["BRAYBOURNE S-D", 259.2, 331.2],
        ["To Whom Sold -", 681.6, 748.8],
        ["STATE OF MISSISSIPPI", 753.6, 849.6],
      ]),
      ...line(627.3, [
        ["MEMPHIS TN, 38125-0000", 110.4, 216],
        ["BRAYBOURNE SEC A (COMMON AREA)", 259.2, 403.2],
      ]),
      ...line(615.3, [["LOT 6", 259.2, 283.2]]),
      ...line(603.3, [["=".repeat(198), 0, 950]]),
    ],
  };
}

test("the positioned DeSoto parser preserves report columns, null money, dispositions, and locators", () => {
  const parsed = parseMississippiDesotoPdfPage({
    page: representativePage(),
    document: desoto2025Document,
  });
  assert.equal(parsed.reportDate, "2025-09-18");
  assert.equal(parsed.saleDate, "2025-08-25");
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0]?.publishedParcelParts, ["105417000", "0000200"]);
  assert.equal(parsed.rows[0]?.assessedOwnerName, "STAFFORD RONA FAY");
  assert.deepEqual(parsed.rows[0]?.ownerMailingAddressLines, [
    "5875 HWY 222",
    "MASON TN, 38049-0000",
  ]);
  assert.deepEqual(parsed.rows[0]?.descriptionLines, [
    "SEC-17 TWN-01 RNG-05",
    "17-1-5",
    "PT SE1/4",
  ]);
  assert.equal(parsed.rows[0]?.receiptNumber, "2 00");
  assert.equal(parsed.rows[0]?.totalDue, 823);
  assert.equal(parsed.rows[0]?.bidExcess, 68);
  assert.equal(parsed.rows[0]?.purchaserName, "BROCKET LLC");
  assert.equal(parsed.rows[1]?.disposition, "Sold To the State");
  assert.equal(parsed.rows[1]?.bidExcess, null);
  assert.equal(parsed.rows[1]?.penalty, null);
  assert.equal(parsed.rows[1]?.recordingFee, null);
  assert.equal(parsed.rows[1]?.pageNumber, 1);
  assert.equal(parsed.rows[1]?.rowNumber, 2);
});

test("the positioned parser fails closed on an unclassified report segment", () => {
  const page = representativePage();
  page.words.push(...line(591.3, [["Unexpected footer content", 0, 200]]));
  assert.throws(
    () => parseMississippiDesotoPdfPage({ page, document: desoto2025Document }),
    /unclassified report segment/i,
  );
});

test("reconciliation requires exactly one individual, state, and grand summary that ties out to the cent", () => {
  const parsed = parseMississippiDesotoPdfPage({
    page: representativePage(),
    document: desoto2025Document,
  });
  assert.throws(
    () =>
      reconcileMississippiDesotoReport({
        rows: parsed.rows,
        reportDate: parsed.reportDate,
        saleDate: parsed.saleDate,
        publishedTotals: [],
      }),
    /individual, state, and grand summary/i,
  );
});

test("parseMississippiDesotoTaxSalePdf hash-verifies the PDF signature before invoking the injected extractor", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  let extractorCalls = 0;
  await assert.rejects(
    parseMississippiDesotoTaxSalePdf({
      pdfBytes,
      document: { ...desoto2025Document, sha256 },
      extractPages: async () => {
        extractorCalls += 1;
        return [representativePage()];
      },
    }),
    /must contain exactly one individual, state, and grand summary/i,
  );
  assert.equal(
    extractorCalls,
    1,
    "the injected extractor is only reached once the PDF signature and hash are verified",
  );

  await assert.rejects(
    parseMississippiDesotoTaxSalePdf({
      pdfBytes: new TextEncoder().encode("not a pdf"),
      document: { ...desoto2025Document, sha256 },
      extractPages: async () => {
        throw new Error("must not be called when the PDF signature is missing");
      },
    }),
    /PDF signature/i,
  );
});

test("DeSoto PDF bytes are hash-verified and content-addressed before parsing", async () => {
  const pdfBytes = new TextEncoder().encode(
    "%PDF-1.7\nAccountabul DeSoto archive boundary fixture\n%%EOF",
  );
  const sha256 = await sha256ArtifactBytes(pdfBytes);
  const document = { ...desoto2025Document, sha256 };
  const writes: unknown[] = [];
  const artifactStore = {
    async putCanonicalJson() {},
    async putBytes(input: { bytes: Uint8Array }) {
      writes.push({ ...input, bytes: Uint8Array.from(input.bytes) });
    },
  };

  const archived = await archiveMississippiDesotoTaxSalePdf({ pdfBytes, document, artifactStore });
  assert.equal(writes.length, 1);
  assert.equal(
    archived.sourceArtifact.objectStorageKey,
    `nationwide/mississippi/desoto-county-tax-sale/${sha256}.pdf`,
  );
  assert.deepEqual(archived.sourceArtifact, {
    sha256,
    objectStorageKey: archived.sourceArtifact.objectStorageKey,
    mimeType: "application/pdf",
    byteSize: pdfBytes.byteLength,
  });
  assert.deepEqual(archived.pdfBytes, pdfBytes);
  assert.notEqual(archived.pdfBytes.buffer, pdfBytes.buffer);
  assert.equal(archived.document.objectStorageKey, archived.sourceArtifact.objectStorageKey);
});

test("a signature or expected-hash mismatch fails before immutable storage", async () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  let writeCount = 0;
  const artifactStore = {
    async putCanonicalJson() {},
    async putBytes() {
      writeCount += 1;
    },
  };
  await assert.rejects(
    archiveMississippiDesotoTaxSalePdf({
      pdfBytes,
      document: { ...desoto2025Document, sha256: "0".repeat(64) },
      artifactStore,
    }),
    /expected source document SHA-256 before archival/i,
  );
  await assert.rejects(
    archiveMississippiDesotoTaxSalePdf({
      pdfBytes: new TextEncoder().encode("not a PDF"),
      document: {
        ...desoto2025Document,
        sha256: await sha256ArtifactBytes(new TextEncoder().encode("not a PDF")),
      },
      artifactStore,
    }),
    /PDF signature/i,
  );
  assert.equal(writeCount, 0);
});
