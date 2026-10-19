// Live `fetchRows` for ms_county_tax_sale_report_v1 (DeSoto County tax sale).
//
// This is the one source of the six where the repository does NOT already
// carry a reviewed retrieval contract, and that gap is handled here rather
// than papered over. The other five each pin retrieval to something a
// reviewer signed off on:
//
//   * the LRA and DeSoto land-roll layers pin an exact ArcGIS layer URL
//   * the Sheriff report pins a city origin and document path, and discovers
//     the current sale from a landing page whose identity is checked
//   * Rankin pins the county eGov document path
//     (assertMississippiRankinRetrievalUrl)
//   * MS SOS goes through an authorized transport that opens a consistent
//     snapshot
//
// DeSoto's tax sale has none of these. nationwide-source-catalog.ts records
// only an HTML landing page (`/690/Tax-Sale-Information`), not a document
// path, and nationwide-ms-desoto-pdf.ts -- unlike its Rankin counterpart --
// asserts no host or path for the document it parses. Writing a scraper for
// that landing page would mean inventing a page contract from a structure
// nobody in this repository has reviewed, and inventing a host/path
// allowlist to go with it. That is a guess, and a guess in the retrieval
// step is the expensive kind: it decides what bytes get archived as the
// official record.
//
// So the contract is injected instead of invented. The caller supplies both
// the exact `reportUrl` and the `assertUrl` guard that vouches for it -- the
// same shape in which `extractPages` and the SOS `transport` are already
// deferred to the caller. That keeps this module genuinely live (it really
// retrieves, archives, parses and reconciles) while leaving the one decision
// it has no basis to make with the person who does.
//
// The parse is still reconciled against the report's own published totals by
// `reconcileMississippiDesotoReport`, so a truncated or misread document
// fails rather than being written as a short sale.
import {
  archiveMississippiDesotoTaxSalePdf,
  parseMississippiDesotoTaxSalePdf,
  reconcileMississippiDesotoReport,
} from "./nationwide-ms-desoto-pdf.ts";
import { retrieveNationwidePdf } from "./nationwide-pdf-retrieval.server.ts";
import type { ImmutableArtifactStore } from "./nationwide-artifact-store.ts";
import type { ExtractPositionedPdfTextPages } from "./nationwide-pdf-text-layout.ts";
import type { normalizeMississippiCountyTaxSale } from "./nationwide-ms-county-tax-sale-normalize.ts";
import { SHA256_HEX } from "../validation/patterns.ts";

type NormalizeInput = Parameters<typeof normalizeMississippiCountyTaxSale>[0];

export type MississippiDesotoTaxSaleLiveFetchOptions = {
  // The exact published report being ingested, and the guard that vouches
  // for it. Both required: see the header for why neither is defaulted.
  reportUrl: string;
  assertUrl: (url: string) => string;
  artifactStore: ImmutableArtifactStore;
  extractPages: ExtractPositionedPdfTextPages;
  fetchImpl?: typeof fetch;
  maxPdfBytes?: number;
  // Optional, e.g. DESOTO_2025_REPORT_EVIDENCE.sha256: when supplied, the
  // archive-time hash check becomes a check against an independently
  // asserted digest rather than one the run computed for itself.
  expectedSha256?: string;
};

export type MississippiDesotoTaxSaleFetchRows = () => Promise<{
  rows: NormalizeInput[];
  sourceObjectIds: string[];
  reportedCount: number;
}>;

export function createMississippiDesotoTaxSaleLiveFetchRows(
  options: MississippiDesotoTaxSaleLiveFetchOptions,
): MississippiDesotoTaxSaleFetchRows {
  if (typeof options.assertUrl !== "function") {
    throw new Error(
      "createMississippiDesotoTaxSaleLiveFetchRows requires a reviewed assertUrl guard; this repository carries no retrieval contract for the DeSoto tax-sale report",
    );
  }
  if (!options.artifactStore || typeof options.artifactStore.putBytes !== "function") {
    throw new Error(
      "createMississippiDesotoTaxSaleLiveFetchRows requires an injected artifactStore",
    );
  }
  if (typeof options.extractPages !== "function") {
    throw new Error(
      "createMississippiDesotoTaxSaleLiveFetchRows requires an injected extractPages",
    );
  }
  if (options.expectedSha256 !== undefined && !SHA256_HEX.test(options.expectedSha256)) {
    throw new Error("expectedSha256 must be a lowercase hex SHA-256 digest");
  }
  const assertUrl = options.assertUrl;
  // Run the caller's guard at wiring time too, so a URL it rejects fails
  // before a scheduled run rather than inside one.
  const reportUrl = assertUrl(options.reportUrl);
  const artifactStore = options.artifactStore;
  const extractPages = options.extractPages;

  return async function fetchMississippiDesotoTaxSaleRowsLive() {
    const retrieved = await retrieveNationwidePdf({
      url: reportUrl,
      assertUrl,
      fetchImpl: options.fetchImpl ?? fetch,
      ...(options.maxPdfBytes === undefined ? {} : { maxBytes: options.maxPdfBytes }),
    });
    if (options.expectedSha256 !== undefined && retrieved.sha256 !== options.expectedSha256) {
      throw new Error("DeSoto tax-sale report bytes do not match the operator-asserted SHA-256");
    }

    const archived = await archiveMississippiDesotoTaxSalePdf({
      pdfBytes: retrieved.pdfBytes,
      artifactStore,
      document: {
        url: retrieved.url,
        title: "DeSoto County land sold for taxes report",
        sha256: retrieved.sha256,
        retrievedAt: retrieved.retrievedAt,
        publishedAt: null,
      },
    });

    const parsed = await parseMississippiDesotoTaxSalePdf({
      pdfBytes: archived.pdfBytes,
      document: archived.document,
      extractPages,
    });
    // Against the report's own published totals: a misread column or a
    // truncated extraction fails here instead of being written as a short
    // sale.
    reconcileMississippiDesotoReport(parsed);

    return {
      rows: parsed.rows,
      // Position in the published report: page, then row within the page.
      sourceObjectIds: parsed.rows.map((row) => `${row.pageNumber}:${row.rowNumber}`),
      reportedCount: parsed.rows.length,
    };
  };
}
