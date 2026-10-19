// The dossier build/refresh pipeline, ported from property-intelligence-app's
// app/lib/property-repository.ts and refactored from Cloudflare D1 onto
// Supabase (20260924190000_property_intelligence_dossier.sql).
//
// This is what turns the City of St. Louis adapters in city-sources.ts into a
// stored, provenance-carrying dossier that property-analysis.ts and
// property-memory.ts read. Without it those modules had no producer.
//
// Behavior preserved from the source, deliberately:
//
//   * A record is only ever adopted onto a parcel when the source returned the
//     exact 11-digit ASR parcel ID that was requested. Anything else goes to
//     the quarantine table with its reason, rather than being dropped or
//     attached to the wrong parcel.
//   * A source that returns zero records still writes a completed sync run, so
//     "nothing found" is recorded as source coverage and never presented as
//     proof that nothing ever happened.
//   * One failing source does not fail the refresh; its run row records the
//     error and the other sources still persist.
//   * Refresh is driven by the same six-hour freshness policy as the source
//     (ingestion-policy.ts), plus a schema-version floor so an older dossier
//     shape is always rebuilt rather than served stale.
//
// The Supabase client is a parameter with no module-scope default, so nothing
// here can reach a database on import; callers use `withPropertyDossierClient`
// (below) to supply the service-role client lazily, matching
// report-vault.server.ts.
import type { PropertyDossier } from "./dossier-types.ts";
import { intelligenceFreshness, intelligenceNeedsRefresh } from "./ingestion-policy.ts";
import {
  CITY_SOURCES,
  fetchParcelIntelligence,
  type NormalizedCityRecord,
  type SourceSyncResult,
} from "./city-sources.ts";

const PARCEL_PATTERN = /^\d{11}$/;

const DISCLAIMER =
  "City records are due-diligence evidence, not a title opinion, title commitment, or proof that permitted work was completed.";

export const DOSSIER_SCHEMA_VERSION = 2;

export function assertParcelId(value: string) {
  const parcelId = value.trim();
  if (!PARCEL_PATTERN.test(parcelId)) {
    throw new Error("St. Louis ASR parcel ID must contain exactly 11 digits.");
  }
  return parcelId;
}

export function dossierNeedsRefresh(dossier: PropertyDossier, now = Date.now()) {
  return (
    Number(dossier.property?.intelligenceSchemaVersion ?? 0) < DOSSIER_SCHEMA_VERSION ||
    intelligenceNeedsRefresh(dossier.property?.lastIntelligenceSyncAt, now)
  );
}

export function titleEvidence(hasParcelIdentity: boolean): PropertyDossier["titleEvidence"] {
  return [
    {
      key: "parcel",
      label: "Parcel identity",
      status: hasParcelIdentity ? "available" : "missing",
      detail: hasParcelIdentity
        ? "Matched by exact 11-digit ASR parcel ID."
        : "An exact ASR parcel ID is required.",
    },
    {
      key: "city-events",
      label: "City permit and inspection history",
      status: hasParcelIdentity ? "available" : "missing",
      detail:
        "Official records are stored with source provenance; zero results are kept as source coverage, not proof that nothing ever occurred.",
    },
    {
      key: "deeds",
      label: "Recorded deeds and legal description",
      status: "missing",
      detail: "Recorder of Deeds instruments are not connected in this release.",
    },
    {
      key: "encumbrances",
      label: "Liens, judgments, probate and municipal charges",
      status: "missing",
      detail: "Requires dedicated court, recorder, tax and title evidence.",
    },
    {
      key: "commitment",
      label: "Title commitment / legal review",
      status: "review",
      detail: "A title company or qualified attorney must determine insurability and exceptions.",
    },
  ];
}

export function freshnessFor(lastSyncedAt: string | null): PropertyDossier["freshness"] {
  return { mode: "automatic", ...intelligenceFreshness(lastSyncedAt) };
}

export function emptyDossier(): PropertyDossier {
  return {
    property: null,
    events: [],
    sources: [],
    unresolvedRecordCount: 0,
    freshness: {
      mode: "automatic",
      state: "not-ingested",
      lastSyncedAt: null,
      nextRefreshAt: null,
    },
    titleEvidence: titleEvidence(false),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Collapses the sync-run history to the latest run per source, preserving the
 * caller's ordering (the query returns newest first). The source app does the
 * same: a dossier reports each source's most recent outcome, not every attempt.
 */
export function latestSourceStatuses(runs: PropertyDossier["sources"]): PropertyDossier["sources"] {
  const latest = new Map<string, PropertyDossier["sources"][number]>();
  for (const run of runs) {
    if (!latest.has(run.sourceKey)) latest.set(run.sourceKey, run);
  }
  return [...latest.values()];
}

export function summarizeRecord(record: NormalizedCityRecord) {
  return (
    [
      record.description,
      record.status ? `Status: ${record.status}` : null,
      record.amount === null ? null : `Amount: $${record.amount.toLocaleString("en-US")}`,
    ]
      .filter(Boolean)
      .join(" · ") || null
  );
}

// A structurally minimal view of the Supabase client: only the builder methods
// this module actually uses, so a test can supply a fake without reconstructing
// the full client surface, and without `any`.
export type DossierRow = Record<string, unknown>;

export interface DossierQuery extends PromiseLike<{
  data: DossierRow[] | null;
  count?: number | null;
}> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): DossierQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DossierQuery;
  insert(values: unknown): DossierQuery;
  update(values: unknown): DossierQuery;
  eq(column: string, value: unknown): DossierQuery;
  is(column: string, value: unknown): DossierQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): DossierQuery;
  maybeSingle(): Promise<{ data: DossierRow | null }>;
  single(): Promise<{ data: DossierRow | null }>;
}

export type DossierDatabase = {
  from(table: string): DossierQuery;
};

function text(row: DossierRow | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function numberOrNull(row: DossierRow | undefined, key: string): number | null {
  const value = row?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nested(row: DossierRow, key: string): DossierRow | undefined {
  const value = row[key];
  // PostgREST returns an embedded !inner relation as an object, or as a
  // one-element array depending on the relationship shape.
  if (Array.isArray(value)) return value[0] as DossierRow | undefined;
  return value && typeof value === "object" ? (value as DossierRow) : undefined;
}

type SyncInput = {
  parcelId: string;
  address: string | null;
  handle: string | null;
  userId: string | null;
};

export async function getPropertyDossier(
  database: DossierDatabase,
  parcelIdInput: string,
): Promise<PropertyDossier> {
  const parcelId = assertParcelId(parcelIdInput);
  const { data: parcel } = await database
    .from("property_intel_parcels")
    .select(
      "id, asr_parcel_id, handle, current_address, match_status, last_intelligence_sync_at, updated_at, intelligence_schema_version",
    )
    .eq("asr_parcel_id", parcelId)
    .maybeSingle();

  if (!parcel) return emptyDossier();

  const [eventsResult, runsResult, unmatchedResult] = await Promise.all([
    database
      .from("property_intel_events")
      .select(
        "id, event_type, occurred_at, recorded_at, title, summary, actor_name, verification_status, property_intel_source_records!inner(source_key, status, amount, source_url)",
      )
      .eq("parcel_id", parcel["id"])
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .order("recorded_at", { ascending: false }),
    database
      .from("property_intel_sync_runs")
      .select("source_key, status, records_seen, unmatched_count, completed_at, error")
      .eq("parcel_id", parcel["id"])
      .order("started_at", { ascending: false }),
    database
      .from("property_intel_unmatched_records")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("supplied_parcel_id", parcelId),
  ]);

  const events: PropertyDossier["events"] = (eventsResult.data ?? []).map((row) => {
    const record = nested(row, "property_intel_source_records");
    return {
      id: String(row["id"]),
      sourceKey: text(record, "source_key") ?? "",
      eventType: text(row, "event_type") ?? "",
      occurredAt: text(row, "occurred_at"),
      recordedAt: text(row, "recorded_at") ?? "",
      title: text(row, "title") ?? "",
      summary: text(row, "summary"),
      actorName: text(row, "actor_name"),
      status: text(record, "status"),
      amount: numberOrNull(record, "amount"),
      sourceUrl: text(record, "source_url") ?? "",
      verificationStatus: text(row, "verification_status") ?? "",
    };
  });

  const runs: PropertyDossier["sources"] = (runsResult.data ?? []).map((row) => ({
    sourceKey: text(row, "source_key") ?? "",
    status: text(row, "status") ?? "",
    recordsSeen: numberOrNull(row, "records_seen") ?? 0,
    unmatchedCount: numberOrNull(row, "unmatched_count") ?? 0,
    completedAt: text(row, "completed_at"),
    error: text(row, "error"),
  }));

  return {
    property: {
      id: String(parcel["id"]),
      asrParcelId: text(parcel, "asr_parcel_id") ?? parcelId,
      handle: text(parcel, "handle"),
      currentAddress: text(parcel, "current_address"),
      matchStatus: text(parcel, "match_status") ?? "parcel-id-verified",
      lastIntelligenceSyncAt: text(parcel, "last_intelligence_sync_at"),
      updatedAt: text(parcel, "updated_at") ?? "",
      intelligenceSchemaVersion: numberOrNull(parcel, "intelligence_schema_version") ?? 0,
    },
    events,
    sources: latestSourceStatuses(runs),
    unresolvedRecordCount: unmatchedResult.count ?? 0,
    freshness: freshnessFor(text(parcel, "last_intelligence_sync_at")),
    titleEvidence: titleEvidence(true),
    disclaimer: DISCLAIMER,
  };
}

async function persistSourceResult(
  database: DossierDatabase,
  parcelRowId: string,
  userId: string | null,
  startedAt: string,
  result: SourceSyncResult,
) {
  const completedAt = new Date().toISOString();

  await database.from("property_intel_sync_runs").insert({
    parcel_id: parcelRowId,
    source_key: result.source.key,
    started_at: startedAt,
    completed_at: completedAt,
    status: result.status,
    records_seen: result.records.length + result.unmatched.length,
    records_upserted: result.records.length,
    unmatched_count: result.unmatched.length,
    error: result.error ?? null,
    initiated_by_user_id: userId,
  });

  for (const record of result.records) {
    const { data: stored } = await database
      .from("property_intel_source_records")
      .upsert(
        {
          parcel_id: parcelRowId,
          source_key: record.sourceKey,
          source_record_id: record.sourceRecordId,
          record_type: record.recordType,
          occurred_at: record.occurredAt,
          status: record.status,
          actor_name: record.actorName,
          contractor_name: record.contractorName,
          description: record.description,
          amount: record.amount,
          address: record.address,
          asr_parcel_id: record.asrParcelId,
          handle: record.handle,
          source_url: record.sourceUrl,
          raw_json: record.rawJson,
          last_seen_at: completedAt,
        },
        { onConflict: "source_key,source_record_id" },
      )
      .select("id")
      .single();

    if (!stored) continue;

    await database.from("property_intel_events").upsert(
      {
        parcel_id: parcelRowId,
        source_record_id: stored["id"],
        event_type: record.recordType,
        occurred_at: record.occurredAt,
        title: record.sourceLabel,
        summary: summarizeRecord(record),
        actor_name: record.contractorName ?? record.actorName,
      },
      { onConflict: "source_record_id" },
    );
  }

  for (const record of result.unmatched) {
    await database.from("property_intel_unmatched_records").upsert(
      {
        source_key: result.source.key,
        source_record_id: record.sourceRecordId,
        supplied_parcel_id: record.suppliedParcelId,
        address: record.address,
        reason: "returned parcel ID did not equal the requested ASR parcel ID",
        raw_json: record.rawJson,
      },
      { onConflict: "source_key,source_record_id" },
    );
  }
}

export async function syncParcel(
  database: DossierDatabase,
  input: SyncInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PropertyDossier> {
  const parcelId = assertParcelId(input.parcelId);
  const address = input.address?.replace(/\s+/g, " ").trim() || null;
  const handle = input.handle?.trim() || null;

  const { data: parcel } = await database
    .from("property_intel_parcels")
    .upsert(
      {
        asr_parcel_id: parcelId,
        ...(address === null ? {} : { current_address: address }),
        ...(handle === null ? {} : { handle }),
        match_status: "parcel-id-verified",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "asr_parcel_id" },
    )
    .select("id")
    .single();

  if (!parcel) throw new Error("The Accountabul property record could not be created.");

  const startedAt = new Date().toISOString();
  const results = await fetchParcelIntelligence(parcelId, CITY_SOURCES, fetchImpl);
  for (const result of results) {
    await persistSourceResult(database, String(parcel["id"]), input.userId, startedAt, result);
  }

  await database
    .from("property_intel_parcels")
    .update({
      last_intelligence_sync_at: new Date().toISOString(),
      intelligence_schema_version: DOSSIER_SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parcel["id"]);

  return getPropertyDossier(database, parcelId);
}

export async function getOrRefreshPropertyDossier(
  database: DossierDatabase,
  input: SyncInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PropertyDossier> {
  const dossier = await getPropertyDossier(database, input.parcelId);
  return dossierNeedsRefresh(dossier) ? syncParcel(database, input, fetchImpl) : dossier;
}

/**
 * Supplies the service-role client lazily, so importing this module never
 * reads a credential -- the same pattern report-vault.server.ts uses.
 */
export async function withPropertyDossierClient<Result>(
  callback: (database: DossierDatabase) => Promise<Result>,
): Promise<Result> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return callback(supabaseAdmin as unknown as DossierDatabase);
}

export type AcquisitionIngestSummary = {
  recordsSeen: number;
  parcelsTouched: number;
  quarantined: number;
  skipped: number;
};

/**
 * Ingests published acquisition-inventory records (LRA / LCRA / tax auction)
 * onto their canonical parcels, ported from property-intelligence-app's
 * ingestAcquisitionRecords.
 *
 * Identity discipline, carried over unchanged: a record is only attached to a
 * parcel when it publishes a valid 11-digit ASR parcel ID. A tax-auction row
 * without one is QUARANTINED rather than dropped -- an auction lot that cannot
 * be resolved to a parcel is exactly the kind of thing an operator needs to
 * see -- while a non-auction row without one is skipped, since those sources
 * routinely publish rows that are not parcel-scoped at all.
 *
 * The published address is also recorded as a parcel alias, so a later lookup
 * by that address resolves to this parcel instead of minting a second identity
 * for the same property.
 */
export async function ingestAcquisitionRecords(
  database: DossierDatabase,
  records: Array<{
    source: string;
    recordNumber: string;
    parcelId: string | null;
    address: string;
    status: string;
    owner: string | null;
    description: string | null;
    price: number | null;
    priceLabel: string;
    sourceUrl: string;
  }>,
): Promise<AcquisitionIngestSummary> {
  let parcelsTouched = 0;
  let quarantined = 0;
  let skipped = 0;

  for (const record of records) {
    if (!record.parcelId || !PARCEL_PATTERN.test(record.parcelId)) {
      if (record.source === "Tax auction") {
        await database.from("property_intel_unmatched_records").upsert(
          {
            source_key: "tax_auction",
            source_record_id: record.recordNumber,
            supplied_parcel_id: null,
            address: record.address,
            reason: "published auction row has no 11-digit ASR parcel ID",
            raw_json: record,
          },
          { onConflict: "source_key,source_record_id" },
        );
        quarantined += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const sourceKey = record.source.toLowerCase().replace(/\s+/g, "_");
    const { data: parcel } = await database
      .from("property_intel_parcels")
      .upsert(
        {
          asr_parcel_id: record.parcelId,
          current_address: record.address,
          match_status: "parcel-id-verified",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "asr_parcel_id" },
      )
      .select("id")
      .single();

    if (!parcel) continue;
    parcelsTouched += 1;

    await database.from("property_intel_parcel_aliases").upsert(
      {
        parcel_id: parcel["id"],
        alias_type: "address",
        alias_value: record.address,
        source_key: sourceKey,
        confidence: 1,
      },
      { onConflict: "parcel_id,alias_type,alias_value" },
    );

    const { data: stored } = await database
      .from("property_intel_source_records")
      .upsert(
        {
          parcel_id: parcel["id"],
          source_key: sourceKey,
          source_record_id: record.recordNumber,
          record_type: `${record.source} acquisition record`,
          status: record.status,
          actor_name: record.owner,
          description: record.description,
          amount: record.price,
          address: record.address,
          asr_parcel_id: record.parcelId,
          source_url: record.sourceUrl,
          raw_json: record,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "source_key,source_record_id" },
      )
      .select("id")
      .single();

    if (!stored) continue;

    await database.from("property_intel_events").upsert(
      {
        parcel_id: parcel["id"],
        source_record_id: stored["id"],
        // The label the UI renders for this comes from propertyActivityLabel,
        // which maps the source key to the publishing agency (LRA/LCRA).
        event_type: "acquisition_inventory",
        title: `${record.source} acquisition record`,
        summary:
          [
            record.status,
            record.price === null
              ? null
              : `${record.priceLabel}: $${record.price.toLocaleString("en-US")}`,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        actor_name: record.owner,
      },
      { onConflict: "source_record_id" },
    );
  }

  return { recordsSeen: records.length, parcelsTouched, quarantined, skipped };
}
