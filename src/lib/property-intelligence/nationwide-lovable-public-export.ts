// Slice 5 (final) of the nationwide multi-state ingestion port. Ported from
// property-intelligence-app's app/lib/nationwide-lovable-public-export.ts:
// "two stable complete reads become one archived deterministic export" --
// read a legacy table's public PostgREST endpoint to completion twice,
// require the two reads to be byte-for-byte identical (same row count, same
// row-set fingerprint, strictly ordered, no duplicate ids), and only then
// archive one canonical JSON envelope through an injected
// `ImmutableJsonArtifactStore`. A changed row between passes, a row count
// that drifts mid-pass, or duplicate/out-of-order ids all fail BEFORE
// anything is archived.
//
// Deviation from the source, required by this repo's AGENTS.md: the source
// hardcodes its own legacy Supabase project's ref as a literal constant --
// the one and only origin this function will ever read from. This port does
// NOT embed that literal, or any other real Supabase project reference,
// anywhere in this repo -- AGENTS.md is explicit
// that this project must never target a Lovable-bound project, named or
// not. Instead `LovablePublicExportConfig.approvedProjectRef` is an
// injected, no-default field: the caller states which single project
// reference this call is allowed to read from, and `approvedOrigin` below
// still fails closed exactly the way the source's hardcoded check did --
// `supabaseUrl` must resolve to `https://<approvedProjectRef>.supabase.co/`
// or the read is refused before any network access -- just without a real
// project identifier compiled into this repo. `fetchImpl` has no default
// (this repo's established convention -- see nationwide-st-louis-lra-arcgis.ts's
// header), so nothing calling this module reaches a live network unless a
// caller supplies one, and nothing in this repo does.
import type { ImmutableJsonArtifactStore } from "./nationwide-artifact-store.ts";
import { stableSerialize, stableSha256 } from "./nationwide-fingerprint.ts";
import type { SourceDocumentReference } from "./nationwide-property-intake-types.ts";
import type {
  LegacyLraPropertyRow,
  LegacyStLouisTaxSaleRow,
} from "./nationwide-legacy-backfill.ts";
import type { SnapshotArtifactEvidence } from "./nationwide-postgres-run-store.ts";

const PAGE_SIZE = 1_000;
const MAX_ROWS = 100_000;

export const LOVABLE_PUBLIC_EXPORT_TABLES = {
  lra_properties: {
    title: "Accountabul legacy public Data API export: LRA properties",
  },
  tax_sale_properties: {
    title: "Accountabul legacy public Data API export: tax-sale properties",
  },
} as const;

export type LovablePublicExportTable = keyof typeof LOVABLE_PUBLIC_EXPORT_TABLES;

type LovableRows = {
  lra_properties: LegacyLraPropertyRow;
  tax_sale_properties: LegacyStLouisTaxSaleRow;
};

export type StabilizedLovablePublicExport<Table extends LovablePublicExportTable> = {
  table: Table;
  rows: Array<{ rowNumber: number; row: LovableRows[Table] }>;
  reportedCount: number;
  stabilizationPasses: number;
  rowSetFingerprint: string;
  canonicalJson: string;
  document: SourceDocumentReference;
  sourceArtifact: SnapshotArtifactEvidence;
};

export type LovablePublicExportConfig = {
  supabaseUrl: string;
  anonKey: string;
  // No default, no hardcoded value anywhere in this repo -- see this file's
  // header. The read is refused unless `supabaseUrl` resolves to exactly
  // `https://<approvedProjectRef>.supabase.co/`.
  approvedProjectRef: string;
};

function canonicalClock(clock: () => string) {
  const value = clock();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error("Lovable export clock must return a canonical UTC ISO date-time");
  }
  return value;
}

function approvedOrigin(config: LovablePublicExportConfig) {
  const approvedProjectRef = config.approvedProjectRef.trim();
  if (!/^[a-z0-9]{10,32}$/.test(approvedProjectRef)) {
    throw new Error("Lovable public export requires a valid approvedProjectRef");
  }
  let url: URL;
  try {
    url = new URL(config.supabaseUrl);
  } catch {
    throw new Error("Lovable public export requires an absolute Supabase URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== `${approvedProjectRef}.supabase.co` ||
    url.pathname !== "/"
  ) {
    throw new Error("Lovable public export is restricted to the reviewed legacy Supabase project");
  }
  if (!config.anonKey.trim() || config.anonKey.length > 4_096) {
    throw new Error("Lovable public export requires a bounded public anonymous key");
  }
  return url.origin;
}

function contentRange(value: string | null, offset: number, returned: number) {
  if (returned === 0 && value === "*/0" && offset === 0) return { total: 0 };
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("Lovable public export response is missing an exact Content-Range");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (start !== offset || end !== offset + returned - 1 || total < returned || total > MAX_ROWS) {
    throw new Error("Lovable public export returned inconsistent range evidence");
  }
  return { total };
}

function rowId(row: Record<string, unknown>) {
  const value = String(row["id"] ?? "").trim();
  if (!value) throw new Error("Lovable public export rows require a stable id");
  return value;
}

async function fetchPage<Table extends LovablePublicExportTable>(input: {
  config: LovablePublicExportConfig;
  table: Table;
  offset: number;
  origin: string;
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`/rest/v1/${input.table}`, input.origin);
  url.searchParams.set("select", "*");
  url.searchParams.set("order", "id.asc");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(input.offset));
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: {
      apikey: input.config.anonKey,
      authorization: `Bearer ${input.config.anonKey}`,
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Lovable public export returned HTTP ${response.status} for ${input.table}`);
  }
  const body: unknown = await response.json();
  if (
    !Array.isArray(body) ||
    body.some((row) => row === null || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error(`Lovable public export returned invalid ${input.table} rows`);
  }
  const rows = body as LovableRows[Table][];
  return {
    rows,
    total: contentRange(response.headers.get("content-range"), input.offset, rows.length).total,
  };
}

async function fetchCompletePass<Table extends LovablePublicExportTable>(input: {
  config: LovablePublicExportConfig;
  table: Table;
  origin: string;
  fetchImpl: typeof fetch;
}) {
  const first = await fetchPage({ ...input, offset: 0 });
  const rows = [...first.rows];
  for (let offset = PAGE_SIZE; offset < first.total; offset += PAGE_SIZE) {
    const page = await fetchPage({ ...input, offset });
    if (page.total !== first.total) {
      throw new Error(`Lovable public export count changed during the ${input.table} pass`);
    }
    rows.push(...page.rows);
  }
  if (rows.length !== first.total) {
    throw new Error(
      `Lovable public export returned ${rows.length} of ${first.total} ${input.table} rows`,
    );
  }
  let priorId: string | null = null;
  for (const row of rows) {
    const currentId = rowId(row);
    if (priorId !== null && priorId >= currentId) {
      throw new Error(
        `Lovable public export ${input.table} ids are duplicated or not strictly ordered`,
      );
    }
    priorId = currentId;
  }
  return {
    rows,
    total: first.total,
    fingerprint: await stableSha256(rows),
  };
}

export async function captureStabilizedLovablePublicExport<
  Table extends LovablePublicExportTable,
>(input: {
  config: LovablePublicExportConfig;
  table: Table;
  artifactStore: ImmutableJsonArtifactStore;
  stabilizationPasses?: number;
  objectStoragePrefix?: string;
  // No default (this repo's established convention -- see this file's
  // header): a caller must inject a fetch implementation for this to reach
  // any network at all.
  fetchImpl: typeof fetch;
  now?: () => string;
}): Promise<StabilizedLovablePublicExport<Table>> {
  const origin = approvedOrigin(input.config);
  const passes = input.stabilizationPasses ?? 2;
  if (!Number.isInteger(passes) || passes < 2 || passes > 5) {
    throw new Error("Lovable public export requires between two and five stabilization passes");
  }
  const snapshots = [];
  for (let pass = 0; pass < passes; pass += 1) {
    snapshots.push(
      await fetchCompletePass({
        config: input.config,
        table: input.table,
        origin,
        fetchImpl: input.fetchImpl,
      }),
    );
  }
  const baseline = snapshots[0];
  if (!baseline) throw new Error("Lovable public export requires at least one stabilization pass");
  if (
    snapshots.some(
      (snapshot) =>
        snapshot.total !== baseline.total || snapshot.fingerprint !== baseline.fingerprint,
    )
  ) {
    throw new Error(`Lovable public export ${input.table} changed between complete reads`);
  }
  const envelope = {
    contract: "accountabul-lovable-public-export-v1",
    approvedProjectRef: input.config.approvedProjectRef,
    table: input.table,
    order: "id.asc",
    reportedCount: baseline.total,
    stabilizationPasses: passes,
    rowSetFingerprint: baseline.fingerprint,
    rows: baseline.rows,
  };
  const canonicalJson = stableSerialize(envelope);
  const sha256 = await stableSha256(envelope);
  const objectStoragePrefix = (input.objectStoragePrefix ?? "nationwide/lovable-public").replace(
    /^\/+|\/+$/g,
    "",
  );
  if (
    !objectStoragePrefix ||
    objectStoragePrefix.includes("..") ||
    objectStoragePrefix.includes(":")
  ) {
    throw new Error("Lovable public export object-storage prefix is invalid");
  }
  const objectStorageKey = `${objectStoragePrefix}/${input.table}/${sha256}.json`;
  await input.artifactStore.putCanonicalJson({
    objectStorageKey,
    canonicalJson,
    sha256,
    mimeType: "application/json",
  });
  const byteSize = new TextEncoder().encode(canonicalJson).byteLength;
  const retrievedAt = canonicalClock(input.now ?? (() => new Date().toISOString()));
  return {
    table: input.table,
    rows: baseline.rows.map((row, index) => ({ rowNumber: index + 1, row })),
    reportedCount: baseline.total,
    stabilizationPasses: passes,
    rowSetFingerprint: baseline.fingerprint,
    canonicalJson,
    document: {
      url: `${origin}/rest/v1/${input.table}`,
      title: LOVABLE_PUBLIC_EXPORT_TABLES[input.table].title,
      sha256,
      retrievedAt,
      publishedAt: null,
      objectStorageKey,
      mimeType: "application/json",
      byteSize,
    },
    sourceArtifact: {
      sha256,
      objectStorageKey,
      mimeType: "application/json",
      byteSize,
    },
  };
}
