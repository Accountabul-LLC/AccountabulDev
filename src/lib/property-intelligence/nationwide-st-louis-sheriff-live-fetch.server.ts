// Live `fetchRows` for mo_st_louis_sheriff_tax_sale_v1.
//
// This source is the one that needs two round trips, because the Sheriff does
// not publish a stable URL for the current sale list: each sale gets its own
// PDF under a new filename, announced on one landing page. So the run is
// discover-then-retrieve, and both halves were already ported and reviewed:
//
//   1. nationwide-st-louis-sheriff-landing.ts parses the landing page and
//      yields the current sale's PDF URL, refusing the whole page if it
//      carries any PDF anchor outside the reviewed city document path.
//   2. nationwide-pdf-retrieval.server.ts fetches those bytes under that same
//      module's `assertStLouisSheriffRetrievalUrl` guard.
//   3. nationwide-st-louis-sheriff-pdf.ts archives and parses them.
//
// Nothing here re-decides any of that. The one judgement this module does
// make is what "no sale" means: the landing page legitimately publishes no
// PDF between sales, and that is an empty run, not a failure. Treating it as
// an error would turn a normal quiet week into a paging health incident;
// treating a MISSING page or a changed page as empty would do the opposite
// and quietly report zero rows for a source that broke, which is why those
// still throw.
//
// The landing page is HTML, so it is fetched here rather than through the
// shared PDF helper -- but under the same discipline: HTTPS only, no
// redirects, a bounded read, and the reviewed-URL guard first.
import {
  archiveStLouisSheriffTaxSalePdf,
  parseStLouisSheriffTaxSalePdf,
} from "./nationwide-st-louis-sheriff-pdf.ts";
import {
  assertStLouisSheriffRetrievalUrl,
  parseStLouisSheriffLandingPage,
  ST_LOUIS_SHERIFF_CURRENT_LIST_URL,
} from "./nationwide-st-louis-sheriff-landing.ts";
import { retrieveNationwidePdf } from "./nationwide-pdf-retrieval.server.ts";
import type { ImmutableArtifactStore } from "./nationwide-artifact-store.ts";
import type { ExtractPositionedPdfTextPages } from "./nationwide-pdf-text-layout.ts";
import type { normalizeStLouisSheriffTaxSaleRow } from "./nationwide-st-louis-sheriff-pdf.ts";

const MAX_LANDING_BYTES = 2_000_000;
const LANDING_TIMEOUT_MILLIS = 30_000;

type NormalizeInput = Parameters<typeof normalizeStLouisSheriffTaxSaleRow>[0];

export type StLouisSheriffLiveFetchOptions = {
  // No defaults: both are real dependencies the caller owns. `extractPages`
  // has no in-repo implementation on purpose -- positioned text extraction
  // needs a PDF engine, and which one is the caller's choice, exactly as the
  // three parser modules already require.
  artifactStore: ImmutableArtifactStore;
  extractPages: ExtractPositionedPdfTextPages;
  fetchImpl?: typeof fetch;
  maxPdfBytes?: number;
};

export type StLouisSheriffFetchRows = () => Promise<{
  rows: NormalizeInput[];
  sourceObjectIds: string[];
  reportedCount: number;
}>;

async function retrieveLandingPage(fetchImpl: typeof fetch) {
  const url = assertStLouisSheriffRetrievalUrl(ST_LOUIS_SHERIFF_CURRENT_LIST_URL, "landing");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), LANDING_TIMEOUT_MILLIS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html", "user-agent": "Accountabul-Nationwide-Ingest/1" },
      redirect: "error",
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`official Sheriff landing page returned HTTP ${response.status}`);
  }
  const html = await response.text();
  if (html.length > MAX_LANDING_BYTES) {
    throw new Error("official Sheriff landing page exceeded the supported size boundary");
  }
  return html;
}

export function createStLouisSheriffLiveFetchRows(
  options: StLouisSheriffLiveFetchOptions,
): StLouisSheriffFetchRows {
  if (!options.artifactStore || typeof options.artifactStore.putBytes !== "function") {
    throw new Error("createStLouisSheriffLiveFetchRows requires an injected artifactStore");
  }
  if (typeof options.extractPages !== "function") {
    throw new Error("createStLouisSheriffLiveFetchRows requires an injected extractPages");
  }
  const artifactStore = options.artifactStore;
  const extractPages = options.extractPages;

  return async function fetchStLouisSheriffRowsLive() {
    const fetchImpl = options.fetchImpl ?? fetch;
    const landing = parseStLouisSheriffLandingPage(await retrieveLandingPage(fetchImpl));
    // A quiet week between sales, not a breakage. See the header.
    if (landing.currentSale === null) {
      return { rows: [], sourceObjectIds: [], reportedCount: 0 };
    }
    const sale = landing.currentSale;

    const retrieved = await retrieveNationwidePdf({
      url: sale.pdfUrl,
      assertUrl: (url) => assertStLouisSheriffRetrievalUrl(url, "pdf"),
      fetchImpl,
      ...(options.maxPdfBytes === undefined ? {} : { maxBytes: options.maxPdfBytes }),
    });

    const archived = await archiveStLouisSheriffTaxSalePdf({
      pdfBytes: retrieved.pdfBytes,
      artifactStore,
      document: {
        url: retrieved.url,
        title: `City of St. Louis Sheriff land tax sale ${sale.saleNumber} (${sale.saleDate})`,
        sha256: retrieved.sha256,
        retrievedAt: retrieved.retrievedAt,
        publishedAt: sale.saleDate,
      },
    });

    const parsed = await parseStLouisSheriffTaxSalePdf({
      pdfBytes: archived.pdfBytes,
      document: archived.document,
      saleNumber: sale.saleNumber,
      saleDate: sale.saleDate,
      extractPages,
    });

    return {
      rows: parsed.rows,
      // The published report has no per-row identifier of its own, so a row's
      // identity is its position in the document that carried it --
      // deterministic for a given sale PDF, which is what a re-run compares
      // against.
      sourceObjectIds: parsed.rows.map((row) => `${sale.saleNumber}:${row.documentRowNumber}`),
      reportedCount: parsed.rows.length,
    };
  };
}
