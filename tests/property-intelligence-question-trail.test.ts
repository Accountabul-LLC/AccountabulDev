// Contract for the Property Analysis question-and-answer trail, ported from
// property-intelligence-app's askAnalysisThread / getAnalysisQuestionMetrics.
//
// The point of this subsystem is that an answer is traceable and not
// self-asserted. So what the tests pin is: the answer comes from the router
// rather than the caller, every routing decision is recorded alongside it, and
// the per-stage trace lands in order. The tables are append-only in the
// migration, so a recorded run stands as evidence of what was answered.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  askAnalysisThread,
  getAnalysisQuestionMetrics,
  normalizeAnalysisQuestion,
} from "../src/lib/property-intelligence/property-analysis-qa.server.ts";
import { buildPropertyReport } from "../src/lib/property-intelligence/property-analysis.ts";
import type {
  DossierDatabase,
  DossierQuery,
  DossierRow,
} from "../src/lib/property-intelligence/property-dossier.server.ts";
import type { PropertyProfile } from "../src/lib/property-intelligence/analysis-types.ts";
import type { PropertyDossier } from "../src/lib/property-intelligence/dossier-types.ts";

class FakeQaDatabase implements DossierDatabase {
  tables: Record<string, DossierRow[]> = {
    property_analysis_messages: [],
    property_analysis_question_runs: [],
    property_analysis_question_events: [],
  };

  from(table: string): DossierQuery {
    const rows = (this.tables[table] ??= []);
    const filters: Array<(row: DossierRow) => boolean> = [];
    let created: DossierRow | null = null;

    const query: DossierQuery = {
      select() {
        return query;
      },
      upsert() {
        return query;
      },
      insert(next: unknown) {
        created = { id: randomUUID(), ...(next as DossierRow) };
        rows.push(created);
        return query;
      },
      update() {
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return query;
      },
      is() {
        return query;
      },
      order() {
        return query;
      },
      async maybeSingle() {
        return { data: created ?? rows[0] ?? null };
      },
      async single() {
        return { data: created ?? rows[0] ?? null };
      },
      then(resolve) {
        return Promise.resolve({
          data: rows.filter((row) => filters.every((predicate) => predicate(row))),
        }).then(resolve);
      },
    };
    return query;
  }
}

const profile = {
  taxBalance: 0,
  lotSquareFeet: 3530,
  ward: 13,
} as unknown as PropertyProfile;

const dossier = {
  property: {
    id: "property:52939410000",
    asrParcelId: "52939410000",
    handle: null,
    currentAddress: "4921 EMERSON AV",
    matchStatus: "canonical",
    lastIntelligenceSyncAt: "2026-09-24T12:00:00.000Z",
    updatedAt: "2026-09-24T12:00:00.000Z",
    intelligenceSchemaVersion: 2,
  },
  events: [],
  sources: [],
  unresolvedRecordCount: 0,
  freshness: {
    mode: "automatic",
    state: "fresh",
    lastSyncedAt: "2026-09-24T12:00:00.000Z",
    nextRefreshAt: null,
  },
  titleEvidence: [],
  disclaimer: "Public records are not a title opinion.",
} as unknown as PropertyDossier;

const THREAD = randomUUID();
const USER = randomUUID();

function ask(database: FakeQaDatabase, question: string) {
  return askAnalysisThread(database, {
    threadId: THREAD,
    userId: USER,
    question,
    report: buildPropertyReport(dossier, profile),
    dossier,
    profile,
  });
}

test("a question is bounded before anything is recorded", () => {
  assert.deepEqual(normalizeAnalysisQuestion("  Is the   title clear? "), {
    rawQuestion: "Is the   title clear?",
    question: "Is the title clear?",
  });
  assert.throws(() => normalizeAnalysisQuestion("   "), /between 1 and 1,000 characters/i);
  assert.throws(() => normalizeAnalysisQuestion("x".repeat(1001)), /between 1 and 1,000/i);
});

test("the answer comes from the router, and the question and answer are both recorded", async () => {
  const database = new FakeQaDatabase();
  const result = await ask(database, "Is the title clear?");

  assert.match(result.answer, /do not establish clear or insurable title/i);
  const messages = database.tables["property_analysis_messages"] ?? [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.["role"], "user");
  assert.equal(messages[0]?.["content"], "Is the title clear?");
  assert.equal(messages[1]?.["role"], "assistant");
  assert.equal(messages[1]?.["content"], result.answer);
});

test("the run row records the routing decision, not just the text", async () => {
  const database = new FakeQaDatabase();
  await ask(database, "Is the title clear?");

  const run = database.tables["property_analysis_question_runs"]?.[0];
  assert.ok(run, "a run is recorded");
  assert.equal(run?.["user_id"], USER);
  assert.equal(run?.["raw_question"], "Is the title clear?");
  assert.equal(typeof run?.["detected_intent"], "string");
  assert.equal(typeof run?.["handler_id"], "string");
  assert.equal(typeof run?.["handler_can_answer"], "boolean");
  assert.equal(typeof run?.["validation_passed"], "boolean");
  assert.equal(typeof run?.["model_research_eligible"], "boolean");
  assert.equal(run?.["trace_version"], 1);
});

test("the per-stage trace is recorded in order", async () => {
  const database = new FakeQaDatabase();
  await ask(database, "Is the title clear?");

  const events = database.tables["property_analysis_question_events"] ?? [];
  assert.ok(events.length > 0, "the routing trace is persisted");
  assert.deepEqual(
    events.map((event) => event["sequence"]),
    events.map((_event, index) => index),
    "sequences are dense and ordered",
  );
  assert.ok(
    events.every((event) => typeof event["stage"] === "string" && event["stage"] !== ""),
    "every trace event names its stage",
  );
});

test("metrics aggregate the recorded runs for the owner", async () => {
  const database = new FakeQaDatabase();
  await ask(database, "Is the title clear?");
  await ask(database, "What permits were pulled?");

  const metrics = await getAnalysisQuestionMetrics(database, USER);
  assert.equal(metrics.totalQuestions, 2);
  assert.equal(
    metrics.handlerCanAnswer.yes + metrics.handlerCanAnswer.no,
    2,
    "every run is counted on exactly one side",
  );
  assert.equal(metrics.validation.passed + metrics.validation.failed, 2);
  assert.equal(
    metrics.intents.reduce((total, intent) => total + intent.count, 0),
    2,
  );
  assert.ok(
    metrics.intents.every(
      (intent, index, all) => index === 0 || all[index - 1]!.count >= intent.count,
    ),
    "intents are ordered by descending count",
  );
});

test("metrics are scoped to the asking account", async () => {
  const database = new FakeQaDatabase();
  await ask(database, "Is the title clear?");
  const other = await getAnalysisQuestionMetrics(database, randomUUID());
  assert.equal(other.totalQuestions, 0);
  assert.deepEqual(other.intents, []);
});

test("a malformed stored missing-sources payload is skipped, not fatal", async () => {
  const database = new FakeQaDatabase();
  await ask(database, "Is the title clear?");
  database.tables["property_analysis_question_runs"]?.push({
    id: randomUUID(),
    user_id: USER,
    detected_intent: "other",
    route: "missing_source",
    handler_can_answer: false,
    validation_passed: true,
    model_research_eligible: false,
    missing_source_count: 1,
    missing_sources: "not-an-array",
  });

  const metrics = await getAnalysisQuestionMetrics(database, USER);
  assert.equal(metrics.totalQuestions, 2, "the malformed row still counts as a run");
  assert.ok(Array.isArray(metrics.missingSources), "the aggregate survives the bad payload");
});
