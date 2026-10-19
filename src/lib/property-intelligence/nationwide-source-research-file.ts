import type { PostgresTransactionHost } from "./nationwide-postgres-writer.ts";
import {
  importNationwideSourceResearchCatalog,
  validateNationwideSourceResearchCatalogDocument,
} from "./nationwide-source-research-catalog.ts";

export const NATIONWIDE_SOURCE_RESEARCH_FILE_MAXIMUM_BYTES = 5 * 1024 * 1024;

const requiredCatalogRelations = [
  "property_core.jurisdictions",
  "property_ingest.source_candidates",
  "property_ingest.source_candidate_assessments",
  "property_ingest.source_candidate_assessment_fields",
  "property_ingest.source_research_catalog_imports",
  "property_ingest.source_research_catalog_entries",
] as const;

function bytesFor(input: string | Uint8Array) {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

function decodeUtf8(input: Uint8Array) {
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    throw new Error("source research catalog files must be UTF-8 without a byte-order mark");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error("source research catalog files must contain valid UTF-8");
  }
}

export async function parseNationwideSourceResearchCatalogFile(input: string | Uint8Array) {
  const bytes = bytesFor(input);
  if (bytes.byteLength < 2 || bytes.byteLength > NATIONWIDE_SOURCE_RESEARCH_FILE_MAXIMUM_BYTES) {
    throw new Error(
      `source research catalog files must contain between 2 and ${NATIONWIDE_SOURCE_RESEARCH_FILE_MAXIMUM_BYTES} bytes`,
    );
  }
  const text = decodeUtf8(bytes);
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error("source research catalog files must contain one valid JSON document");
  }
  return validateNationwideSourceResearchCatalogDocument(document);
}

export async function assertNationwideSourceResearchCatalogSchemaReady(
  database: PostgresTransactionHost,
) {
  const result = await database.transaction((transaction) =>
    transaction.query<{
      relation_name: string;
      installed_name: string | null;
    }>(
      `
    select relation_name, to_regclass(relation_name)::text as installed_name
    from unnest($1::text[]) as required(relation_name)
    order by relation_name
  `,
      [[...requiredCatalogRelations]],
    ),
  );
  const installed = new Set(
    result.rows.filter((row) => row.installed_name !== null).map((row) => row.relation_name),
  );
  const missing = requiredCatalogRelations.filter((relation) => !installed.has(relation));
  if (missing.length > 0) {
    throw new Error(
      `target warehouse is not ready for source research catalogs; missing ${missing.join(", ")}`,
    );
  }
  return { requiredRelations: [...requiredCatalogRelations] };
}

export async function importNationwideSourceResearchCatalogFile(
  database: PostgresTransactionHost,
  input: string | Uint8Array,
  metadata: { importedBy: string; importedAt: string },
) {
  const parsed = await parseNationwideSourceResearchCatalogFile(input);
  await assertNationwideSourceResearchCatalogSchemaReady(database);
  return importNationwideSourceResearchCatalog(database, {
    catalog: parsed.catalog,
    importedBy: metadata.importedBy,
    importedAt: metadata.importedAt,
  });
}
