// Shared HTTPS retrieval for the three nationwide PDF sources (St. Louis
// Sheriff land tax sale, DeSoto County tax sale, Rankin County tax sale).
//
// The three source modules each already own the hard half -- layout parsing,
// reconciliation against the report's own published totals, archival under a
// content-addressed key. What none of them owns is getting the bytes, because
// each was written to be handed `pdfBytes` by its caller. This is that caller,
// factored out once rather than three times, and it is the only place in the
// nationwide PDF path that touches the network.
//
// It is deliberately narrow, because "download a URL and parse it" is the
// step where a source contract change turns into a fetch of something else
// entirely:
//
//   * the caller passes an `assertUrl` guard belonging to the source (e.g.
//     assertStLouisSheriffRetrievalUrl). This module has no allowlist of its
//     own and refuses to invent one -- it will not fetch a URL that no source
//     module has vouched for.
//   * `redirect: "error"`. A redirect is the cheap way to move a fetch off an
//     allowlisted origin after the guard has already passed, so a redirect is
//     a failure rather than something to follow and re-check.
//   * the body is read through a bounded reader, so a source that starts
//     streaming without end fails at the boundary instead of growing until
//     the process dies. The cap is checked while reading, not after, because
//     checking content-length alone trusts the server's own claim.
//   * the bytes must carry a PDF signature. The source modules check this too;
//     checking here as well means an HTML error page served with a 200 is
//     rejected before it is archived as if it were the report.
//
// The SHA-256 is computed from the bytes actually received and returned to the
// caller, which then passes it as the expected `document.sha256`. That makes
// the archive-time hash check self-consistent by construction for a live run
// -- the check exists to catch a mismatch between bytes and a hash asserted
// from elsewhere (a pinned evidence constant, a prior run), and a live caller
// that pins DESOTO_2025_REPORT_EVIDENCE.sha256 instead still gets the real
// check.

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MILLIS = 60_000;

export type RetrievePdfOptions = {
  url: string;
  // The owning source module's guard. Required: this module keeps no
  // allowlist and will not fetch an unvouched URL.
  assertUrl: (url: string) => string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMillis?: number;
};

export type RetrievedPdf = {
  url: string;
  pdfBytes: Uint8Array;
  sha256: string;
  retrievedAt: string;
  byteSize: number;
};

function boundedBytes(value: number | undefined) {
  const maxBytes = value ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 256 * 1024 * 1024) {
    throw new Error("maxBytes must be an integer between 1024 and 268435456");
  }
  return maxBytes;
}

function boundedTimeout(value: number | undefined) {
  const timeoutMillis = value ?? DEFAULT_TIMEOUT_MILLIS;
  if (!Number.isInteger(timeoutMillis) || timeoutMillis < 1_000 || timeoutMillis > 300_000) {
    throw new Error("timeoutMillis must be an integer between 1000 and 300000");
  }
  return timeoutMillis;
}

function hasPdfSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

async function readBounded(response: Response, maxBytes: number) {
  const body = response.body;
  if (!body) throw new Error("nationwide PDF retrieval received a response with no body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Checked while reading: a content-length header is the server's claim,
      // not a limit.
      if (total > maxBytes) {
        throw new Error("nationwide PDF retrieval exceeded the maximum allowed size");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function retrieveNationwidePdf(options: RetrievePdfOptions): Promise<RetrievedPdf> {
  if (typeof options.assertUrl !== "function") {
    throw new Error("retrieveNationwidePdf requires the owning source module's URL guard");
  }
  const url = options.assertUrl(options.url);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("nationwide PDF retrieval is restricted to HTTPS");
  }
  const maxBytes = boundedBytes(options.maxBytes);
  const timeoutMillis = boundedTimeout(options.timeoutMillis);
  const fetchImpl = options.fetchImpl ?? fetch;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMillis);
  const retrievedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/pdf", "user-agent": "Accountabul-Nationwide-Ingest/1" },
      redirect: "error",
      signal: abort.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`nationwide PDF retrieval returned HTTP ${response.status}`);
  }
  const pdfBytes = await readBounded(response, maxBytes);
  if (!hasPdfSignature(pdfBytes)) {
    throw new Error("nationwide PDF retrieval did not return PDF bytes");
  }
  return {
    url,
    pdfBytes,
    sha256: await sha256Hex(pdfBytes),
    retrievedAt,
    byteSize: pdfBytes.byteLength,
  };
}
