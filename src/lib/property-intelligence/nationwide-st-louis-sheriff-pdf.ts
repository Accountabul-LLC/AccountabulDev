// Slice 3 of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-st-louis-sheriff-pdf.ts:
// the positioned-column parser for the City of St. Louis Sheriff's Land Tax
// Sale property-listing PDF, plus its normalization into the canonical
// auction-lot bundle shape (ported from the source's
// `normalizeLegacyStLouisTaxSale` in app/lib/nationwide-property-record-intake.ts,
// simplified to this repo's shared intake types).
import {
  hasPdfSignature,
  positionedLineText,
  sha256PdfBytes,
  type ExtractPositionedPdfTextPages,
  type PositionedPdfTextPage,
} from "./nationwide-pdf-text-layout.ts";
import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  archiveNationwideSourceBytes,
  type ArchivedSourceArtifact,
  type ImmutableArtifactStore,
} from "./nationwide-artifact-store.ts";
import {
  cleanText,
  normalizedGovernmentIdentifier,
  NATIONWIDE_SOURCE_DEFINITION_KEYS,
  requiredNonnegativeMoney,
  validateDocument,
  validateJurisdiction,
  type JurisdictionReference,
  type NormalizedIdentifierCandidate,
  type NormalizedIntakeBundle,
  type SourceDocumentReference,
} from "./nationwide-property-intake-types.ts";

export const ST_LOUIS_SHERIFF_LAYOUT_V1 = {
  pageWidth: 612.16,
  pageHeight: 792.07,
  firstDataY: 617.6,
  minimumDataY: 70,
  columns: {
    landTaxNumber: 54.2,
    owner: 125.9,
    address: 332,
    totalDueMinimum: 490,
  },
} as const;

const STREET_SUFFIXES = new Set([
  "ALY",
  "AV",
  "AVE",
  "BLVD",
  "CIR",
  "CT",
  "DR",
  "HWY",
  "LA",
  "LN",
  "PKWY",
  "PL",
  "RD",
  "ST",
  "TER",
  "TRL",
  "WAY",
]);

const MONTH_INDEX = new Map([
  ["January", 0],
  ["February", 1],
  ["March", 2],
  ["April", 3],
  ["May", 4],
  ["June", 5],
  ["July", 6],
  ["August", 7],
  ["September", 8],
  ["October", 9],
  ["November", 10],
  ["December", 11],
]);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type StLouisSheriffTaxSaleRow = {
  saleNumber: string;
  saleDate: string;
  publishedDate: string;
  landTaxNumber: string;
  owner: string;
  address: string;
  totalDue: number;
  pageNumber: number;
  pageRowNumber: number;
  documentRowNumber: number;
  document: SourceDocumentReference;
};

export type ParsedStLouisSheriffTaxSaleReport = {
  saleNumber: string;
  saleDate: string;
  publishedDate: string;
  pageCount: number;
  rows: StLouisSheriffTaxSaleRow[];
};

type PositionedLine = {
  y: number;
  words: PositionedPdfTextPage["words"];
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanOwner(value: string) {
  return clean(value).replace(/\s+`$/, "").trim();
}

function canonicalDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a real calendar date`);
  }
  return value;
}

function dateFromFooter(value: string) {
  const match = value.match(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})$/,
  );
  if (!match) throw new Error("St. Louis Sheriff PDF footer date is not recognized");
  const month = MONTH_INDEX.get(match[2] as string);
  const day = Number(match[3]);
  const year = Number(match[4]);
  if (month === undefined) throw new Error("St. Louis Sheriff PDF footer date is invalid");
  const parsed = new Date(Date.UTC(year, month, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day ||
    WEEKDAYS[parsed.getUTCDay()] !== match[1]
  ) {
    throw new Error("St. Louis Sheriff PDF footer date is invalid");
  }
  return parsed.toISOString().slice(0, 10);
}

function linesFor(page: PositionedPdfTextPage) {
  const grouped = new Map<string, PositionedPdfTextPage["words"]>();
  for (const word of page.words) {
    const key = word.y.toFixed(1);
    const group = grouped.get(key) ?? [];
    group.push(word);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map((words): PositionedLine => ({
      y: words.reduce((total, word) => total + word.y, 0) / words.length,
      words: [...words].sort((left, right) => left.x0 - right.x0),
    }))
    .sort((left, right) => right.y - left.y);
}

function lineText(line: PositionedLine) {
  return clean(line.words.map((word) => word.text).join(" "));
}

function near(actual: number, expected: number, tolerance = 2) {
  return Math.abs(actual - expected) <= tolerance;
}

function requiredExactLine(lines: PositionedLine[], expected: string, field: string) {
  if (
    !lines.some(
      (line) =>
        lineText(line) === expected || line.words.some((word) => clean(word.text) === expected),
    )
  ) {
    throw new Error(`St. Louis Sheriff PDF page is missing ${field}`);
  }
}

function pageHeader(input: {
  page: PositionedPdfTextPage;
  lines: PositionedLine[];
  saleNumber: string;
  pageCount: number;
}) {
  if (
    Math.abs(input.page.width - ST_LOUIS_SHERIFF_LAYOUT_V1.pageWidth) > 0.5 ||
    Math.abs(input.page.height - ST_LOUIS_SHERIFF_LAYOUT_V1.pageHeight) > 0.5
  ) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.page.pageNumber} has an unsupported page size`,
    );
  }
  requiredExactLine(input.lines, `Sale ${input.saleNumber}`, "the sale-number title");
  requiredExactLine(input.lines, "Property Listing", "the property-listing title");
  if (
    !input.page.words.some((word) =>
      clean(word.text).includes("property address is intended for guidance only"),
    ) ||
    !input.page.words.some((word) =>
      clean(word.text).includes("OFFICIAL notice is published in the St. Louis Daily Record"),
    )
  ) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.page.pageNumber} is missing the official courtesy-list disclaimer`,
    );
  }
  for (const heading of ["Land Tax #", "Owner", "Address", "Total"]) {
    requiredExactLine(input.lines, heading, `${heading} column heading`);
  }
  requiredExactLine(
    input.lines,
    `Page ${input.page.pageNumber} of ${input.pageCount}`,
    "the page-number footer",
  );
  const footerDate = input.lines
    .flatMap((line) => line.words.map((word) => clean(word.text)))
    .find((value) => /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(value));
  if (!footerDate)
    throw new Error(
      `St. Louis Sheriff PDF page ${input.page.pageNumber} is missing its publication footer`,
    );
  return dateFromFooter(footerDate);
}

function splitMergedOwnerAddress(value: string) {
  const tokens = clean(value).split(" ");
  if (tokens.length < 4 || !STREET_SUFFIXES.has(tokens.at(-1) ?? "")) {
    throw new Error(
      "St. Louis Sheriff PDF merged owner/address field has an unsupported street suffix",
    );
  }
  for (let index = tokens.length - 3; index >= 1; index -= 1) {
    if (!/^\d+[A-Z]?$/.test(tokens[index] as string)) continue;
    const owner = tokens.slice(0, index).join(" ");
    const address = tokens.slice(index).join(" ");
    if (owner && address) return { owner, address };
  }
  throw new Error(
    "St. Louis Sheriff PDF merged owner/address field has no reliable address boundary",
  );
}

function dollars(value: string) {
  if (!/^\$\d{1,3}(?:,\d{3})*\.\d{2}$/.test(value)) {
    throw new Error("St. Louis Sheriff PDF total must be a published USD amount");
  }
  const amount = Number(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("St. Louis Sheriff PDF total is invalid");
  return amount;
}

function parseRow(input: {
  line: PositionedLine;
  saleNumber: string;
  saleDate: string;
  publishedDate: string;
  pageNumber: number;
  pageRowNumber: number;
  documentRowNumber: number;
  document: SourceDocumentReference;
}): StLouisSheriffTaxSaleRow {
  const words = input.line.words.filter((word) => clean(word.text));
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || !near(first.x0, ST_LOUIS_SHERIFF_LAYOUT_V1.columns.landTaxNumber)) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} has a shifted land-tax column`,
    );
  }
  const landTaxNumber = clean(first.text);
  if (!new RegExp(`^${input.saleNumber}-\\d+(?:-\\d+)*$`).test(landTaxNumber)) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} has an invalid land-tax number`,
    );
  }
  if (last.x0 < ST_LOUIS_SHERIFF_LAYOUT_V1.columns.totalDueMinimum) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} has a shifted total column`,
    );
  }
  const middle = words.slice(1, -1);
  let owner: string;
  let address: string;
  if (middle.length === 2) {
    const [middleOwner, middleAddress] = middle as [
      (typeof middle)[number],
      (typeof middle)[number],
    ];
    if (
      !near(middleOwner.x0, ST_LOUIS_SHERIFF_LAYOUT_V1.columns.owner) ||
      !near(middleAddress.x0, ST_LOUIS_SHERIFF_LAYOUT_V1.columns.address)
    ) {
      throw new Error(
        `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} has shifted owner/address columns`,
      );
    }
    owner = cleanOwner(middleOwner.text);
    address = clean(middleAddress.text);
  } else if (
    middle.length === 1 &&
    near((middle[0] as (typeof middle)[number]).x0, ST_LOUIS_SHERIFF_LAYOUT_V1.columns.owner)
  ) {
    ({ owner, address } = splitMergedOwnerAddress((middle[0] as (typeof middle)[number]).text));
    owner = cleanOwner(owner);
  } else {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} does not have four recoverable columns`,
    );
  }
  if (!owner || !/^\d+[A-Z]?\s+\S+/.test(address)) {
    throw new Error(
      `St. Louis Sheriff PDF page ${input.pageNumber} row ${input.pageRowNumber} has an invalid owner or address`,
    );
  }
  return {
    saleNumber: input.saleNumber,
    saleDate: input.saleDate,
    publishedDate: input.publishedDate,
    landTaxNumber,
    owner,
    address,
    totalDue: dollars(clean(last.text)),
    pageNumber: input.pageNumber,
    pageRowNumber: input.pageRowNumber,
    documentRowNumber: input.documentRowNumber,
    document: input.document,
  };
}

export function parseStLouisSheriffTaxSalePages(input: {
  pages: PositionedPdfTextPage[];
  document: SourceDocumentReference;
  saleNumber: string;
  saleDate: string;
}): ParsedStLouisSheriffTaxSaleReport {
  const saleNumber = clean(input.saleNumber);
  if (!/^\d{1,6}$/.test(saleNumber))
    throw new Error("St. Louis Sheriff saleNumber must contain one to six digits");
  const saleDate = canonicalDate(input.saleDate, "saleDate");
  if (input.pages.length < 1 || input.pages.length > 500) {
    throw new Error("St. Louis Sheriff PDF page count is outside the supported boundary");
  }
  const rows: StLouisSheriffTaxSaleRow[] = [];
  let publishedDate: string | null = null;
  for (const [pageIndex, page] of input.pages.entries()) {
    if (page.pageNumber !== pageIndex + 1)
      throw new Error("St. Louis Sheriff PDF pages are not in exact sequence");
    const lines = linesFor(page);
    const pagePublishedDate = pageHeader({
      page,
      lines,
      saleNumber,
      pageCount: input.pages.length,
    });
    if (publishedDate !== null && pagePublishedDate !== publishedDate) {
      throw new Error("St. Louis Sheriff PDF pages do not share one publication date");
    }
    publishedDate = pagePublishedDate;
    const dataLines = lines.filter(
      (line) =>
        line.y >= ST_LOUIS_SHERIFF_LAYOUT_V1.minimumDataY &&
        line.y <= ST_LOUIS_SHERIFF_LAYOUT_V1.firstDataY + 2,
    );
    const rowPattern = new RegExp(`^${saleNumber}-\\d+(?:-\\d+)*$`);
    const unclassified = dataLines.find(
      (line) => !rowPattern.test(clean(line.words[0]?.text ?? "")),
    );
    if (unclassified) {
      throw new Error(
        `St. Louis Sheriff PDF page ${page.pageNumber} contains an unclassified data-region line`,
      );
    }
    for (const [rowIndex, line] of dataLines.entries()) {
      rows.push(
        parseRow({
          line,
          saleNumber,
          saleDate,
          publishedDate: pagePublishedDate,
          pageNumber: page.pageNumber,
          pageRowNumber: rowIndex + 1,
          documentRowNumber: rows.length + 1,
          document: input.document,
        }),
      );
    }
  }
  if (!publishedDate || rows.length === 0)
    throw new Error("St. Louis Sheriff PDF contains no recoverable sale rows");
  if (input.document.publishedAt && input.document.publishedAt.slice(0, 10) !== publishedDate) {
    throw new Error(
      "St. Louis Sheriff PDF footer date does not match the source document publication date",
    );
  }
  const unique = new Set(rows.map((row) => row.landTaxNumber));
  if (unique.size !== rows.length)
    throw new Error("St. Louis Sheriff PDF contains duplicate land-tax numbers");
  return { saleNumber, saleDate, publishedDate, pageCount: input.pages.length, rows };
}

export async function parseStLouisSheriffTaxSalePdf(input: {
  pdfBytes: Uint8Array;
  document: SourceDocumentReference;
  saleNumber: string;
  saleDate: string;
  extractPages: ExtractPositionedPdfTextPages;
}) {
  if (!hasPdfSignature(input.pdfBytes))
    throw new Error("St. Louis Sheriff source bytes must have a PDF signature");
  const actualHash = await sha256PdfBytes(input.pdfBytes);
  if (actualHash !== input.document.sha256.toLowerCase()) {
    throw new Error("St. Louis Sheriff PDF bytes must match the immutable source document SHA-256");
  }
  const pages = await input.extractPages(input.pdfBytes);
  return parseStLouisSheriffTaxSalePages({ ...input, pages });
}

// Ported from the source's `normalizeLegacyStLouisTaxSale`
// (app/lib/nationwide-property-record-intake.ts), which the Sheriff adapter
// feeds through a `LegacyStLouisTaxSaleRow` reshape
// (nationwide-st-louis-sheriff-tax-sale.ts's `normalizedRow`). This repo
// normalizes directly from `StLouisSheriffTaxSaleRow` instead, skipping that
// legacy-row indirection since there is no legacy table to bridge here.
const ST_LOUIS_SHERIFF_JURISDICTION: JurisdictionReference = {
  stateCode: "MO",
  countyName: "St. Louis City",
  countyFips: "29510",
};

export async function normalizeStLouisSheriffTaxSaleRow(
  row: StLouisSheriffTaxSaleRow,
): Promise<NormalizedIntakeBundle> {
  const jurisdiction = ST_LOUIS_SHERIFF_JURISDICTION;
  validateJurisdiction(jurisdiction);
  validateDocument(row.document);
  const saleNumber = cleanText(row.saleNumber);
  const landTaxNumber = cleanText(row.landTaxNumber);
  const publishedAddress = cleanText(row.address);
  if (!saleNumber) throw new Error("sale_number is required");
  if (!landTaxNumber) throw new Error("land_tax_number is required");
  if (!publishedAddress) throw new Error("address is required");
  const totalDue = requiredNonnegativeMoney(row.totalDue, "total_amount");
  const saleDate = row.saleDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) throw new Error("sale_date must use YYYY-MM-DD");
  const sourceRecordKey = `${jurisdiction.countyFips}:sheriff_tax_sale:${saleNumber}:${normalizedGovernmentIdentifier(landTaxNumber)}`;
  const published = {
    sale_number: saleNumber,
    land_tax_number: landTaxNumber,
    owner: cleanText(row.owner),
    address: publishedAddress,
    total_amount: totalDue,
    sale_date: saleDate,
  };
  const recordFingerprint = await stableSha256({
    sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisSheriffTaxSale,
    sourceRecordKey,
    published,
  });
  const identifiers: NormalizedIdentifierCandidate[] = [
    {
      identifierType: "tax_sale_parcel_reference",
      issuerCountyFips: jurisdiction.countyFips,
      rawValue: landTaxNumber,
      normalizedValue: normalizedGovernmentIdentifier(landTaxNumber),
      verificationStatus: "published",
      isAuthoritative: false,
    },
  ];
  const parties: NormalizedIntakeBundle["auction"]["parties"] = [
    { role: "administering_agency", publishedName: "St. Louis Sheriff" },
  ];
  if (published.owner) parties.push({ role: "assessed_owner", publishedName: published.owner });
  return {
    jurisdiction: { ...jurisdiction, censusGeoid: `0500000US${jurisdiction.countyFips}` },
    sourceRecord: {
      sourceDefinitionKey: NATIONWIDE_SOURCE_DEFINITION_KEYS.stLouisSheriffTaxSale,
      sourceRecordKey,
      sourceVersion: "1",
      recordFingerprint,
      sourceDocumentSha256: row.document.sha256,
      sourceDocumentUrl: row.document.url,
      sourceDocumentRetrievedAt: row.document.retrievedAt,
      sourceDocumentPublishedAt: row.document.publishedAt ?? null,
      sourceDocumentObjectStorageKey: row.document.objectStorageKey ?? null,
      sourceDocumentMimeType: row.document.mimeType ?? null,
      sourceDocumentByteSize: row.document.byteSize ?? null,
      sourceUrl: row.document.url,
      documentTitle: row.document.title,
      pageLocator: `page:${row.pageNumber}`,
      rowLocator: String(row.documentRowNumber),
      featureLocator: null,
      parsingStatus: "accepted",
      warnings: [],
      rawJson: { ...row, document: undefined } as unknown as Record<string, unknown>,
    },
    propertyCandidate: {
      identifiers,
      addresses: [
        {
          role: "unknown_published",
          rawAddress: publishedAddress,
          city: null,
          stateCode: null,
          postalCode: null,
          verificationStatus: "published",
        },
      ],
      observations: [],
    },
    auction: {
      eventKey: `${jurisdiction.countyFips}:sheriff_tax_sale:${saleNumber}`,
      eventLabel: `St. Louis Sheriff Land Tax Sale ${saleNumber}`,
      saleMechanism: "sheriff_or_judicial_sale",
      assetClass: "real_property",
      startsAt: `${saleDate}T00:00:00.000Z`,
      endsAt: null,
      status: "scheduled",
      lotKey: sourceRecordKey,
      publishedLotNumber: landTaxNumber,
      publishedItemNumber: null,
      publishedCertificateNumber: null,
      publishedReceiptNumber: null,
      publishedAddressText: publishedAddress,
      legalDescription: null,
      taxYears: [],
      amounts: [
        {
          amountType: "total_due",
          amount: totalDue,
          currency: "USD",
          taxYear: null,
          valueStatus: "published",
          publishedLabel: "Amount owed",
        },
      ],
      parties,
      lifecycle: [
        {
          eventType: "advertised",
          effectiveAt: row.document.publishedAt ?? null,
          publishedStatusText: "Published on the Sheriff's Land Tax Sale property list",
        },
      ],
      stateForfeitedDetails: null,
    },
    extensions: [],
    resolution: {
      status: "unresolved",
      automaticMethodsAllowed: ["exact_scoped_identifier"],
      addressOnlyMatchAllowed: false,
      reason:
        "The land-tax sale number is not an APN; resolution requires a separately published parcel identifier or official crosswalk.",
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
    throw new Error(
      "St. Louis Sheriff PDF artifact prefix must be a safe relative object-storage prefix",
    );
  }
  return prefix;
}

// Hash-verify then content-address the immutable Sheriff PDF through Slice
// 2's injected artifact store BEFORE anything is parsed, mirroring the
// DeSoto adapter's `archiveMississippiDesotoTaxSalePdf`.
export async function archiveStLouisSheriffTaxSalePdf(input: {
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
    throw new Error("St. Louis Sheriff source bytes must have a PDF signature");
  const archiveBytes = Uint8Array.from(input.pdfBytes);
  const parseBytes = Uint8Array.from(input.pdfBytes);
  const sha256 = await sha256PdfBytes(archiveBytes);
  if (sha256 !== input.document.sha256.toLowerCase()) {
    throw new Error(
      "St. Louis Sheriff PDF bytes must match the expected source document SHA-256 before archival",
    );
  }
  const objectStoragePrefix = safeArtifactPrefix(
    input.objectStoragePrefix ?? "nationwide/missouri/st-louis/sheriff-tax-sale",
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

export { canonicalDate as canonicalStLouisSheriffDate, dateFromFooter as stLouisSheriffFooterDate };
