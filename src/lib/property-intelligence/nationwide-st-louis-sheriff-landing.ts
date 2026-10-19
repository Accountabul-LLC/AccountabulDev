// Discovery half of the St. Louis Sheriff land-tax-sale source, ported from
// property-intelligence-app's app/lib/nationwide-st-louis-sheriff-tax-sale.ts.
// nationwide-st-louis-sheriff-pdf.ts already carries the parsing, normalization
// and archiving half; this is how the current sale's PDF is found in the first
// place.
//
// The parser is deliberately suspicious of its own input, because its output
// becomes a URL something later fetches:
//
//   * the page must still identify itself as the reviewed Sheriff page, by two
//     distinct phrases, or the contract is treated as changed rather than
//     guessed at
//   * EVERY PDF anchor on the page must sit on the reviewed city origin and
//     document path. One unreviewed target fails the whole parse instead of
//     being filtered out quietly -- filtering would let an injected link sit
//     alongside the real one unnoticed, and the point here is to notice.
//   * the anchor label must match the exact "Sale <n>: <Month D, YYYY>" shape,
//     the filename must begin with that same sale number, and the URL may
//     carry no credentials, query or fragment
//
// It performs no I/O: a caller supplies the HTML, so this module cannot reach
// the network on its own.

export const ST_LOUIS_SHERIFF_CURRENT_LIST_URL =
  "https://www.stlouis-mo.gov/government/departments/sheriff/documents/current-land-tax-sale-properties.cfm";

export const ST_LOUIS_SHERIFF_CITY_ORIGIN = "https://www.stlouis-mo.gov";
export const ST_LOUIS_SHERIFF_PDF_PATH_PREFIX = "/government/departments/sheriff/documents/upload/";

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

export type StLouisSheriffCurrentSale = {
  saleNumber: string;
  saleDate: string;
  pdfUrl: string;
  label: string;
};

export type StLouisSheriffLandingContract = {
  currentSale: StLouisSheriffCurrentSale | null;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function plainText(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function dateFromLabel(value: string) {
  const match = value.match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) throw new Error("official Sheriff sale label contains an invalid date");
  const month = MONTH_INDEX.get(match[1] ?? "");
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month === undefined) throw new Error("official Sheriff sale label contains an invalid date");
  const parsed = new Date(Date.UTC(year, month, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("official Sheriff sale label contains an invalid date");
  }
  return parsed.toISOString().slice(0, 10);
}

export function parseStLouisSheriffLandingPage(html: string): StLouisSheriffLandingContract {
  if (typeof html !== "string" || html.length < 500 || html.length > 2_000_000) {
    throw new Error("official Sheriff landing page is outside the supported size boundary");
  }
  const pageText = plainText(html);
  if (
    !/Current Land Tax Sale Properties/i.test(pageText) ||
    !/Land Tax Sale Properties List is posted two weeks prior/i.test(pageText)
  ) {
    throw new Error("official Sheriff landing-page identity changed");
  }
  const allPdfAnchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const url = new URL(decodeHtml(match[1] ?? ""), ST_LOUIS_SHERIFF_CURRENT_LIST_URL);
      return { url, label: plainText(match[2] ?? "") };
    })
    .filter(({ url }) => /\.pdf$/i.test(url.pathname));
  const pdfAnchors = allPdfAnchors.filter(
    ({ url }) =>
      url.origin === ST_LOUIS_SHERIFF_CITY_ORIGIN &&
      url.pathname.startsWith(ST_LOUIS_SHERIFF_PDF_PATH_PREFIX) &&
      /\.pdf$/i.test(url.pathname),
  );
  // Not a filter: one unreviewed target fails the whole parse, so an injected
  // link cannot ride along beside the genuine one.
  if (allPdfAnchors.length !== pdfAnchors.length) {
    throw new Error("official Sheriff landing page contains an unreviewed PDF target");
  }
  if (pdfAnchors.length === 0) return { currentSale: null };
  if (pdfAnchors.length !== 1) {
    throw new Error("official Sheriff landing page must publish at most one current sale PDF");
  }
  const anchor = pdfAnchors[0];
  if (anchor === undefined) return { currentSale: null };
  const labelMatch = anchor.label.match(/^Sale\s+(\d{1,6}):\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})$/);
  if (!labelMatch) {
    throw new Error(
      "official Sheriff PDF label does not contain the expected sale number and date",
    );
  }
  const saleNumber = labelMatch[1] ?? "";
  const filename = anchor.url.pathname.split("/").at(-1) ?? "";
  if (
    !filename.startsWith(`${saleNumber}-`) ||
    anchor.url.username ||
    anchor.url.password ||
    anchor.url.search ||
    anchor.url.hash
  ) {
    throw new Error("official Sheriff PDF URL does not match the reviewed city document contract");
  }
  return {
    currentSale: {
      saleNumber,
      saleDate: dateFromLabel(labelMatch[2] ?? ""),
      pdfUrl: anchor.url.toString(),
      label: anchor.label,
    },
  };
}

/**
 * Guards a retrieval URL against the reviewed contract before any fetch. The
 * landing page may only ever be the one reviewed page; a PDF may only be on
 * the city origin, under the reviewed document path, with no credentials,
 * query or fragment.
 */
export function assertStLouisSheriffRetrievalUrl(url: string, kind: "landing" | "pdf") {
  const parsed = new URL(url);
  if (kind === "landing" && parsed.toString() !== ST_LOUIS_SHERIFF_CURRENT_LIST_URL) {
    throw new Error("official Sheriff landing retrieval is restricted to the reviewed city page");
  }
  if (
    kind === "pdf" &&
    (parsed.origin !== ST_LOUIS_SHERIFF_CITY_ORIGIN ||
      !parsed.pathname.startsWith(ST_LOUIS_SHERIFF_PDF_PATH_PREFIX) ||
      !/\.pdf$/i.test(parsed.pathname) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash)
  ) {
    throw new Error(
      "official Sheriff PDF retrieval is restricted to the reviewed city document path",
    );
  }
  return parsed.toString();
}
