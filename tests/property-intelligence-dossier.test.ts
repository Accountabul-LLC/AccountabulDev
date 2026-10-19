// Contract for property-dossier.server.ts -- the dossier build/refresh
// pipeline ported from property-intelligence-app's app/lib/property-repository.ts
// and refactored from Cloudflare D1 onto Supabase
// (20260924190000_property_intelligence_dossier.sql).
//
// This is the producer the Property Analysis surface reads from, so what
// matters is the provenance discipline, not just that rows land:
//
//   * a record for a different parcel is quarantined, never adopted
//   * a source returning nothing still records a completed run, so "nothing
//     found" is source coverage rather than proof nothing happened
//   * one failing source does not lose the others
//   * refresh is driven by the six-hour policy and a schema-version floor
//
// Exercised against an in-memory fake of the Supabase query builder, the same
// approach as property-intelligence-source-registration.test.ts. No network,
// no real database: the fetch implementation is supplied by the test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  assertParcelId,
  dossierNeedsRefresh,
  emptyDossier,
  getOrRefreshPropertyDossier,
  getPropertyDossier,
  ingestAcquisitionRecords,
  latestSourceStatuses,
  summarizeRecord,
  syncParcel,
  type DossierDatabase,
  type DossierQuery,
  type DossierRow,
} from "../src/lib/property-intelligence/property-dossier.server.ts";
import { INTELLIGENCE_FRESHNESS_MS } from "../src/lib/property-intelligence/ingestion-policy.ts";

const PARCEL = "52939410000";

class FakeDossierDatabase implements DossierDatabase {
  tables: Record<string, DossierRow[]> = {
    property_intel_parcels: [],
    property_intel_source_records: [],
    property_intel_events: [],
    property_intel_sync_runs: [],
    property_intel_unmatched_records: [],
    property_intel_parcel_aliases: [],
  };

  from(table: string): DossierQuery {
    const rows = (this.tables[table] ??= []);
    const filters: Array<(row: DossierRow) => boolean> = [];
    let pending: DossierRow | null = null;
    let counting = false;
    let mode: "select" | "upsert" | "insert" | "update" = "select";
    let conflictKeys: string[] = [];
    let values: DossierRow = {};

    const matches = (row: DossierRow) => filters.every((predicate) => predicate(row));

    const apply = (): DossierRow | null => {
      if (mode === "insert") {
        const created = { id: randomUUID(), ...values };
        rows.push(created);
        return created;
      }
      if (mode === "upsert") {
        const existing = conflictKeys.length
          ? rows.find((row) => conflictKeys.every((key) => row[key] === values[key]))
          : undefined;
        if (existing) {
          Object.assign(existing, values);
          return existing;
        }
        const created = { id: randomUUID(), ...values };
        rows.push(created);
        return created;
      }
      if (mode === "update") {
        for (const row of rows.filter(matches)) Object.assign(row, values);
        return null;
      }
      return null;
    };

    const query: DossierQuery = {
      select(_columns: string, options?: { count?: "exact"; head?: boolean }) {
        counting = options?.count === "exact";
        if (mode !== "select") pending = apply();
        return query;
      },
      upsert(next: unknown, options?: { onConflict?: string }) {
        mode = "upsert";
        values = next as DossierRow;
        conflictKeys = options?.onConflict?.split(",").map((key) => key.trim()) ?? [];
        return query;
      },
      insert(next: unknown) {
        mode = "insert";
        values = next as DossierRow;
        pending = apply();
        return query;
      },
      update(next: unknown) {
        mode = "update";
        values = next as DossierRow;
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        if (mode === "update") apply();
        return query;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      order() {
        return query;
      },
      async maybeSingle() {
        return { data: pending ?? rows.find(matches) ?? null };
      },
      async single() {
        return { data: pending ?? rows.find(matches) ?? null };
      },
      then(resolve) {
        // Awaiting the builder executes the query in the real client, so a
        // write awaited without .select() must still apply here.
        if (mode !== "select" && pending === null) apply();
        const selected = rows.filter(matches);
        return Promise.resolve(
          counting ? { data: null, count: selected.length } : { data: selected },
        ).then(resolve);
      },
    };
    return query;
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("a parcel ID must be exactly eleven digits", () => {
  assert.equal(assertParcelId(" 52939410000 "), "52939410000");
  assert.throws(() => assertParcelId("5293941"), /exactly 11 digits/i);
  assert.throws(() => assertParcelId("5293941000A"), /exactly 11 digits/i);
});

test("an unknown parcel returns a not-ingested dossier, not an error", async () => {
  const database = new FakeDossierDatabase();
  const dossier = await getPropertyDossier(database, PARCEL);
  assert.equal(dossier.property, null);
  assert.equal(dossier.freshness.state, "not-ingested");
  assert.deepEqual(dossier.events, []);
  assert.equal(dossier.titleEvidence.find((item) => item.key === "parcel")?.status, "missing");
  assert.match(dossier.disclaimer, /not a title opinion/i);
});

test("an empty dossier never claims title evidence it does not have", () => {
  const dossier = emptyDossier();
  const commitment = dossier.titleEvidence.find((item) => item.key === "commitment");
  assert.equal(commitment?.status, "review");
  assert.equal(dossier.titleEvidence.find((item) => item.key === "deeds")?.status, "missing");
});

test("a sync stores matched records, their events, and per-source provenance", async () => {
  const database = new FakeDossierDatabase();
  const dossier = await syncParcel(
    database,
    { parcelId: PARCEL, address: "  4921   EMERSON AV ", handle: null, userId: null },
    (async () =>
      jsonResponse([
        {
          PermitID: 42,
          ProjectASRParcelID: PARCEL,
          ProjectAddress: "4921 EMERSON",
          PermitType: "Electrical",
          CurrentStatus: "Finaled",
          ProjectCost: 7400,
        },
      ])) as unknown as typeof fetch,
  );

  const parcel = database.tables["property_intel_parcels"]?.[0];
  assert.equal(parcel?.["asr_parcel_id"], PARCEL);
  assert.equal(parcel?.["current_address"], "4921 EMERSON AV", "address is whitespace-collapsed");
  assert.equal(parcel?.["intelligence_schema_version"], 2);

  assert.ok(
    (database.tables["property_intel_source_records"]?.length ?? 0) > 0,
    "matched records are stored",
  );
  assert.equal(
    database.tables["property_intel_sync_runs"]?.length,
    8,
    "every one of the eight city sources records a run, including empty ones",
  );
  assert.equal(dossier.property?.asrParcelId, PARCEL);
  assert.equal(dossier.freshness.state, "fresh");
});

test("a record for another parcel is quarantined and never adopted", async () => {
  const database = new FakeDossierDatabase();
  await syncParcel(
    database,
    { parcelId: PARCEL, address: null, handle: null, userId: null },
    (async () =>
      jsonResponse([
        { PermitID: 9, ProjectASRParcelID: "11111111111", ProjectAddress: "OTHER PARCEL" },
      ])) as unknown as typeof fetch,
  );

  const adopted = database.tables["property_intel_source_records"] ?? [];
  assert.equal(adopted.length, 0, "a mismatched record is never attached to the parcel");
  const quarantined = database.tables["property_intel_unmatched_records"] ?? [];
  assert.ok(quarantined.length > 0, "but it is kept, with a reason, for audit");
  assert.match(String(quarantined[0]?.["reason"]), /did not equal the requested ASR parcel ID/i);
});

test("a failing source is isolated and recorded rather than losing the refresh", async () => {
  const database = new FakeDossierDatabase();
  let call = 0;
  await syncParcel(
    database,
    { parcelId: PARCEL, address: null, handle: null, userId: null },
    (async () => {
      call += 1;
      if (call === 1) return new Response("down", { status: 503 });
      return jsonResponse([]);
    }) as unknown as typeof fetch,
  );

  const runs = database.tables["property_intel_sync_runs"] ?? [];
  assert.equal(runs.length, 8, "all sources still record a run");
  const failed = runs.filter((run) => run["status"] === "failed");
  assert.equal(failed.length, 1);
  assert.match(String(failed[0]?.["error"]), /503/);
});

test("refresh is driven by the six-hour policy and a schema-version floor", () => {
  const now = Date.parse("2026-09-24T18:00:00.000Z");
  const fresh = {
    ...emptyDossier(),
    property: {
      id: "row",
      asrParcelId: PARCEL,
      handle: null,
      currentAddress: null,
      matchStatus: "parcel-id-verified",
      lastIntelligenceSyncAt: new Date(now - 1000).toISOString(),
      updatedAt: new Date(now).toISOString(),
      intelligenceSchemaVersion: 2,
    },
  };
  assert.equal(dossierNeedsRefresh(fresh, now), false);

  const stale = {
    ...fresh,
    property: {
      ...fresh.property,
      lastIntelligenceSyncAt: new Date(now - INTELLIGENCE_FRESHNESS_MS).toISOString(),
    },
  };
  assert.equal(dossierNeedsRefresh(stale, now), true);

  const oldSchema = {
    ...fresh,
    property: { ...fresh.property, intelligenceSchemaVersion: 1 },
  };
  assert.equal(
    dossierNeedsRefresh(oldSchema, now),
    true,
    "an older dossier shape is rebuilt even when recently synced",
  );
});

test("getOrRefresh syncs an unknown parcel and serves a fresh one without refetching", async () => {
  const database = new FakeDossierDatabase();
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches += 1;
    return jsonResponse([]);
  }) as unknown as typeof fetch;
  const input = { parcelId: PARCEL, address: null, handle: null, userId: null };

  await getOrRefreshPropertyDossier(database, input, fetchImpl);
  const afterFirst = fetches;
  assert.ok(afterFirst > 0, "an unknown parcel is synced");

  await getOrRefreshPropertyDossier(database, input, fetchImpl);
  assert.equal(fetches, afterFirst, "a fresh dossier is served without refetching");
});

test("the dossier reports each source's latest run, not every attempt", () => {
  const collapsed = latestSourceStatuses([
    {
      sourceKey: "permits",
      status: "success",
      recordsSeen: 2,
      unmatchedCount: 0,
      completedAt: "2026-09-24T12:00:00.000Z",
      error: null,
    },
    {
      sourceKey: "permits",
      status: "failed",
      recordsSeen: 0,
      unmatchedCount: 0,
      completedAt: "2026-09-24T06:00:00.000Z",
      error: "503",
    },
    {
      sourceKey: "vacancy",
      status: "success",
      recordsSeen: 0,
      unmatchedCount: 0,
      completedAt: "2026-09-24T12:00:00.000Z",
      error: null,
    },
  ]);
  assert.deepEqual(
    collapsed.map((run) => [run.sourceKey, run.status]),
    [
      ["permits", "success"],
      ["vacancy", "success"],
    ],
  );
});

test("a record summary carries status and amount alongside the description", () => {
  assert.equal(
    summarizeRecord({
      description: "Service upgrade",
      status: "Finaled",
      amount: 7400,
    } as unknown as Parameters<typeof summarizeRecord>[0]),
    "Service upgrade · Status: Finaled · Amount: $7,400",
  );
  assert.equal(
    summarizeRecord({
      description: null,
      status: null,
      amount: null,
    } as unknown as Parameters<typeof summarizeRecord>[0]),
    null,
  );
});

function acquisitionRecord(overrides: Record<string, unknown> = {}) {
  return {
    source: "LRA",
    recordNumber: "LRA-1",
    parcelId: PARCEL,
    address: "4921 EMERSON AV",
    status: "Available",
    owner: "LAND REUTILIZATION AUTHORITY",
    description: "Vacant lot",
    price: 1200,
    priceLabel: "Asking price",
    sourceUrl: "https://www.stlouis-mo.gov/lra",
    ...overrides,
  } as Parameters<typeof ingestAcquisitionRecords>[1][number];
}

test("an acquisition record attaches to its parcel and records an address alias", async () => {
  const database = new FakeDossierDatabase();
  const summary = await ingestAcquisitionRecords(database, [acquisitionRecord()]);

  assert.equal(summary.recordsSeen, 1);
  assert.equal(summary.parcelsTouched, 1);
  assert.equal(summary.quarantined, 0);

  const alias = database.tables["property_intel_parcel_aliases"]?.[0];
  assert.equal(alias?.["alias_type"], "address");
  assert.equal(alias?.["alias_value"], "4921 EMERSON AV");
  assert.equal(alias?.["source_key"], "lra", "the asserting source is recorded with the alias");

  const event = database.tables["property_intel_events"]?.[0];
  assert.equal(event?.["event_type"], "acquisition_inventory");
  assert.match(String(event?.["summary"]), /Available · Asking price: \$1,200/);
});

test("a tax-auction row with no parcel ID is quarantined, not dropped", async () => {
  const database = new FakeDossierDatabase();
  const summary = await ingestAcquisitionRecords(database, [
    acquisitionRecord({ source: "Tax auction", parcelId: null, recordNumber: "SALE-9" }),
  ]);

  assert.equal(summary.quarantined, 1);
  assert.equal(summary.parcelsTouched, 0);
  const quarantined = database.tables["property_intel_unmatched_records"]?.[0];
  assert.equal(quarantined?.["source_key"], "tax_auction");
  assert.match(String(quarantined?.["reason"]), /no 11-digit ASR parcel ID/i);
});

test("a non-auction row with no parcel ID is skipped rather than quarantined", async () => {
  const database = new FakeDossierDatabase();
  const summary = await ingestAcquisitionRecords(database, [acquisitionRecord({ parcelId: null })]);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.quarantined, 0);
  assert.equal(database.tables["property_intel_unmatched_records"]?.length, 0);
});

test("re-ingesting the same record does not duplicate the parcel or its alias", async () => {
  const database = new FakeDossierDatabase();
  await ingestAcquisitionRecords(database, [acquisitionRecord()]);
  await ingestAcquisitionRecords(database, [acquisitionRecord({ status: "Sold" })]);

  assert.equal(database.tables["property_intel_parcels"]?.length, 1);
  assert.equal(database.tables["property_intel_parcel_aliases"]?.length, 1);
  assert.equal(database.tables["property_intel_source_records"]?.length, 1);
  assert.equal(
    database.tables["property_intel_source_records"]?.[0]?.["status"],
    "Sold",
    "the record is updated in place rather than duplicated",
  );
});
