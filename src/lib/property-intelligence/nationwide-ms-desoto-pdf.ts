// Slice 3 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1). Ported from property-intelligence-app's
// app/lib/nationwide-ms-desoto-pdf.ts: the positioned-column parser for the
// DeSoto County, Mississippi land-sale (tax-sale) PDF report, plus its
// published-total reconciliation, plus the artifact-archive shell wired to
// Slice 2's nationwide-artifact-store.ts instead of the source's R2 store.
//
// `parseMississippiDesotoPdfPage` takes an already-extracted
// `PositionedPdfTextPage` (see nationwide-pdf-text-layout.ts) -- never PDF
// bytes -- so it needs no PDF-parsing library. Only
// `parseMississippiDesotoTaxSalePdf` (the top-level pdfBytes -> parsed
// report entry point) needs real page extraction, and it takes that as an
// injected `extractPages` parameter with NO default, mirroring the health
// delivery sink's injected-with-no-default pattern from Slice 2: this module
// is structurally incapable of extracting real PDF bytes on its own.
import {
  archiveNationwideSourceBytes,
  sha256ArtifactBytes,
  type ArchivedSourceArtifact,
  type ImmutableArtifactStore,
} from "./nationwide-artifact-store.ts";
import {
  hasPdfSignature,
  positionedLinesFor,
  positionedLineText,
  wordsInXRange,
  type ExtractPositionedPdfTextPages,
  type PositionedLine,
  type PositionedPdfTextPage,
  type PositionedPdfTextWord,
} from "./nationwide-pdf-text-layout.ts";
import type { SourceDocumentReference } from "./nationwide-property-intake-types.ts";

// Provenance for the 2025 DeSoto County tax-sale report this parser was built
// against: the exact artifact whose bytes the layout assertions below describe.
// Ported from property-intelligence-app. A future report that does not match
// these figures is a different document and must be re-reviewed, not silently
// parsed with this layout.
export const DESOTO_2025_REPORT_EVIDENCE = {
  sha256: "9c1e121074817660c56b3830f844589c50ada8a45527403889f26ed3c89efa4b",
  pageCount: 192,
  recordCount: 2_098,
} as const;

export const DESOTO_REPORT_LAYOUT_V1 = {
  pageWidth: 950,
  pageHeight: 792,
  stateCode: "MS",
  countyName: "DeSoto",
  countyFips: "28033",
} as const;

export type MississippiCountyTaxSaleRow = {
  jurisdiction: { stateCode: string; countyName: string; countyFips: string };
  document: SourceDocumentReference;
  pageNumber: number;
  rowNumber: number;
  saleDate: string;
  reportDate: string;
  publishedParcelParts: string[];
  assessedOwnerName: string;
  ownerMailingAddressLines: string[];
  descriptionLines: string[];
  receiptNumber: string;
  taxYear: number;
  taxesDue: number;
  interest: number;
  penalty: number | null;
  printerFee: number | null;
  recordingFee: number | null;
  totalDue: number;
  bidExcess: number | null;
  disposition: "Sold To Individual" | "Sold To the State";
  purchaserName: string;
  homesteadChargeback: boolean;
  raw: Record<string, unknown>;
};

export type PublishedReportTotals = {
  kind: "individual" | "state" | "grand";
  count: number;
  taxesDue: number;
  interest: number;
  printerFee: number;
  totalDue: number;
  bidExcess: number;
};

export type ParsedMississippiDesotoReport = {
  rows: MississippiCountyTaxSaleRow[];
  reportDate: string;
  saleDate: string;
  publishedTotals: PublishedReportTotals[];
};

const COLUMN = {
  parcelEnd: 110,
  ownerStart: 110,
  ownerEnd: 259,
  descriptionStart: 259,
  descriptionFirstLineEnd: 374,
  taxYearStart: 374,
  taxYearEnd: 408,
  receiptStart: 408,
  receiptEnd: 475,
  purchaserStart: 681,
} as const;

function isoCalendarDate(value: string, field: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`${field} must use M/D/YYYY in the DeSoto report`);
  const [, month, day, year] = match as unknown as [string, string, string, string];
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return result;
}

function pageHeader(page: PositionedPdfTextPage, lines: PositionedLine[]) {
  const heading = lines.find((line) =>
    positionedLineText(line.words).startsWith("State ID Order DESOTO COUNTY Date:"),
  );
  if (!heading) throw new Error(`DeSoto PDF page ${page.pageNumber} is missing its report heading`);
  const headingMatch =
    /^State ID Order DESOTO COUNTY Date:\s*(\d{1,2}\/\d{1,2}\/\d{4}) Page:\s*(\d+)$/.exec(
      positionedLineText(heading.words),
    );
  if (!headingMatch || Number(headingMatch[2]) !== page.pageNumber) {
    throw new Error(`DeSoto PDF page ${page.pageNumber} has an invalid printed page identity`);
  }
  const coverage = lines.find((line) =>
    positionedLineText(line.words).startsWith("Real Property For Land Sale Dates:"),
  );
  const coverageMatch = coverage
    ? /^Real Property For Land Sale Dates:\s*(\d{1,2}\/\d{1,2}\/\d{4}) to (\d{1,2}\/\d{1,2}\/\d{4})$/.exec(
        positionedLineText(coverage.words),
      )
    : null;
  if (!coverageMatch || coverageMatch[1] !== coverageMatch[2]) {
    throw new Error(`DeSoto PDF page ${page.pageNumber} has an unsupported sale-date range`);
  }
  return {
    reportDate: isoCalendarDate(headingMatch[1] as string, "report date"),
    saleDate: isoCalendarDate(coverageMatch[1] as string, "sale date"),
  };
}

function groupAfterColumnHeader(page: PositionedPdfTextPage, lines: PositionedLine[]) {
  const columnHeaderIndex = lines.findIndex((line) =>
    positionedLineText(line.words).startsWith(
      "State Identification LandOwner Name Description Receipt",
    ),
  );
  if (columnHeaderIndex < 0)
    throw new Error(`DeSoto PDF page ${page.pageNumber} is missing its column heading`);
  const groups: PositionedLine[][] = [];
  let current: PositionedLine[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const line of lines.slice(columnHeaderIndex + 1)) {
    if (positionedLineText(line.words).startsWith("=")) {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return groups;
}

function money(value: string, field: string, required = true) {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  const result = Number(normalized);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${field} must be nonnegative money`);
  return result;
}

function numericColumn(words: PositionedPdfTextWord[], minimumX1: number, maximumX1: number) {
  return positionedLineText(
    words.filter((word) => {
      const numeric = /^[$]?[\d,.]+$/.test(word.text.trim());
      return numeric && word.x1 > minimumX1 && word.x1 <= maximumX1;
    }),
  );
}

function parsedRecord(input: {
  page: PositionedPdfTextPage;
  group: PositionedLine[];
  rowNumber: number;
  document: SourceDocumentReference;
  reportDate: string;
  saleDate: string;
}): MississippiCountyTaxSaleRow {
  if (input.group.length < 3 || input.group.length > 6) {
    throw new Error(
      `DeSoto PDF page ${input.page.pageNumber} row ${input.rowNumber} has an unsupported line count`,
    );
  }
  const first = (input.group[0] as PositionedLine).words;
  const parcelParts = wordsInXRange(first, 0, COLUMN.parcelEnd)
    .map((word) => word.text.trim())
    .filter(Boolean);
  if (!/^\d{9}\s+\d{7}$/.test(parcelParts.join(" "))) {
    throw new Error(
      `DeSoto PDF page ${input.page.pageNumber} row ${input.rowNumber} has an invalid state-identification layout`,
    );
  }
  const dispositionText = positionedLineText(
    wordsInXRange((input.group[1] as PositionedLine).words, 0, COLUMN.ownerStart),
  );
  if (dispositionText !== "Sold To Individual" && dispositionText !== "Sold To the State") {
    throw new Error(
      `DeSoto PDF page ${input.page.pageNumber} row ${input.rowNumber} has an unsupported disposition`,
    );
  }
  const purchaserText = positionedLineText(
    input.group
      .slice(1)
      .flatMap((line) => line.words.filter((word) => word.x0 >= COLUMN.purchaserStart - 0.75)),
  );
  const purchaserName = purchaserText.replace(/^To Whom Sold\s*-\s*/i, "").trim();
  if (!purchaserName || purchaserName === purchaserText) {
    throw new Error(
      `DeSoto PDF page ${input.page.pageNumber} row ${input.rowNumber} is missing its purchaser marker`,
    );
  }
  const taxYearText = positionedLineText(
    wordsInXRange(first, COLUMN.taxYearStart, COLUMN.taxYearEnd),
  );
  const taxYear = Number(taxYearText);
  if (!/^\d{4}$/.test(taxYearText) || !Number.isInteger(taxYear)) {
    throw new Error(
      `DeSoto PDF page ${input.page.pageNumber} row ${input.rowNumber} has an invalid tax year`,
    );
  }
  const ownerMailingAddressLines = input.group
    .slice(1)
    .map((line) =>
      positionedLineText(wordsInXRange(line.words, COLUMN.ownerStart, COLUMN.ownerEnd)),
    )
    .filter(Boolean);
  const descriptionLines = input.group
    .map((line, index) =>
      positionedLineText(
        wordsInXRange(
          line.words,
          COLUMN.descriptionStart,
          index === 0 ? COLUMN.descriptionFirstLineEnd : COLUMN.purchaserStart,
        ),
      ),
    )
    .filter(Boolean);
  return {
    jurisdiction: {
      stateCode: DESOTO_REPORT_LAYOUT_V1.stateCode,
      countyName: DESOTO_REPORT_LAYOUT_V1.countyName,
      countyFips: DESOTO_REPORT_LAYOUT_V1.countyFips,
    },
    document: input.document,
    pageNumber: input.page.pageNumber,
    rowNumber: input.rowNumber,
    saleDate: input.saleDate,
    reportDate: input.reportDate,
    publishedParcelParts: parcelParts,
    assessedOwnerName: positionedLineText(wordsInXRange(first, COLUMN.ownerStart, COLUMN.ownerEnd)),
    ownerMailingAddressLines,
    descriptionLines,
    receiptNumber: positionedLineText(wordsInXRange(first, COLUMN.receiptStart, COLUMN.receiptEnd)),
    taxYear,
    taxesDue: money(numericColumn(first, 456, 518.5), "taxes due") as number,
    interest: money(numericColumn(first, 518.5, 561), "interest") as number,
    penalty: money(numericColumn(first, 561, 609), "penalty", false),
    printerFee: money(numericColumn(first, 609, 657), "printer fee", false),
    recordingFee: money(numericColumn(first, 657, 710), "recording fee", false),
    totalDue: money(numericColumn(first, 710, 758), "total due") as number,
    bidExcess: money(numericColumn(first, 758, 820), "bid excess", false),
    disposition: dispositionText,
    purchaserName,
    homesteadChargeback: input.group.some((line) =>
      /HOMESTEAD CHARGEBACK/i.test(positionedLineText(line.words)),
    ),
    raw: { textLines: input.group.map((line) => positionedLineText(line.words)) },
  };
}

function parsedTotals(group: PositionedLine[]): PublishedReportTotals | null {
  const allWords = group.flatMap((line) => line.words);
  const allText = group.map((line) => positionedLineText(line.words)).join(" ");
  const match = /(Individual|State|Grand) Totals:\s*(\d+)/.exec(allText);
  if (!match) return null;
  const kind = (match[1] as string).toLowerCase() as PublishedReportTotals["kind"];
  return {
    kind,
    count: Number(match[2]),
    taxesDue: money(numericColumn(allWords, 456, 518.5), `${kind} taxes`) as number,
    interest: money(numericColumn(allWords, 518.5, 561), `${kind} interest`) as number,
    printerFee: money(numericColumn(allWords, 609, 657), `${kind} printer fee`) as number,
    totalDue: money(numericColumn(allWords, 710, 758), `${kind} total due`) as number,
    bidExcess: money(numericColumn(allWords, 758, 820), `${kind} bid excess`, false) ?? 0,
  };
}

export function parseMississippiDesotoPdfPage(input: {
  page: PositionedPdfTextPage;
  document: SourceDocumentReference;
}) {
  if (
    Math.abs(input.page.width - DESOTO_REPORT_LAYOUT_V1.pageWidth) > 0.5 ||
    Math.abs(input.page.height - DESOTO_REPORT_LAYOUT_V1.pageHeight) > 0.5
  ) {
    throw new Error(`DeSoto PDF page ${input.page.pageNumber} has an unsupported page size`);
  }
  const lines = positionedLinesFor(input.page);
  const header = pageHeader(input.page, lines);
  const groups = groupAfterColumnHeader(input.page, lines);
  const rows: MississippiCountyTaxSaleRow[] = [];
  const totals: PublishedReportTotals[] = [];
  for (const group of groups) {
    const firstLine = positionedLineText(group[0]?.words ?? []);
    if (/^\d{9}\s+\d{7}\b/.test(firstLine)) {
      rows.push(
        parsedRecord({
          page: input.page,
          group,
          rowNumber: rows.length + 1,
          document: input.document,
          ...header,
        }),
      );
      continue;
    }
    const summary = parsedTotals(group);
    if (!summary)
      throw new Error(
        `DeSoto PDF page ${input.page.pageNumber} contains an unclassified report segment`,
      );
    totals.push(summary);
  }
  return { ...header, rows, totals };
}

function centsOf(value: number) {
  return Math.round(value * 100);
}

function sumCents(
  rows: MississippiCountyTaxSaleRow[],
  select: (row: MississippiCountyTaxSaleRow) => number | null | undefined,
) {
  return rows.reduce((total, row) => total + centsOf(select(row) ?? 0), 0);
}

function requireReconciledTotal(actualCents: number, published: number, field: string) {
  if (actualCents !== centsOf(published)) {
    throw new Error(`DeSoto report ${field} does not reconcile to the published grand total`);
  }
}

export function reconcileMississippiDesotoReport(input: ParsedMississippiDesotoReport) {
  const byKind = new Map(input.publishedTotals.map((total) => [total.kind, total]));
  if (
    byKind.size !== 3 ||
    !byKind.has("individual") ||
    !byKind.has("state") ||
    !byKind.has("grand")
  ) {
    throw new Error("DeSoto report must contain exactly one individual, state, and grand summary");
  }
  const individual = byKind.get("individual") as PublishedReportTotals;
  const state = byKind.get("state") as PublishedReportTotals;
  const grand = byKind.get("grand") as PublishedReportTotals;
  const individualCount = input.rows.filter(
    (row) => row.disposition === "Sold To Individual",
  ).length;
  const stateCount = input.rows.filter((row) => row.disposition === "Sold To the State").length;
  if (
    individual.count !== individualCount ||
    state.count !== stateCount ||
    grand.count !== input.rows.length
  ) {
    throw new Error("DeSoto report disposition counts do not reconcile to the published summaries");
  }
  requireReconciledTotal(
    sumCents(input.rows, (row) => row.taxesDue),
    grand.taxesDue,
    "taxes due",
  );
  requireReconciledTotal(
    sumCents(input.rows, (row) => row.interest),
    grand.interest,
    "interest",
  );
  requireReconciledTotal(
    sumCents(input.rows, (row) => row.printerFee),
    grand.printerFee,
    "printer fee",
  );
  requireReconciledTotal(
    sumCents(input.rows, (row) => row.totalDue),
    grand.totalDue,
    "total due",
  );
  requireReconciledTotal(
    sumCents(input.rows, (row) => row.bidExcess),
    grand.bidExcess,
    "bid excess",
  );
  return input;
}

export async function parseMississippiDesotoTaxSalePdf(input: {
  pdfBytes: Uint8Array;
  document: SourceDocumentReference;
  extractPages: ExtractPositionedPdfTextPages;
}): Promise<ParsedMississippiDesotoReport> {
  if (!hasPdfSignature(input.pdfBytes))
    throw new Error("DeSoto tax-sale source bytes must have a PDF signature");
  const actualHash = await sha256ArtifactBytes(input.pdfBytes);
  if (actualHash !== input.document.sha256.toLowerCase()) {
    throw new Error("DeSoto PDF bytes must match the immutable source document SHA-256");
  }
  const pages = await input.extractPages(input.pdfBytes);
  if (pages.length < 1 || pages.length > 10_000) {
    throw new Error("DeSoto PDF page count is outside the supported report boundary");
  }
  const parsedPages = pages.map((page) =>
    parseMississippiDesotoPdfPage({ page, document: input.document }),
  );
  const reportDate = parsedPages[0]?.reportDate;
  const saleDate = parsedPages[0]?.saleDate;
  if (
    !reportDate ||
    !saleDate ||
    parsedPages.some((page) => page.reportDate !== reportDate || page.saleDate !== saleDate)
  ) {
    throw new Error("DeSoto PDF pages do not share one report date and sale date");
  }
  return reconcileMississippiDesotoReport({
    rows: parsedPages.flatMap((page) => page.rows),
    reportDate,
    saleDate,
    publishedTotals: parsedPages.flatMap((page) => page.totals),
  });
}

function safeArtifactPrefix(value: string) {
  const prefix = value.trim().replace(/^\/+|\/+$/g, "");
  if (
    !prefix ||
    prefix !== value.trim() ||
    prefix.includes("\\") ||
    prefix.includes("..") ||
    prefix.includes("://") ||
    prefix.includes("?") ||
    prefix.includes("#")
  ) {
    throw new Error("DeSoto PDF artifact prefix must be a safe relative object-storage prefix");
  }
  return prefix;
}

// Ported from the source's `archiveMississippiDesotoTaxSalePdf`
// (app/lib/nationwide-ms-county-tax-sale.ts): the PDF bytes are hash-verified
// against the caller's expected SHA-256, then content-addressed and archived
// through Slice 2's injected `ImmutableArtifactStore` BEFORE anything is
// parsed. This is the boundary mississippi-desoto-artifact.test.mjs's "DeSoto
// PDF bytes hash-verified, content-addressed before parsing" exercises.
export async function archiveMississippiDesotoTaxSalePdf(input: {
  pdfBytes: Uint8Array;
  artifactStore: ImmutableArtifactStore;
  objectStoragePrefix?: string;
  document: Omit<SourceDocumentReference, "objectStorageKey" | "mimeType" | "byteSize">;
}): Promise<{
  document: SourceDocumentReference;
  sourceArtifact: ArchivedSourceArtifact;
  pdfBytes: Uint8Array;
}> {
  if (!hasPdfSignature(input.pdfBytes))
    throw new Error("DeSoto tax-sale source bytes must have a PDF signature");
  const archiveBytes = Uint8Array.from(input.pdfBytes);
  const parseBytes = Uint8Array.from(input.pdfBytes);
  const sha256 = await sha256ArtifactBytes(archiveBytes);
  if (sha256 !== input.document.sha256.toLowerCase()) {
    throw new Error(
      "DeSoto PDF bytes must match the expected source document SHA-256 before archival",
    );
  }
  const objectStoragePrefix = safeArtifactPrefix(
    input.objectStoragePrefix ?? "nationwide/mississippi/desoto-county-tax-sale",
  );
  const objectStorageKey = `${objectStoragePrefix}/${sha256}.pdf`;
  const sourceArtifact = await archiveNationwideSourceBytes(input.artifactStore, {
    objectStorageKey,
    bytes: archiveBytes,
    mimeType: "application/pdf",
  });
  const document: SourceDocumentReference = {
    url: input.document.url,
    title: input.document.title,
    sha256,
    retrievedAt: input.document.retrievedAt,
    publishedAt: input.document.publishedAt ?? null,
    objectStorageKey,
    mimeType: sourceArtifact.mimeType,
    byteSize: sourceArtifact.byteSize,
  };
  return { document, sourceArtifact, pdfBytes: parseBytes };
}
