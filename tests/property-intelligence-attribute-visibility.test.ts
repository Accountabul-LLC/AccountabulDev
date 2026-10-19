// Slice 4/5 gap close (Gap 1: public attribute visibility subsystem).
// Exercises reviewNationwideAttributeVisibility's decision-ledger workflow
// (versioning, replay, supersede, drift detection) against a hand-written,
// in-memory fake PostgresTransactionHost modeling
// property_core.attribute_definitions and
// property_ingest.attribute_visibility_decisions -- the tables
// 20260924180000_property_intelligence_attribute_governance.sql adds. Never
// a network connection, never a real or embedded Postgres. See
// property-intelligence-attribute-extensions.test.ts for the
// "never queryable before review" invariant against publicAttributesForEntity.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { reviewNationwideAttributeVisibility } from "../src/lib/property-intelligence/nationwide-attribute-visibility.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";

const ATTRIBUTE_DEFINITION_ID = randomUUID();
const REVIEWER_ID = randomUUID();

type DecisionRow = {
  id: string;
  attribute_definition_id: string;
  decision_version: number;
  search_visibility: "private" | "public_search";
  rationale: string;
  reviewed_by: string;
  reviewed_at: string;
  active: boolean;
};

class FakeAttributeVisibilityDatabase implements PostgresTransactionHost {
  definition = {
    id: ATTRIBUTE_DEFINITION_ID,
    attribute_key: "ms_section",
    data_type: "text",
    search_visibility: "private" as "private" | "public_search",
    active: true,
  };
  decisions: DecisionRow[] = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const n = sql.replace(/\s+/g, " ").trim();

        if (n.startsWith("select id::text, attribute_key, data_type, search_visibility, active")) {
          const [id] = params as [string];
          if (id !== this.definition.id) return { rows: [] };
          return { rows: [this.definition] as unknown as Row[] };
        }

        if (n.startsWith("select id::text, decision_version, search_visibility, rationale")) {
          const [attributeDefinitionId] = params as [string];
          const rows = this.decisions
            .filter((decision) => decision.attribute_definition_id === attributeDefinitionId)
            .sort((a, b) => b.decision_version - a.decision_version);
          return { rows: rows as unknown as Row[] };
        }

        if (n.startsWith("select count(distinct (entity_type, entity_id))::int as count")) {
          return { rows: [{ count: 0 }] as unknown as Row[] };
        }

        if (n.startsWith("update property_ingest.attribute_visibility_decisions")) {
          const [id, supersededAt] = params as [string, string];
          const decision = this.decisions.find((d) => d.id === id && d.active);
          if (!decision) return { rows: [] };
          decision.active = false;
          void supersededAt;
          return { rows: [{ id }] as unknown as Row[] };
        }

        if (n.startsWith("insert into property_ingest.attribute_visibility_decisions")) {
          const [
            attributeDefinitionId,
            decisionVersion,
            searchVisibility,
            rationale,
            reviewedBy,
            reviewedAt,
          ] = params as [string, number, "private" | "public_search", string, string, string];
          const id = randomUUID();
          this.decisions.push({
            id,
            attribute_definition_id: attributeDefinitionId,
            decision_version: decisionVersion,
            search_visibility: searchVisibility,
            rationale,
            reviewed_by: reviewedBy,
            reviewed_at: reviewedAt,
            active: true,
          });
          return { rows: [{ id }] as unknown as Row[] };
        }

        if (n.startsWith("update property_core.attribute_definitions")) {
          const [id, searchVisibility] = params as [string, "private" | "public_search"];
          if (id !== this.definition.id) return { rows: [] };
          this.definition.search_visibility = searchVisibility;
          return { rows: [{ id }] as unknown as Row[] };
        }

        // pendingProjectionCount / revokeExistingProjection touch
        // property_api.*/property_core.entity_attributes/auction_lots, which
        // this test's scenario leaves empty -- the review workflow's
        // versioning/replay/supersede logic is what's under test here.
        if (n.startsWith("with definition as")) {
          return { rows: [{ count: 0 }] as unknown as Row[] };
        }
        if (
          n.startsWith("update property_api.property_search") ||
          n.startsWith("update property_api.auction_lot_search")
        ) {
          return { rows: [] };
        }

        throw new Error(`unexpected query in fake attribute-visibility database: ${n}`);
      },
    });
  }
}

function reviewInput(
  overrides: Partial<Parameters<typeof reviewNationwideAttributeVisibility>[1]> = {},
) {
  return {
    attributeDefinitionId: ATTRIBUTE_DEFINITION_ID,
    searchVisibility: "public_search" as const,
    rationale: "Publicly published PLSS section, no PII.",
    reviewedBy: REVIEWER_ID,
    reviewedAt: "2026-09-24T01:00:00.000Z",
    ...overrides,
  };
}

test("first review creates decision version 1 and applies the definition's search_visibility", async () => {
  const database = new FakeAttributeVisibilityDatabase();

  const result = await reviewNationwideAttributeVisibility(database, reviewInput());
  assert.equal(result.decisionVersion, 1);
  assert.equal(result.supersedesDecisionId, null);
  assert.equal(result.replayed, false);
  assert.equal(database.definition.search_visibility, "public_search");
  assert.equal(database.decisions.length, 1);
  assert.equal(database.decisions[0]?.active, true);
});

test("an identical repeated review is replayed, not re-inserted", async () => {
  const database = new FakeAttributeVisibilityDatabase();
  const first = await reviewNationwideAttributeVisibility(database, reviewInput());

  const replay = await reviewNationwideAttributeVisibility(database, reviewInput());
  assert.equal(replay.replayed, true);
  assert.equal(replay.decisionId, first.decisionId);
  assert.equal(database.decisions.length, 1, "a replay never inserts a second decision row");
});

test("a later review with different content supersedes the active decision and increments the version", async () => {
  const database = new FakeAttributeVisibilityDatabase();
  const first = await reviewNationwideAttributeVisibility(database, reviewInput());

  const second = await reviewNationwideAttributeVisibility(
    database,
    reviewInput({
      searchVisibility: "private",
      rationale: "Revoked pending re-review.",
      reviewedAt: "2026-09-24T02:00:00.000Z",
    }),
  );
  assert.equal(second.decisionVersion, 2);
  assert.equal(second.supersedesDecisionId, first.decisionId);
  assert.equal(second.replayed, false);
  assert.equal(database.definition.search_visibility, "private");

  const activeDecisions = database.decisions.filter((decision) => decision.active);
  assert.equal(activeDecisions.length, 1, "exactly one active decision per definition, always");
  assert.equal(activeDecisions[0]?.id, second.decisionId);

  const previousDecision = database.decisions.find((decision) => decision.id === first.decisionId);
  assert.equal(
    previousDecision?.active,
    false,
    "the superseded decision is deactivated, never deleted",
  );
});

test("a review with an earlier or equal reviewedAt than the latest decision is rejected", async () => {
  const database = new FakeAttributeVisibilityDatabase();
  await reviewNationwideAttributeVisibility(database, reviewInput());

  await assert.rejects(
    () =>
      reviewNationwideAttributeVisibility(
        database,
        reviewInput({ searchVisibility: "private", reviewedAt: "2026-09-24T00:00:00.000Z" }),
      ),
    /reviewedAt must be later than the latest visibility decision/,
  );
});

test("public_search is rejected for an inactive or json-typed extension definition", async () => {
  const database = new FakeAttributeVisibilityDatabase();
  database.definition.active = false;

  await assert.rejects(
    () => reviewNationwideAttributeVisibility(database, reviewInput()),
    /public_search requires an active scalar extension definition/,
  );
});

test("an unregistered attributeDefinitionId is rejected", async () => {
  const database = new FakeAttributeVisibilityDatabase();
  await assert.rejects(
    () =>
      reviewNationwideAttributeVisibility(
        database,
        reviewInput({ attributeDefinitionId: randomUUID() }),
      ),
    /does not identify a registered extension definition/,
  );
});
