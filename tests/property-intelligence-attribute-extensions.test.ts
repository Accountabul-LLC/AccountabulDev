// Slice 4/5 gap close (Gap 1: public attribute visibility subsystem).
// Exercises persistExtensions / publicAttributesForEntity /
// refreshAuctionLotSearchableAttributes against a hand-written, in-memory
// fake PostgresTransactionHost modeling property_core.attribute_definitions /
// entity_attributes, property_ingest.attribute_visibility_decisions, and
// property_api.auction_lot_search (the tables
// 20260924180000_property_intelligence_attribute_governance.sql adds, plus
// the pre-existing auction_lot_search table). Never a network connection,
// never a real or embedded Postgres.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  persistExtensions,
  publicAttributesForEntity,
  refreshAuctionLotSearchableAttributes,
} from "../src/lib/property-intelligence/nationwide-attribute-extensions.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";
import type { NormalizedIntakeBundle } from "../src/lib/property-intelligence/nationwide-property-intake-types.ts";

const AUCTION_LOT_ID = randomUUID();
const SOURCE_RECORD_ID = randomUUID();

type AttributeDefinitionRow = {
  id: string;
  attribute_key: string;
  version: number;
  entity_scope: string;
  data_type: string;
  unit: string | null;
  meaning: string;
  source_family: string;
  search_visibility: "private" | "public_search";
  active: boolean;
};

type EntityAttributeRow = {
  entity_type: string;
  entity_id: string;
  attribute_definition_id: string;
  value_text: string | null;
  value_numeric: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  source_record_id: string;
  verification_status: string;
  observed_at: string;
};

type VisibilityDecisionRow = {
  attribute_definition_id: string;
  search_visibility: "private" | "public_search";
  active: boolean;
};

class FakeAttributeExtensionsDatabase implements PostgresTransactionHost {
  attributeDefinitions: AttributeDefinitionRow[] = [];
  entityAttributes: EntityAttributeRow[] = [];
  visibilityDecisions: VisibilityDecisionRow[] = [];
  auctionLotSearch: Array<Record<string, unknown>> = [
    {
      auction_lot_id: AUCTION_LOT_ID,
      source_record_id: SOURCE_RECORD_ID,
      state_code: "MS",
      county_name: "Rankin",
      county_fips: "28121",
      event_label: "Rankin County 2026 delinquent tax land sale",
      sale_mechanism: "redeemable_tax_deed",
      lifecycle_state: "advertised",
      published_identifier_text: "PPIN-1",
      source_lot_key: "lot-1",
      published_address_text: null,
      published_owner_text: "Jane Owner",
      legal_description: "LOT 1 BLOCK A",
      searchable_attributes: {},
      search_text: "",
    },
  ];

  // Directly authorizes an attribute as 'public_search' for tests that don't
  // need to exercise the full review workflow (covered in
  // nationwide-attribute-visibility.test.ts).
  authorizePublicSearch(attributeKey: string) {
    const definition = this.attributeDefinitions.find((row) => row.attribute_key === attributeKey);
    if (!definition) throw new Error(`no attribute definition for ${attributeKey}`);
    definition.search_visibility = "public_search";
    this.visibilityDecisions.push({
      attribute_definition_id: definition.id,
      search_visibility: "public_search",
      active: true,
    });
  }

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("insert into property_core.attribute_definitions")) {
          const [attributeKey, entityScope, dataType, unit, meaning, sourceFamily] = params as [
            string,
            string,
            string,
            string | null,
            string,
            string,
          ];
          let row = this.attributeDefinitions.find(
            (d) => d.attribute_key === attributeKey && d.version === 1,
          );
          if (!row) {
            row = {
              id: randomUUID(),
              attribute_key: attributeKey,
              version: 1,
              entity_scope: entityScope,
              data_type: dataType,
              unit,
              meaning,
              source_family: sourceFamily,
              search_visibility: "private",
              active: true,
            };
            this.attributeDefinitions.push(row);
          }
          return { rows: [row] as unknown as Row[] };
        }

        if (n.startsWith("insert into property_core.entity_attributes")) {
          const [
            entityType,
            entityId,
            attributeDefinitionId,
            valueText,
            valueNumeric,
            valueBoolean,
            valueDate,
            sourceRecordId,
            verificationStatus,
            observedAt,
          ] = params as [
            string,
            string,
            string,
            string | null,
            number | null,
            boolean | null,
            string | null,
            string,
            string,
            string,
          ];
          const existingIndex = this.entityAttributes.findIndex(
            (row) =>
              row.entity_type === entityType &&
              row.entity_id === entityId &&
              row.attribute_definition_id === attributeDefinitionId &&
              row.source_record_id === sourceRecordId,
          );
          const row: EntityAttributeRow = {
            entity_type: entityType,
            entity_id: entityId,
            attribute_definition_id: attributeDefinitionId,
            value_text: valueText,
            value_numeric: valueNumeric,
            value_boolean: valueBoolean,
            value_date: valueDate,
            source_record_id: sourceRecordId,
            verification_status: verificationStatus,
            observed_at: observedAt,
          };
          if (existingIndex >= 0) this.entityAttributes[existingIndex] = row;
          else this.entityAttributes.push(row);
          return { rows: [] };
        }

        if (n.startsWith("select distinct on (definition.attribute_key)")) {
          const [entityType, entityId, sourceRecordId] = params as [string, string, string | null];
          const rows = this.entityAttributes
            .filter(
              (attribute) =>
                attribute.entity_type === entityType && attribute.entity_id === entityId,
            )
            .filter(
              (attribute) =>
                sourceRecordId === null || attribute.source_record_id === sourceRecordId,
            )
            .filter(
              (attribute) =>
                attribute.verification_status === "published" ||
                attribute.verification_status === "accountabul_verified",
            )
            .flatMap((attribute) => {
              const definition = this.attributeDefinitions.find(
                (d) => d.id === attribute.attribute_definition_id,
              );
              if (
                !definition ||
                !definition.active ||
                definition.search_visibility !== "public_search"
              )
                return [];
              if (definition.data_type === "json") return [];
              const visible = this.visibilityDecisions.some(
                (decision) =>
                  decision.attribute_definition_id === definition.id &&
                  decision.active &&
                  decision.search_visibility === "public_search",
              );
              if (!visible) return [];
              return [
                {
                  attribute_key: definition.attribute_key,
                  meaning: definition.meaning,
                  unit: definition.unit,
                  data_type: definition.data_type,
                  value_text: attribute.value_text,
                  value_numeric: attribute.value_numeric,
                  value_boolean: attribute.value_boolean,
                  value_date: attribute.value_date,
                },
              ];
            });
          return { rows: rows as unknown as Row[] };
        }

        if (n.startsWith("select source_record_id::text, state_code, county_name, county_fips")) {
          const [auctionLotId] = params as [string];
          const rows = this.auctionLotSearch.filter((row) => row.auction_lot_id === auctionLotId);
          return { rows: rows as unknown as Row[] };
        }

        if (n.startsWith("update property_api.auction_lot_search")) {
          const [auctionLotId, searchableAttributesJson, searchText] = params as [
            string,
            string,
            string,
          ];
          const row = this.auctionLotSearch.find((r) => r.auction_lot_id === auctionLotId);
          if (!row) return { rows: [] };
          row.searchable_attributes = JSON.parse(searchableAttributesJson);
          row.search_text = searchText;
          return { rows: [{ auction_lot_id: auctionLotId }] as unknown as Row[] };
        }

        throw new Error(`unexpected query in fake attribute-extensions database: ${n}`);
      },
    });
  }
}

function bundleWithExtensions(
  extensions: NormalizedIntakeBundle["extensions"],
): NormalizedIntakeBundle {
  return {
    sourceRecord: { sourceDocumentRetrievedAt: "2026-09-24T00:00:00.000Z" },
    extensions,
  } as unknown as NormalizedIntakeBundle;
}

test("an extension attribute is never queryable/exposed before a visibility decision exists", async () => {
  const database = new FakeAttributeExtensionsDatabase();
  const bundle = bundleWithExtensions([
    { key: "ms_section", value: "12", verificationStatus: "published" },
  ]);

  await database.transaction(async (transaction) => {
    await persistExtensions(transaction, bundle, SOURCE_RECORD_ID, AUCTION_LOT_ID);
  });

  // The definition and value are persisted...
  assert.equal(database.attributeDefinitions.length, 1);
  assert.equal(database.entityAttributes.length, 1);
  assert.equal(
    database.attributeDefinitions[0]?.search_visibility,
    "private",
    "new definitions default to private",
  );

  // ...but publicAttributesForEntity, the only path that ever feeds a
  // property_api.*.searchable_attributes projection, returns nothing.
  const attributesBeforeReview = await database.transaction((transaction) =>
    publicAttributesForEntity(transaction, "auction_lot", AUCTION_LOT_ID, SOURCE_RECORD_ID),
  );
  assert.deepEqual(attributesBeforeReview, {});

  // Once a visibility decision authorizes it, it becomes visible.
  database.authorizePublicSearch("ms_section");
  const attributesAfterReview = await database.transaction((transaction) =>
    publicAttributesForEntity(transaction, "auction_lot", AUCTION_LOT_ID, SOURCE_RECORD_ID),
  );
  assert.equal(attributesAfterReview["ms_section"]?.value, "12");
});

test("publicAttributesForEntity excludes an attribute whose definition is public_search but has no active visibility decision", async () => {
  const database = new FakeAttributeExtensionsDatabase();
  const bundle = bundleWithExtensions([
    { key: "ms_blighted", value: true, verificationStatus: "published" },
  ]);
  await database.transaction((transaction) =>
    persistExtensions(transaction, bundle, SOURCE_RECORD_ID, AUCTION_LOT_ID),
  );

  // Flip the definition's column directly without an accompanying active
  // decision row (simulating drift / a bug elsewhere) -- the join still
  // requires the decision, so it stays invisible.
  const definition = database.attributeDefinitions[0];
  assert.ok(definition);
  definition.search_visibility = "public_search";

  const attributes = await database.transaction((transaction) =>
    publicAttributesForEntity(transaction, "auction_lot", AUCTION_LOT_ID, SOURCE_RECORD_ID),
  );
  assert.deepEqual(
    attributes,
    {},
    "definition alone is not enough -- an active decision is required too",
  );
});

test("refreshAuctionLotSearchableAttributes populates searchable_attributes once authorized, and leaves it empty before", async () => {
  const database = new FakeAttributeExtensionsDatabase();
  const bundle = bundleWithExtensions([
    { key: "subdivision", value: "Oak Ridge", verificationStatus: "published" },
  ]);
  await database.transaction((transaction) =>
    persistExtensions(transaction, bundle, SOURCE_RECORD_ID, AUCTION_LOT_ID),
  );

  const beforeReview = await database.transaction((transaction) =>
    refreshAuctionLotSearchableAttributes(transaction, AUCTION_LOT_ID),
  );
  assert.equal(beforeReview, true);
  assert.deepEqual(database.auctionLotSearch[0]?.searchable_attributes, {});
  assert.ok(!String(database.auctionLotSearch[0]?.search_text).includes("oak ridge"));

  database.authorizePublicSearch("subdivision");
  await database.transaction((transaction) =>
    refreshAuctionLotSearchableAttributes(transaction, AUCTION_LOT_ID),
  );
  const projection = database.auctionLotSearch[0];
  assert.ok(projection);
  const searchableAttributes = projection.searchable_attributes as Record<
    string,
    { value: unknown }
  >;
  assert.equal(searchableAttributes["subdivision"]?.value, "Oak Ridge");
  assert.ok(String(projection.search_text).includes("oak ridge"));
});
