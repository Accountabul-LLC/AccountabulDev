import { stableSha256 } from "./nationwide-fingerprint.ts";
import {
  assessNationwideSourceCandidateInTransaction,
  discoverNationwideSourceCandidateInTransaction,
  getNationwideSourceDiscoveryCoverageInTransaction,
  validateNationwideSourceCandidateAssessmentDraft,
  type NationwideSourceCandidateAssessmentDraft,
} from "./nationwide-source-discovery.ts";
import {
  validateNationwideJurisdictionManifest,
  type NationwideJurisdictionManifest,
} from "./nationwide-source-manifest.ts";
import type { PostgresTransactionHost } from "./nationwide-postgres-writer.ts";

export type NationwideSourceResearchCatalogEntry = {
  jurisdiction: NationwideJurisdictionManifest;
  candidateKey: string;
  discoveredBy: string;
  discoveredAt: string;
  assessment: NationwideSourceCandidateAssessmentDraft;
};

export type NationwideSourceResearchCatalog = {
  catalogKey: string;
  catalogVersion: number;
  preparedBy: string;
  preparedAt: string;
  entries: NationwideSourceResearchCatalogEntry[];
};

export type ImportNationwideSourceResearchCatalogInput = {
  catalog: NationwideSourceResearchCatalog;
  importedBy: string;
  importedAt: string;
};

const keyPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const maximumCatalogEntries = 10_000;
const catalogKeys = new Set([
  "catalogKey",
  "catalogVersion",
  "preparedBy",
  "preparedAt",
  "entries",
]);
const catalogEntryKeys = new Set([
  "jurisdiction",
  "candidateKey",
  "discoveredBy",
  "discoveredAt",
  "assessment",
]);
const jurisdictionKeys = new Set([
  "jurisdictionType",
  "name",
  "legalName",
  "stateName",
  "stateLegalName",
  "stateCode",
  "stateFips",
  "countyFips",
  "countyName",
  "countyLegalName",
  "placeFips",
  "gnisId",
  "timezone",
]);

function required(value: string, field: string, maximum = 2_048) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > maximum) {
    throw new Error(`${field} must be a trimmed nonblank string of at most ${maximum} characters`);
  }
  return value;
}

function key(value: string, field: string) {
  const normalized = required(value, field, 255);
  if (!keyPattern.test(normalized)) {
    throw new Error(`${field} must contain lowercase letters, numbers, and single underscores`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function record(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, field: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${field} contains unknown field ${unknown.sort()[0]}`);
  }
}

function jurisdictionIdentity(jurisdiction: NationwideJurisdictionManifest) {
  if (jurisdiction.jurisdictionType === "state") return `state:${jurisdiction.stateFips}`;
  if (jurisdiction.jurisdictionType === "county_equivalent")
    return `county:${jurisdiction.countyFips}`;
  if (jurisdiction.jurisdictionType === "municipality") {
    return `municipality:${jurisdiction.stateFips}:${jurisdiction.placeFips}`;
  }
  if (jurisdiction.gnisId) return `${jurisdiction.jurisdictionType}:gnis:${jurisdiction.gnisId}`;
  return [
    jurisdiction.jurisdictionType,
    jurisdiction.stateFips,
    jurisdiction.countyFips ?? "statewide",
    jurisdiction.name.toLocaleLowerCase("en-US"),
  ].join(":");
}

export async function validateNationwideSourceResearchCatalogDocument(input: unknown) {
  const rawCatalog = record(input, "catalog");
  exactKeys(rawCatalog, catalogKeys, "catalog");
  const catalogKey = key(rawCatalog["catalogKey"] as string, "catalog.catalogKey");
  const catalogVersion = positiveInteger(
    rawCatalog["catalogVersion"] as number,
    "catalog.catalogVersion",
  );
  const preparedBy = required(rawCatalog["preparedBy"] as string, "catalog.preparedBy", 255);
  const preparedAt = canonicalUtc(rawCatalog["preparedAt"] as string, "catalog.preparedAt");
  if (
    !Array.isArray(rawCatalog["entries"]) ||
    rawCatalog["entries"].length < 1 ||
    rawCatalog["entries"].length > maximumCatalogEntries
  ) {
    throw new Error(`catalog.entries must contain between 1 and ${maximumCatalogEntries} entries`);
  }
  const identities = new Set<string>();
  const entries = rawCatalog["entries"].map((rawEntry, index) => {
    const entry = record(rawEntry, `catalog.entries[${index}]`);
    exactKeys(entry, catalogEntryKeys, `catalog.entries[${index}]`);
    const rawJurisdiction = record(entry["jurisdiction"], `catalog.entries[${index}].jurisdiction`);
    exactKeys(rawJurisdiction, jurisdictionKeys, `catalog.entries[${index}].jurisdiction`);
    const jurisdiction = validateNationwideJurisdictionManifest(
      rawJurisdiction as NationwideJurisdictionManifest,
    );
    const candidateKey = key(
      entry["candidateKey"] as string,
      `catalog.entries[${index}].candidateKey`,
    );
    const discoveredBy = required(
      entry["discoveredBy"] as string,
      `catalog.entries[${index}].discoveredBy`,
      255,
    );
    const discoveredAt = canonicalUtc(
      entry["discoveredAt"] as string,
      `catalog.entries[${index}].discoveredAt`,
    );
    const assessment = validateNationwideSourceCandidateAssessmentDraft(entry["assessment"]);
    if (discoveredAt > preparedAt) {
      throw new Error(`catalog.entries[${index}].discoveredAt cannot follow catalog.preparedAt`);
    }
    if (assessment.assessedAt < discoveredAt || assessment.assessedAt > preparedAt) {
      throw new Error(
        `catalog.entries[${index}].assessedAt must be between discovery and catalog preparation`,
      );
    }
    const identity = `${jurisdictionIdentity(jurisdiction)}:${candidateKey}`;
    if (identities.has(identity)) {
      throw new Error(`catalog contains duplicate candidate ${candidateKey} in one jurisdiction`);
    }
    identities.add(identity);
    return { jurisdiction, candidateKey, discoveredBy, discoveredAt, assessment };
  });
  const catalog = { catalogKey, catalogVersion, preparedBy, preparedAt, entries };
  const entryFingerprints = await Promise.all(entries.map((entry) => stableSha256(entry)));
  const catalogFingerprint = await stableSha256(catalog);
  return { catalog, catalogFingerprint, entryFingerprints };
}

export async function validateNationwideSourceResearchCatalog(input: unknown) {
  const root = record(input, "source research catalog import");
  exactKeys(
    root,
    new Set(["catalog", "importedBy", "importedAt"]),
    "source research catalog import",
  );
  const validatedCatalog = await validateNationwideSourceResearchCatalogDocument(root["catalog"]);
  const importedBy = required(root["importedBy"] as string, "importedBy", 255);
  const importedAt = canonicalUtc(root["importedAt"] as string, "importedAt");
  if (importedAt < validatedCatalog.catalog.preparedAt) {
    throw new Error("importedAt cannot precede catalog.preparedAt");
  }
  return { ...validatedCatalog, importedBy, importedAt };
}

export async function importNationwideSourceResearchCatalog(
  database: PostgresTransactionHost,
  input: ImportNationwideSourceResearchCatalogInput,
) {
  const normalized = await validateNationwideSourceResearchCatalog(input);
  return database.transaction(async (transaction) => {
    const inserted = await transaction.query<{ id: string }>(
      `
      insert into property_ingest.source_research_catalog_imports (
        catalog_key, catalog_version, catalog_fingerprint, prepared_by,
        prepared_at, entry_count, imported_by, imported_at
      ) values ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::timestamptz)
      on conflict (catalog_key, catalog_version) do nothing
      returning id
    `,
      [
        normalized.catalog.catalogKey,
        normalized.catalog.catalogVersion,
        normalized.catalogFingerprint,
        normalized.catalog.preparedBy,
        normalized.catalog.preparedAt,
        normalized.catalog.entries.length,
        normalized.importedBy,
        normalized.importedAt,
      ],
    );
    if (inserted.rows.length === 0) {
      const existing = await transaction.query<{
        id: string;
        catalog_fingerprint: string;
        entry_count: number;
      }>(
        `
        select id, catalog_fingerprint, entry_count
        from property_ingest.source_research_catalog_imports
        where catalog_key = $1 and catalog_version = $2
      `,
        [normalized.catalog.catalogKey, normalized.catalog.catalogVersion],
      );
      const catalogImport = existing.rows[0];
      if (
        !catalogImport ||
        catalogImport.catalog_fingerprint !== normalized.catalogFingerprint ||
        Number(catalogImport.entry_count) !== normalized.catalog.entries.length
      ) {
        throw new Error("source research catalog version is immutable");
      }
      const entryRows = await transaction.query<{
        entry_index: number;
        candidate_id: string;
        assessment_id: string;
        entry_fingerprint: string;
      }>(
        `
        select entry_index, candidate_id, assessment_id, entry_fingerprint
        from property_ingest.source_research_catalog_entries
        where catalog_import_id = $1
        order by entry_index
      `,
        [catalogImport.id],
      );
      if (
        entryRows.rows.length !== normalized.catalog.entries.length ||
        entryRows.rows.some(
          (row, index) =>
            Number(row.entry_index) !== index ||
            row.entry_fingerprint !== normalized.entryFingerprints[index],
        )
      ) {
        throw new Error(
          "stored source research catalog entries do not match their immutable catalog",
        );
      }
      return {
        catalogImportId: catalogImport.id,
        catalogFingerprint: normalized.catalogFingerprint,
        replayed: true,
        createdCandidateCount: 0,
        createdAssessmentCount: 0,
        candidates: entryRows.rows.map((row, index) => {
          // entryRows is index-aligned with the catalog by the length and
          // fingerprint check above; this guard is for noUncheckedIndexedAccess
          // and repeats that check's failure.
          const entry = normalized.catalog.entries[index];
          if (entry === undefined) {
            throw new Error(
              "stored source research catalog entries do not match their immutable catalog",
            );
          }
          return {
            candidateKey: entry.candidateKey,
            candidateId: row.candidate_id,
            assessmentId: row.assessment_id,
            candidateReplayed: true,
            assessmentReplayed: true,
          };
        }),
        coverage: await getNationwideSourceDiscoveryCoverageInTransaction(transaction),
      };
    }

    const insertedImport = inserted.rows[0];
    if (insertedImport === undefined) {
      throw new Error("source research catalog import registration failed");
    }
    const catalogImportId = insertedImport.id;
    const candidates = [];
    for (const [index, entry] of normalized.catalog.entries.entries()) {
      const candidate = await discoverNationwideSourceCandidateInTransaction(transaction, {
        jurisdiction: entry.jurisdiction,
        candidateKey: entry.candidateKey,
        discoveredBy: entry.discoveredBy,
        discoveredAt: entry.discoveredAt,
      });
      const assessment = await assessNationwideSourceCandidateInTransaction(transaction, {
        candidateId: candidate.candidateId,
        ...entry.assessment,
      });
      await transaction.query(
        `
        insert into property_ingest.source_research_catalog_entries (
          catalog_import_id, entry_index, candidate_id, assessment_id, entry_fingerprint
        ) values ($1, $2, $3, $4, $5)
      `,
        [
          catalogImportId,
          index,
          candidate.candidateId,
          assessment.assessmentId,
          normalized.entryFingerprints[index],
        ],
      );
      candidates.push({
        candidateKey: entry.candidateKey,
        candidateId: candidate.candidateId,
        assessmentId: assessment.assessmentId,
        candidateReplayed: candidate.replayed,
        assessmentReplayed: assessment.replayed,
      });
    }
    return {
      catalogImportId,
      catalogFingerprint: normalized.catalogFingerprint,
      replayed: false,
      createdCandidateCount: candidates.filter((candidate) => !candidate.candidateReplayed).length,
      createdAssessmentCount: candidates.filter((candidate) => !candidate.assessmentReplayed)
        .length,
      candidates,
      coverage: await getNationwideSourceDiscoveryCoverageInTransaction(transaction),
    };
  });
}
