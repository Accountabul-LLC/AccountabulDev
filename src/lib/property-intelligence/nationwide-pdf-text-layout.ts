// Slice 3 of the nationwide multi-state ingestion port (continues Slice 1
// 029fbe9, Slice 2 23893a1). Shared types and pure line-grouping helpers for
// the positioned-text PDF parsers ported in this slice
// (nationwide-st-louis-sheriff-pdf.ts, nationwide-ms-desoto-pdf.ts,
// nationwide-ms-rankin-pdf.ts). The source app puts these same types in
// app/lib/nationwide-ms-desoto-pdf.ts and has the other two PDF parsers
// import them from there; this repo factors them into their own module
// instead so none of the three parser files depends on another.
//
// `PositionedPdfTextPage` is deliberately just a data structure -- an array
// of words with an x0/x1/y position, one page at a time -- not PDF bytes.
// Every parser in this slice takes this pre-extracted shape as input, never
// a PDF file, so none of them needs a PDF-parsing library. Turning real PDF
// bytes into this shape (the source's `extractPositionedPdfTextPages`, which
// dynamically imports `pdfjs-dist`) is deliberately NOT ported here: this
// repo's package.json has no PDF-text-extraction dependency, and adding one
// requires owner sign-off per this slice's brief. Each PDF adapter's
// top-level `parse...Pdf` function instead takes an injected
// `extractPages(bytes: Uint8Array) => Promise<PositionedPdfTextPage[]>`
// with no default, so it is structurally incapable of extracting real PDF
// bytes on its own -- the same "injected dependency, no default
// implementation anywhere in this repo" pattern Slice 2 used for the health
// delivery sink and the Supabase artifact store's storage bucket.
export type PositionedPdfTextWord = {
  text: string;
  x0: number;
  x1: number;
  y: number;
};

export type PositionedPdfTextPage = {
  pageNumber: number;
  width: number;
  height: number;
  words: PositionedPdfTextWord[];
};

export type ExtractPositionedPdfTextPages = (
  pdfBytes: Uint8Array,
) => Promise<PositionedPdfTextPage[]>;

export type PositionedLine = {
  y: number;
  words: PositionedPdfTextWord[];
};

// Groups a page's words into visual lines by rounding their y-coordinate,
// the same tolerance-of-0.1 rounding the source's DeSoto/Rankin parsers use
// (St. Louis Sheriff instead groups by an exact 0.1-precision y string --
// see nationwide-st-louis-sheriff-pdf.ts's own `linesFor`).
export function positionedLinesFor(page: PositionedPdfTextPage): PositionedLine[] {
  const lines = new Map<number, PositionedPdfTextWord[]>();
  for (const word of page.words) {
    if (!word.text.trim()) continue;
    if (![word.x0, word.x1, word.y].every(Number.isFinite) || word.x1 < word.x0) {
      throw new Error(`PDF page ${page.pageNumber} contains invalid text coordinates`);
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

export function positionedLineText(words: PositionedPdfTextWord[]) {
  return [...words]
    .sort((left, right) => left.x0 - right.x0)
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordsInXRange(words: PositionedPdfTextWord[], start: number, end: number) {
  return words.filter((word) => word.x0 >= start - 0.75 && word.x0 < end - 0.75);
}

export async function sha256PdfBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function hasPdfSignature(bytes: Uint8Array) {
  return (
    bytes instanceof Uint8Array &&
    bytes.byteLength >= 8 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
