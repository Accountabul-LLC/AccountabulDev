// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-ms-rankin-pdf.ts: the
// positioned three-column newspaper-layout parser for Rankin County,
// Mississippi's delinquent tax land-sale PDF, its published-summary
// reconciliation, and its normalization into the canonical auction-lot
// bundle shape.
import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  hasPdfSignature,
  sha256PdfBytes,
  type ExtractPositionedPdfTextPages,
  type PositionedPdfTextPage,
  type PositionedPdfTextWord,
} from "./nationwide-pdf-text-layout.ts";
import {
  archiveNationwideSourceBytes,
  type ArchivedSourceArtifact,
  type ImmutableArtifactStore,
} from "./nationwide-artifact-store.ts";
import {
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  type NormalizedIntakeBundle,
  type SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";
import { SHA256_HEX } from "../validation/patterns.ts";

// Provenance for the 2025 Rankin County tax-sale report this parser was built
// against, ported from property-intelligence-app. recordsProcessed exceeds
// recordCount because the report repeats parcels across continuation rows, and
// parcelsNotPublished records how many rows carried no parcel identifier at
// all -- kept as evidence rather than dropped.
export const RANKIN_2025_REPORT_EVIDENCE = {
  sha256: "51fbd21058d26c045d20147bf63069058f2227bfd9b700d0f1cba641e1890a80",
  byteSize: 795_708,
  pageCount: 214,
  taxYear: 2025,
  recordCount: 4_971,
  recordsProcessed: 5_103,
  parcelsNotPublished: 132,
  publishedTotalAmount: 6_203_170.61,
} as const;

export const RANKIN_REPORT_LAYOUT_V1 = {
  pageWidth: 612,
  pageHeight: 792,
  stateCode: "MS",
  countyName: "Rankin",
  countyFips: "28121",
  columns: [
    { start: 30, end: 205 },
    { start: 205, end: 390 },
    { start: 390, end: 582 },
  ],
} as const;

type PositionedLine = {
  y: number;
  words: PositionedPdfTextWord[];
};

export type MississippiRankinInstrumentHistory = {
  rawText: string;
  year: number | null;
  bookOrInstrument: string | null;
  recordedDate: string | null;
};

export type MississippiRankinTaxSaleRow = {
  jurisdiction: { stateCode: "MS"; countyName: "Rankin"; countyFips: "28121" };
  document: SourceDocumentReference;
  pageNumber: number;
  columnNumber: number;
  pageRowNumber: number;
  taxYear: number;
  saleDate: string;
  assessedOwnerName: string;
  receiptNumber: string | null;
  ppin: string;
  section: string | null;
  township: string | null;
  range: string | null;
  taxDistrict: string | null;
  saleSequence: string;
  descriptionLines: string[];
  instrumentHistory: MississippiRankinInstrumentHistory[];
  deedBook: string | null;
  deedPage: string | null;
  parcelNumber: string;
  acres: number | null;
  totalTaxAndCost: number;
  raw: { textLines: string[] };
};

export type MississippiRankinReportSummary = {
  totalAmountDue: number;
  toBeSoldCount: number;
  parcelsNotPublished: number;
  totalRecordsProcessed: number;
  publishedTotalAmount: number;
  publishedParcelCount: number;
  reportCode: string;
};

export type ParsedMississippiRankinReport = {
  rows: MississippiRankinTaxSaleRow[];
  sourceFileDate: string;
  saleFileUpdatedDate: string;
  saleDate: string;
  taxYear: number;
  continuedSegmentCount: number;
  reportSummary: MississippiRankinReportSummary;
};

function lineText(words: PositionedPdfTextWord[]) {
  return [...words]
    .sort((left, right) => left.x0 - right.x0)
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function linesFor(page: PositionedPdfTextPage) {
  const lines = new Map<number, PositionedPdfTextWord[]>();
  for (const word of page.words) {
    if (!word.text.trim()) continue;
    if (![word.x0, word.x1, word.y].every(Number.isFinite) || word.x1 < word.x0) {
      throw new Error(`Rankin PDF page ${page.pageNumber} contains invalid text coordinates`);
    }
    const key = Math.round(word.y * 10) / 10;
    const line = lines.get(key) ?? [];
    line.push(word);
    lines.set(key, line);
  }
  return [...lines.entries()]
    .map(([y, words]) => ({ y, words: words.sort((left, right) => left.x0 - right.x0) }))
    .sort((left, right) => right.y - left.y);
}

function wordsInColumn(line: PositionedLine, columnNumber: number) {
  const column = RANKIN_REPORT_LAYOUT_V1.columns[columnNumber - 1];
  if (!column) throw new Error(`Rankin column ${columnNumber} is not defined`);
  return line.words.filter((word) => word.x0 >= column.start - 0.75 && word.x0 < column.end - 0.75);
}

function columnLines(lines: PositionedLine[], columnNumber: number) {
  return lines.flatMap((line) => {
    const words = wordsInColumn(line, columnNumber);
    return words.length > 0 ? [{ y: line.y, words }] : [];
  });
}

function isoSlashDate(value: string, field: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error(`${field} must use M/D/YYYY in the Rankin report`);
  const result = `${match[3]}-${(match[1] as string).padStart(2, "0")}-${(match[2] as string).padStart(2, "0")}`;
  if (new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return result;
}

const monthNumbers = new Map([
  ["January", "01"],
  ["February", "02"],
  ["March", "03"],
  ["April", "04"],
  ["May", "05"],
  ["June", "06"],
  ["July", "07"],
  ["August", "08"],
  ["September", "09"],
  ["October", "10"],
  ["November", "11"],
  ["December", "12"],
]);

function isoLongDate(value: string, field: string) {
  const match =
    /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/.exec(
      value.trim(),
    );
  if (!match) throw new Error(`${field} is not recognized in the Rankin report`);
  const month = monthNumbers.get(match[1] as string);
  const result = `${match[3]}-${month}-${(match[2] as string).padStart(2, "0")}`;
  if (new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return result;
}

function nonnegativeNumber(value: string, field: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  const result = Number(normalized);
  if (!normalized || !Number.isFinite(result) || result < 0) {
    throw new Error(`${field} must be a published nonnegative number`);
  }
  return result;
}

function integer(value: string, field: string) {
  const result = nonnegativeNumber(value, field);
  if (!Number.isSafeInteger(result)) throw new Error(`${field} must be a published whole number`);
  return result;
}

function pageFooter(page: PositionedPdfTextPage, lines: PositionedLine[]) {
  const footer = lines.find((line) =>
    lineText(line.words).includes("Rankin County, Mississippi — 2025 Delinquent Tax Land Sale"),
  );
  const match = footer
    ? /\(Tax Year (\d{4})\) Page (\d+) of (\d+)$/.exec(lineText(footer.words))
    : null;
  if (!match || Number(match[2]) !== page.pageNumber) {
    throw new Error(`Rankin PDF page ${page.pageNumber} has an invalid printed page identity`);
  }
  return { taxYear: Number(match[1]), printedPageCount: Number(match[3]) };
}

function pageOneMetadata(lines: PositionedLine[]) {
  const source = lines.find((line) =>
    lineText(line.words).startsWith("Source: LRMSAL13 newspaper print file,"),
  );
  const sourceMatch = source
    ? /^Source: LRMSAL13 newspaper print file, (\d{1,2}\/\d{1,2}\/\d{4})\. Sale file updated (\d{1,2}\/\d{1,2}\/\d{4})/.exec(
        lineText(source.words),
      )
    : null;
  if (!sourceMatch) throw new Error("Rankin PDF page 1 is missing its source-file dates");
  const auction = lines.find((line) => lineText(line.words).includes("Live bid auction"));
  const auctionMatch = auction
    ? /Monday, ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})$/.exec(
        lineText(auction.words),
      )
    : null;
  if (!auctionMatch) throw new Error("Rankin PDF page 1 is missing its published sale date");
  return {
    sourceFileDate: isoSlashDate(sourceMatch[1] as string, "source file date"),
    saleFileUpdatedDate: isoSlashDate(sourceMatch[2] as string, "sale file updated date"),
    saleDate: isoLongDate(auctionMatch[1] as string, "sale date"),
  };
}

function splitRecordSegments(lines: PositionedLine[], context: string) {
  const segments: PositionedLine[][] = [];
  let continuedSegmentCount = 0;
  let current: PositionedLine[] = [];
  for (const line of lines.filter((value) => value.y > 30 && value.y < 740)) {
    current.push(line);
    const text = lineText(line.words);
    if (text === "*CONTINUED") {
      if (
        !current.some((candidate) => lineText(candidate.words).includes("Receipt No.")) ||
        !current.some((candidate) => lineText(candidate.words).startsWith("Sale Sequence")) ||
        !current.some((candidate) => lineText(candidate.words).startsWith("Parcel#"))
      ) {
        throw new Error(`${context} has an invalid continued-record marker`);
      }
      continuedSegmentCount += 1;
      current = [];
    } else if (text.startsWith("**TOTAL TAX & COST")) {
      segments.push(current);
      current = [];
    }
  }
  if (
    current.some((line) =>
      /Receipt No\.|Sale Sequence|Parcel#|TOTAL TAX/i.test(lineText(line.words)),
    )
  ) {
    throw new Error(
      `${context} contains an unterminated parcel segment: ${current.map((line) => lineText(line.words)).join(" | ")}`,
    );
  }
  return { segments, continuedSegmentCount };
}

function extractReceiptAndPpin(line: PositionedLine, context: string) {
  const words = [...line.words].sort((left, right) => left.x0 - right.x0);
  const receiptLabel = words.findIndex((word) => word.text.trim() === "Receipt No.");
  const ppinLabel = words.findIndex((word) => word.text.trim() === "PPIN");
  if (receiptLabel < 0 || ppinLabel <= receiptLabel)
    throw new Error(`${context} has an invalid receipt/PPIN line`);
  const receiptNumber = lineText(words.slice(receiptLabel + 1, ppinLabel)) || null;
  const ppin = lineText(words.slice(ppinLabel + 1));
  if (!ppin || !/^[A-Z0-9 -]+$/i.test(ppin)) throw new Error(`${context} has an invalid PPIN`);
  return { receiptNumber, ppin };
}

function parsedInstrumentHistory(value: string): MississippiRankinInstrumentHistory | null {
  const dated = /^(\d{4})\s+(\d+)\s+(\d{8})$/.exec(value);
  if (dated) {
    const compactDate = dated[3] as string;
    const calendar = isoSlashDate(
      `${compactDate.slice(0, 2)}/${compactDate.slice(2, 4)}/${compactDate.slice(4)}`,
      "instrument history date",
    );
    return {
      rawText: value,
      year: Number(dated[1]),
      bookOrInstrument: dated[2] as string,
      recordedDate: calendar,
    };
  }
  const coded = /^([A-Z]{1,4})\s+(\d+)\s+(\d+)$/.exec(value);
  if (coded)
    return {
      rawText: value,
      year: null,
      bookOrInstrument: `${coded[1]} ${coded[2]} ${coded[3]}`,
      recordedDate: null,
    };
  return null;
}

function parseRecordSegment(input: {
  segment: PositionedLine[];
  page: PositionedPdfTextPage;
  columnNumber: number;
  pageRowNumber: number;
  document: SourceDocumentReference;
  taxYear: number;
  saleDate: string;
}): MississippiRankinTaxSaleRow {
  const context = `Rankin PDF page ${input.page.pageNumber} column ${input.columnNumber} row ${input.pageRowNumber}`;
  const texts = input.segment.map((line) => lineText(line.words));
  const receiptIndex = texts.findIndex(
    (value) => value.includes("Receipt No.") && value.includes("PPIN"),
  );
  if (receiptIndex < 1) throw new Error(`${context} is missing its owner or receipt/PPIN line`);
  let ownerStart = receiptIndex - 1;
  while (
    ownerStart > 0 &&
    (input.segment[ownerStart - 1] as PositionedLine).y -
      (input.segment[ownerStart] as PositionedLine).y <=
      9.1
  )
    ownerStart -= 1;
  const assessedOwnerName = texts.slice(ownerStart, receiptIndex).join(" ").trim();
  if (!assessedOwnerName || assessedOwnerName.length > 500)
    throw new Error(`${context} has an invalid owner name`);
  const { receiptNumber, ppin } = extractReceiptAndPpin(
    input.segment[receiptIndex] as PositionedLine,
    context,
  );

  const sectionIndex = texts.findIndex(
    (value, index) => index > receiptIndex && value.startsWith("Sec-"),
  );
  const sectionMatch =
    sectionIndex >= 0
      ? /^Sec-(\S*) Twnship-(\S*) Rng-(\S*) TD-(\S*)$/.exec(texts[sectionIndex] as string)
      : null;
  if (!sectionMatch)
    throw new Error(
      `${context} has an invalid section/township/range/tax-district line: ${texts.join(" | ")}`,
    );
  const sequenceIndex = texts.findIndex(
    (value, index) => index > sectionIndex && value.startsWith("Sale Sequence"),
  );
  const sequenceMatch =
    sequenceIndex >= 0 ? /^Sale Sequence\s+(\d+)$/.exec(texts[sequenceIndex] as string) : null;
  if (!sequenceMatch) throw new Error(`${context} has an invalid sale sequence`);
  const parcelIndex = texts.findIndex(
    (value, index) => index > sequenceIndex && value.startsWith("Parcel#"),
  );
  const parcelMatch =
    parcelIndex >= 0 ? /^Parcel#\s*-\s*(.+)$/.exec(texts[parcelIndex] as string) : null;
  if (!parcelMatch || !(parcelMatch[1] as string).trim())
    throw new Error(`${context} has an invalid parcel number`);

  const descriptionLines: string[] = [];
  const instrumentHistory: MississippiRankinInstrumentHistory[] = [];
  let deedBook: string | null = null;
  let deedPage: string | null = null;
  for (const value of texts.slice(sequenceIndex + 1, parcelIndex)) {
    const deed = /^Deed Book-\s*(\d+)?\s+Deed Page-\s*(\d+)?$/.exec(value);
    if (deed) {
      if (deedBook !== null || deedPage !== null)
        throw new Error(`${context} repeats its deed reference`);
      deedBook = deed[1] ?? null;
      deedPage = deed[2] ?? null;
      continue;
    }
    const history = parsedInstrumentHistory(value);
    if (history) instrumentHistory.push(history);
    else descriptionLines.push(value);
  }
  if (descriptionLines.length < 1) throw new Error(`${context} has no legal-description lines`);

  let acres: number | null = null;
  for (const value of texts.slice(parcelIndex + 1, -1)) {
    const acresMatch = /^Acres\s+([\d,.]+)$/.exec(value);
    if (!acresMatch || acres !== null)
      throw new Error(`${context} has an unclassified post-parcel line`);
    acres = nonnegativeNumber(acresMatch[1] as string, `${context} acres`);
  }
  const totalMatch = /^\*\*TOTAL TAX & COST\s+([\d,]+\.\d{2})$/.exec(texts.at(-1) ?? "");
  if (!totalMatch) throw new Error(`${context} has an invalid total tax and cost`);

  return {
    jurisdiction: {
      stateCode: RANKIN_REPORT_LAYOUT_V1.stateCode,
      countyName: RANKIN_REPORT_LAYOUT_V1.countyName,
      countyFips: RANKIN_REPORT_LAYOUT_V1.countyFips,
    },
    document: input.document,
    pageNumber: input.page.pageNumber,
    columnNumber: input.columnNumber,
    pageRowNumber: input.pageRowNumber,
    taxYear: input.taxYear,
    saleDate: input.saleDate,
    assessedOwnerName,
    receiptNumber,
    ppin,
    section: sectionMatch[1] || null,
    township: sectionMatch[2] || null,
    range: sectionMatch[3] || null,
    taxDistrict: sectionMatch[4] || null,
    saleSequence: sequenceMatch[1] as string,
    descriptionLines,
    instrumentHistory,
    deedBook,
    deedPage,
    parcelNumber: (parcelMatch[1] as string).trim(),
    acres,
    totalTaxAndCost: nonnegativeNumber(totalMatch[1] as string, `${context} total tax and cost`),
    raw: { textLines: texts.slice(ownerStart) },
  };
}

function parseSummary(lines: PositionedLine[]): MississippiRankinReportSummary {
  const texts = lines.map((line) => lineText(line.words));
  if (!texts.includes("Summary of Amounts Due"))
    throw new Error("Rankin PDF final page is missing its amount summary");
  const value = (pattern: RegExp, field: string) => {
    const match = texts.map((text) => pattern.exec(text)).find((candidate) => candidate !== null);
    if (!match) throw new Error(`Rankin PDF final summary is missing ${field}`);
    return match;
  };
  const amountDue = value(
    /\*TOTAL AMOUNT DUE\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+([\d,.]+)$/,
    "total amount due",
  );
  const sold = value(/^To be Sold Count\.{3,}\s+([\d,]+)/, "to-be-sold count");
  const unpublished = value(/^Parcels Not Published\.{3,}\s+([\d,]+)/, "unpublished parcel count");
  const processed = value(/^Total Records Processed\.\s+([\d,]+)/, "processed record count");
  const published = value(
    /^\*\s+([\d,.]+) Total amount Published for sale\.\s+([\d,]+) Parcels Published$/,
    "published amount and parcel count",
  );
  const reportCode = value(/^Options for this Report\.{3,}\s+(\S+)$/, "report code");
  return {
    totalAmountDue: nonnegativeNumber(amountDue[1] as string, "summary total amount due"),
    toBeSoldCount: integer(sold[1] as string, "summary to-be-sold count"),
    parcelsNotPublished: integer(unpublished[1] as string, "summary unpublished parcel count"),
    totalRecordsProcessed: integer(processed[1] as string, "summary processed record count"),
    publishedTotalAmount: nonnegativeNumber(published[1] as string, "summary published amount"),
    publishedParcelCount: integer(published[2] as string, "summary published parcel count"),
    reportCode: reportCode[1] as string,
  };
}

function cents(value: number) {
  return Math.round(value * 100);
}

export function reconcileMississippiRankinReport(input: ParsedMississippiRankinReport) {
  const summary = input.reportSummary;
  if (summary.totalAmountDue !== summary.publishedTotalAmount) {
    throw new Error("Rankin report published amount does not match total amount due");
  }
  if (
    summary.toBeSoldCount !== summary.publishedParcelCount ||
    input.rows.length + input.continuedSegmentCount !== summary.publishedParcelCount
  ) {
    throw new Error(
      `Rankin report complete parcel rows (${input.rows.length}) plus continued fragments (${input.continuedSegmentCount}) do not reconcile to the published count (${summary.publishedParcelCount})`,
    );
  }
  if (
    summary.totalRecordsProcessed !==
    summary.publishedParcelCount + summary.parcelsNotPublished
  ) {
    throw new Error(
      "Rankin report processed count does not reconcile to published and unpublished parcels",
    );
  }
  const rowTotal = input.rows.reduce((total, row) => total + cents(row.totalTaxAndCost), 0);
  if (rowTotal !== cents(summary.publishedTotalAmount)) {
    throw new Error("Rankin report parcel amounts do not reconcile to the published total");
  }
  const sequences = new Set(input.rows.map((row) => row.saleSequence));
  if (sequences.size !== input.rows.length)
    throw new Error("Rankin report contains duplicate sale sequences");
  const physicalRows = new Set(
    input.rows.map((row) => `${row.pageNumber}:${row.columnNumber}:${row.pageRowNumber}`),
  );
  if (physicalRows.size !== input.rows.length)
    throw new Error("Rankin report contains duplicate physical rows");
  return input;
}

export function parseMississippiRankinPositionedPages(input: {
  pages: PositionedPdfTextPage[];
  document: SourceDocumentReference;
}) {
  if (input.pages.length < 2 || input.pages.length > 10_000) {
    throw new Error("Rankin PDF page count is outside the supported report boundary");
  }
  const allLines = input.pages.map((page, index) => {
    if (page.pageNumber !== index + 1)
      throw new Error("Rankin PDF pages are not in exact sequence");
    if (
      Math.abs(page.width - RANKIN_REPORT_LAYOUT_V1.pageWidth) > 0.5 ||
      Math.abs(page.height - RANKIN_REPORT_LAYOUT_V1.pageHeight) > 0.5
    ) {
      throw new Error(`Rankin PDF page ${page.pageNumber} has an unsupported page size`);
    }
    const lines = linesFor(page);
    const footer = pageFooter(page, lines);
    if (footer.printedPageCount !== input.pages.length) {
      throw new Error(
        `Rankin PDF page ${page.pageNumber} does not declare the complete page count`,
      );
    }
    return { page, lines, taxYear: footer.taxYear };
  });
  const taxYear = (allLines[0] as (typeof allLines)[number]).taxYear;
  if (!Number.isInteger(taxYear) || allLines.some((page) => page.taxYear !== taxYear)) {
    throw new Error("Rankin PDF pages do not share one tax year");
  }
  const metadata = pageOneMetadata((allLines[0] as (typeof allLines)[number]).lines);
  const rows: MississippiRankinTaxSaleRow[] = [];
  let continuedSegmentCount = 0;
  for (const { page, lines } of allLines.slice(0, -1)) {
    for (
      let columnNumber = 1;
      columnNumber <= RANKIN_REPORT_LAYOUT_V1.columns.length;
      columnNumber += 1
    ) {
      const split = splitRecordSegments(
        columnLines(lines, columnNumber),
        `Rankin PDF page ${page.pageNumber} column ${columnNumber}`,
      );
      continuedSegmentCount += split.continuedSegmentCount;
      split.segments.forEach((segment, pageRowIndex) =>
        rows.push(
          parseRecordSegment({
            segment,
            page,
            columnNumber,
            pageRowNumber: pageRowIndex + 1,
            document: input.document,
            taxYear,
            saleDate: metadata.saleDate,
          }),
        ),
      );
    }
  }
  return reconcileMississippiRankinReport({
    rows,
    ...metadata,
    taxYear,
    continuedSegmentCount,
    reportSummary: parseSummary(allLines.at(-1)?.lines ?? []),
  });
}

export async function parseMississippiRankinTaxSalePdf(input: {
  pdfBytes: Uint8Array;
  document: SourceDocumentReference;
  extractPages: ExtractPositionedPdfTextPages;
}) {
  if (!hasPdfSignature(input.pdfBytes))
    throw new Error("Rankin source bytes must have a PDF signature");
  const actualHash = await sha256PdfBytes(input.pdfBytes);
  if (actualHash !== input.document.sha256.toLowerCase()) {
    throw new Error("Rankin PDF bytes must match the immutable source document SHA-256");
  }
  const pages = await input.extractPages(input.pdfBytes);
  return parseMississippiRankinPositionedPages({ pages, document: input.document });
}

function normalizedIdentifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function requiredText(value: string, field: string, maximum = 4_096) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maximum)
    throw new Error(`Rankin ${field} must be a bounded nonblank string`);
  return normalized;
}

function optionalText(value: string | null, field: string) {
  return value === null ? null : requiredText(value, field);
}

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value)
    throw new Error(`Rankin ${field} must be canonical UTC`);
  return value;
}

/**
 * The reviewed retrieval contract for the Rankin report: the official county
 * eGov document path, over HTTPS, with no credentials, query or fragment.
 *
 * Exported because a live run has to check this BEFORE fetching, while
 * `archivedRankinDocument` below checks it again at normalization time. Both
 * call this one function rather than restating the predicate, so a change to
 * the reviewed contract cannot land in one place and be missed in the other.
 */
export function assertMississippiRankinRetrievalUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Rankin source document URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.rankincounty.org" ||
    !/^\/egov\/documents\/[A-Za-z0-9_]+\.pdf$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Rankin source document URL is outside the reviewed official PDF path");
  }
  return url.toString();
}

function archivedRankinDocument(document: SourceDocumentReference) {
  assertMississippiRankinRetrievalUrl(document.url);
  if (!SHA256_HEX.test(document.sha256))
    throw new Error("Rankin source document SHA-256 is invalid");
  canonicalUtc(document.retrievedAt, "source document retrievedAt");
  if (document.publishedAt !== null && document.publishedAt !== undefined) {
    canonicalUtc(document.publishedAt, "source document publishedAt");
  }
  if (
    !document.objectStorageKey?.trim() ||
    document.mimeType !== "application/pdf" ||
    !Number.isSafeInteger(document.byteSize) ||
    (document.byteSize ?? -1) < 1
  ) {
    throw new Error("Rankin normalization requires the exact PDF in immutable object storage");
  }
  if (
    document.objectStorageKey.includes("\\") ||
    document.objectStorageKey.includes("..") ||
    document.objectStorageKey.startsWith("/") ||
    document.objectStorageKey.endsWith("/")
  ) {
    throw new Error("Rankin immutable object-storage key is unsafe");
  }
  return document;
}

function extension(key: string, value: string | number | boolean | null) {
  return value === null ? [] : [{ key, value, verificationStatus: "published" as const }];
}

export async function normalizeMississippiRankinTaxSaleRow(
  input: MississippiRankinTaxSaleRow,
): Promise<NormalizedIntakeBundle> {
  if (
    input.jurisdiction.stateCode !== "MS" ||
    input.jurisdiction.countyFips !== "28121" ||
    input.jurisdiction.countyName !== "Rankin"
  ) {
    throw new Error("Rankin normalization accepts only Rankin County, Mississippi");
  }
  const document = archivedRankinDocument(input.document);
  if (
    !Number.isSafeInteger(input.pageNumber) ||
    input.pageNumber < 1 ||
    !Number.isSafeInteger(input.columnNumber) ||
    input.columnNumber < 1 ||
    input.columnNumber > 3 ||
    !Number.isSafeInteger(input.pageRowNumber) ||
    input.pageRowNumber < 1
  ) {
    throw new Error("Rankin row location is invalid");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.saleDate) ||
    !Number.isSafeInteger(input.taxYear) ||
    input.taxYear < 1800
  ) {
    throw new Error("Rankin sale date or tax year is invalid");
  }
  const saleSequence = requiredText(input.saleSequence, "sale sequence", 32);
  if (!/^\d+$/.test(saleSequence) || Number(saleSequence) < 1)
    throw new Error("Rankin sale sequence is invalid");
  const parcelNumber = requiredText(input.parcelNumber, "parcel number", 255);
  const ppin = requiredText(input.ppin, "PPIN", 255);
  const owner = requiredText(input.assessedOwnerName, "owner name", 500);
  const descriptionLines = input.descriptionLines.map((line, index) =>
    requiredText(line, `description line ${index + 1}`),
  );
  if (descriptionLines.length < 1 || descriptionLines.length > 100)
    throw new Error("Rankin legal description is invalid");
  if (!Number.isFinite(input.totalTaxAndCost) || input.totalTaxAndCost < 0)
    throw new Error("Rankin total tax and cost is invalid");
  if (input.acres !== null && (!Number.isFinite(input.acres) || input.acres < 0))
    throw new Error("Rankin acreage is invalid");
  const receiptNumber = optionalText(input.receiptNumber, "receipt number");
  const normalizedParcelNumber = normalizedIdentifier(parcelNumber);
  const normalizedPpin = normalizedIdentifier(ppin);
  if (!normalizedParcelNumber || !normalizedPpin)
    throw new Error("Rankin identifiers cannot normalize to blank");
  const sourceRecordKey = [
    input.jurisdiction.countyFips,
    input.saleDate,
    saleSequence,
    normalizedParcelNumber,
    normalizedPpin,
  ].join(":");
  const semanticRecord = {
    saleDate: input.saleDate,
    taxYear: input.taxYear,
    saleSequence,
    parcelNumber,
    ppin,
    owner,
    receiptNumber,
    section: optionalText(input.section, "section"),
    township: optionalText(input.township, "township"),
    range: optionalText(input.range, "range"),
    taxDistrict: optionalText(input.taxDistrict, "tax district"),
    descriptionLines,
    instrumentHistory: input.instrumentHistory,
    deedBook: optionalText(input.deedBook, "deed book"),
    deedPage: optionalText(input.deedPage, "deed page"),
    acres: input.acres,
    totalTaxAndCost: input.totalTaxAndCost,
    raw: input.raw,
  };
  const identifiers = [
    {
      identifierType: "parcel_number" as const,
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: parcelNumber,
      normalizedValue: normalizedParcelNumber,
      verificationStatus: "published" as const,
      isAuthoritative: false,
    },
    {
      identifierType: "ppin" as const,
      issuerCountyFips: input.jurisdiction.countyFips,
      rawValue: ppin,
      normalizedValue: normalizedPpin,
      verificationStatus: "published" as const,
      isAuthoritative: false,
    },
  ];
  const extensions = [
    ...extension("published_sale_date", input.saleDate),
    ...extension("public_land_survey_section", semanticRecord.section),
    ...extension("public_land_survey_township", semanticRecord.township),
    ...extension("public_land_survey_range", semanticRecord.range),
    ...extension("tax_district_code", semanticRecord.taxDistrict),
    ...extension("published_deed_book", semanticRecord.deedBook),
    ...extension("published_deed_page", semanticRecord.deedPage),
  ];
  return {
    jurisdiction: {
      ...input.jurisdiction,
      censusGeoid: `0500000US${input.jurisdiction.countyFips}`,
    },
    sourceRecord: {
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiRankinTaxSale,
      sourceRecordKey,
      sourceVersion: "1",
      recordFingerprint: await stableSha256({
        sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiRankinTaxSale,
        sourceRecordKey,
        semanticRecord,
      }),
      sourceDocumentSha256: document.sha256,
      sourceDocumentUrl: document.url,
      sourceDocumentRetrievedAt: document.retrievedAt,
      sourceDocumentPublishedAt: document.publishedAt ?? null,
      sourceDocumentObjectStorageKey: document.objectStorageKey ?? null,
      sourceDocumentMimeType: document.mimeType ?? null,
      sourceDocumentByteSize: document.byteSize ?? null,
      sourceUrl: document.url,
      documentTitle: document.title,
      pageLocator: `page:${input.pageNumber}`,
      rowLocator: `column:${input.columnNumber}:row:${input.pageRowNumber}`,
      featureLocator: null,
      parsingStatus: "accepted",
      warnings: [],
      rawJson: {
        ...semanticRecord,
        pageNumber: input.pageNumber,
        columnNumber: input.columnNumber,
      },
    },
    propertyCandidate: {
      identifiers,
      addresses: [],
      observations:
        input.acres === null
          ? []
          : [
              {
                factType: "published_acres",
                value: input.acres,
                unit: "acre",
                effectiveDate: null,
                verificationStatus: "published",
                derivationMethod: null,
              },
            ],
    },
    auction: {
      eventKey: `${NATIONWIDE_SOURCE_DEFINITION_KEYS.mississippiRankinTaxSale}:${input.saleDate}`,
      eventLabel: `Rankin County ${input.taxYear} delinquent tax land sale`,
      saleMechanism: "redeemable_tax_deed",
      assetClass: "real_property",
      startsAt: null,
      endsAt: null,
      status: "scheduled",
      lotKey: sourceRecordKey,
      publishedLotNumber: saleSequence,
      publishedItemNumber: null,
      publishedCertificateNumber: null,
      publishedReceiptNumber: receiptNumber,
      publishedAddressText: null,
      legalDescription: descriptionLines.join(" | "),
      taxYears: [input.taxYear],
      amounts: [
        {
          amountType: "total_due",
          amount: input.totalTaxAndCost,
          currency: "USD",
          taxYear: input.taxYear,
          valueStatus: "published",
          publishedLabel: "TOTAL TAX & COST",
        },
      ],
      parties: [
        { role: "assessed_owner", publishedName: owner },
        { role: "administering_agency", publishedName: "Rankin County Tax Collector" },
      ],
      lifecycle: [
        {
          eventType: "advertised",
          effectiveAt: null,
          publishedStatusText: "Parcels offered for sale",
        },
      ],
      stateForfeitedDetails: null,
    },
    extensions,
    resolution: {
      status: "candidate",
      automaticMethodsAllowed: ["exact_scoped_identifier"],
      addressOnlyMatchAllowed: false,
      reason:
        "Resolve only against exact Rankin County parcel-number or PPIN evidence under an approved identifier policy.",
    },
  };
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
    throw new Error("Rankin PDF artifact prefix must be a safe relative object-storage prefix");
  }
  return prefix;
}

// Hash-verify then content-address the immutable Rankin PDF through Slice
// 2's injected artifact store BEFORE anything is parsed, mirroring the
// DeSoto adapter's `archiveMississippiDesotoTaxSalePdf`.
export async function archiveMississippiRankinTaxSalePdf(input: {
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
    throw new Error("Rankin source bytes must have a PDF signature");
  const archiveBytes = Uint8Array.from(input.pdfBytes);
  const parseBytes = Uint8Array.from(input.pdfBytes);
  const sha256 = await sha256PdfBytes(archiveBytes);
  if (sha256 !== input.document.sha256.toLowerCase()) {
    throw new Error(
      "Rankin PDF bytes must match the expected source document SHA-256 before archival",
    );
  }
  const objectStoragePrefix = safeArtifactPrefix(
    input.objectStoragePrefix ?? "nationwide/mississippi/rankin-county-tax-sale",
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
