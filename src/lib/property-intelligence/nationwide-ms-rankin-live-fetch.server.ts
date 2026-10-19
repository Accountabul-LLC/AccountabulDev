// Live `fetchRows` for ms_rankin_county_tax_sale_report_v1.
//
// Rankin is the simplest of the three PDF sources to bring live, because the
// county publishes the report at a direct document URL rather than behind a
// landing page (nationwide-source-catalog.ts carries that URL), and because
// the reviewed retrieval contract already existed in
// nationwide-ms-rankin-pdf.ts -- it is now exported there as
// `assertMississippiRankinRetrievalUrl` so this module checks the same rule
// before fetching that normalization checks afterwards.
//
// `reportUrl` is required rather than defaulted to the catalog entry. The
// county issues a NEW document id per tax year, so a default would quietly
// keep ingesting last year's sale after the county moved on, and the run
// would look healthy while being a year stale. Naming the document is the
// operator's act.
//
// The parse is reconciled against the report's own published summary by
// `parseMississippiRankinTaxSalePdf`, so a partial text extraction fails
// there rather than being written as a short sale.
import {
  archiveMississippiRankinTaxSalePdf,
  assertMississippiRankinRetrievalUrl,
  parseMississippiRankinTaxSalePdf,
  type normalizeMississippiRankinTaxSaleRow,
} from "./nationwide-ms-rankin-pdf.ts";
import { retrieveNationwidePdf } from "./nationwide-pdf-retrieval.server.ts";
import type { ImmutableArtifactStore } from "./nationwide-artifact-store.ts";
import type { ExtractPositionedPdfTextPages } from "./nationwide-pdf-text-layout.ts";
import { SHA256_HEX } from "../validation/patterns.ts";

type NormalizeInput = Parameters<typeof normalizeMississippiRankinTaxSaleRow>[0];

export type MississippiRankinLiveFetchOptions = {
  // The exact published report for the tax year being ingested. See header.
  reportUrl: string;
  artifactStore: ImmutableArtifactStore;
  extractPages: ExtractPositionedPdfTextPages;
  fetchImpl?: typeof fetch;
  maxPdfBytes?: number;
  // Optional: when the operator already knows the report's SHA-256 (for
  // example RANKIN_2025_REPORT_EVIDENCE.sha256), passing it here turns the
  // archive-time hash check into a real check against an independently
  // asserted value instead of one the run computed for itself.
  expectedSha256?: string;
};

export type MississippiRankinFetchRows = () => Promise<{
  rows: NormalizeInput[];
  sourceObjectIds: string[];
  reportedCount: number;
}>;

export function createMississippiRankinLiveFetchRows(
  options: MississippiRankinLiveFetchOptions,
): MississippiRankinFetchRows {
  if (!options.artifactStore || typeof options.artifactStore.putBytes !== "function") {
    throw new Error("createMississippiRankinLiveFetchRows requires an injected artifactStore");
  }
  if (typeof options.extractPages !== "function") {
    throw new Error("createMississippiRankinLiveFetchRows requires an injected extractPages");
  }
  if (options.expectedSha256 !== undefined && !SHA256_HEX.test(options.expectedSha256)) {
    throw new Error("expectedSha256 must be a lowercase hex SHA-256 digest");
  }
  // Checked when the fetcher is built, so a bad URL fails at wiring time
  // rather than in the middle of a scheduled run.
  const reportUrl = assertMississippiRankinRetrievalUrl(options.reportUrl);
  const artifactStore = options.artifactStore;
  const extractPages = options.extractPages;

  return async function fetchMississippiRankinRowsLive() {
    const retrieved = await retrieveNationwidePdf({
      url: reportUrl,
      assertUrl: assertMississippiRankinRetrievalUrl,
      fetchImpl: options.fetchImpl ?? fetch,
      ...(options.maxPdfBytes === undefined ? {} : { maxBytes: options.maxPdfBytes }),
    });
    if (options.expectedSha256 !== undefined && retrieved.sha256 !== options.expectedSha256) {
      throw new Error("Rankin report bytes do not match the operator-asserted SHA-256");
    }

    const archived = await archiveMississippiRankinTaxSalePdf({
      pdfBytes: retrieved.pdfBytes,
      artifactStore,
      document: {
        url: retrieved.url,
        title: "Rankin County land sold for taxes report",
        sha256: retrieved.sha256,
        retrievedAt: retrieved.retrievedAt,
        publishedAt: null,
      },
    });

    const parsed = await parseMississippiRankinTaxSalePdf({
      pdfBytes: archived.pdfBytes,
      document: archived.document,
      extractPages,
    });

    return {
      rows: parsed.rows,
      // Position in the published report: page, column within the page, then
      // row within the column. Deterministic for a given document, which is
      // what a re-run compares against.
      sourceObjectIds: parsed.rows.map(
        (row) => `${row.pageNumber}:${row.columnNumber}:${row.pageRowNumber}`,
      ),
      // The report states its own published parcel count; using it rather
      // than rows.length is what lets the run's completeness check notice a
      // parse that silently dropped rows.
      reportedCount: parsed.reportSummary.publishedParcelCount,
    };
  };
}
