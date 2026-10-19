// Property Analysis question-and-answer persistence and metrics, ported from
// property-intelligence-app's app/lib/analysis-repository.ts (askAnalysisThread
// and getAnalysisQuestionMetrics) and refactored from Cloudflare D1 onto
// Supabase (20260924210000).
//
// The answer is never supplied by the caller: routePropertyQuestion computes
// it from the dossier and report, and this module records what the router
// decided. That is why the tables are service-role write -- a client able to
// insert its own run row could claim an answer, an intent, or a "validation
// passed" the router never produced. `authenticated` holds select but no
// insert grant on any of the three (20260924210000), so askAnalysisThread's
// caller (property-analysis-qa.functions.ts, ACC-20260924-003) must supply
// the service-role client, lazy-imported the same way withPropertyDossierClient
// does for the dossier refresh -- not the request's own RLS-scoped client.
//
// The trail is append-only by design (no UPDATE or DELETE policy on any of the
// three tables), so a recorded question run stands as evidence of what was
// actually answered and on what basis. A correction is a new run.
import type { PropertyDossier } from "./dossier-types.ts";
import type { PropertyProfile, PropertyReport } from "./analysis-types.ts";
import { routePropertyQuestion } from "./property-analysis.ts";
import type { DossierDatabase } from "./property-dossier.server.ts";

export const MAX_QUESTION_LENGTH = 1000;

export type AnalysisQuestionMetrics = {
  totalQuestions: number;
  handlerCanAnswer: { yes: number; no: number };
  validation: { passed: number; failed: number };
  modelResearch: { eligible: number; notEligible: number };
  intents: Array<{ key: string; count: number }>;
  routes: Array<{ key: string; count: number }>;
  missingSources: Array<{ key: string; count: number }>;
};

export function normalizeAnalysisQuestion(questionInput: string) {
  const rawQuestion = questionInput.trim();
  if (!rawQuestion || rawQuestion.length > MAX_QUESTION_LENGTH) {
    throw new Error("Ask a property question between 1 and 1,000 characters.");
  }
  return { rawQuestion, question: rawQuestion.replace(/\s+/g, " ") };
}

/**
 * Tallies a grouped column client-side. Supabase has no GROUP BY in PostgREST,
 * so the source's four aggregate queries become one read plus these tallies;
 * the resulting shape is identical.
 */
function tally(values: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export async function askAnalysisThread(
  database: DossierDatabase,
  input: {
    threadId: string;
    userId: string;
    question: string;
    report: PropertyReport;
    dossier: PropertyDossier;
    profile: PropertyProfile | null;
  },
) {
  const { rawQuestion, question } = normalizeAnalysisQuestion(input.question);
  const startedAt = new Date().toISOString();

  // The routing decision, and therefore the answer, is computed here from the
  // dossier -- never accepted from the caller.
  const decision = routePropertyQuestion(rawQuestion, input.report, input.dossier, input.profile);
  const completedAt = new Date().toISOString();

  const { data: questionMessage } = await database
    .from("property_analysis_messages")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      role: "user",
      message_type: "chat",
      content: question,
      evidence: [],
      created_at: completedAt,
    })
    .select("id")
    .single();

  const { data: answerMessage } = await database
    .from("property_analysis_messages")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      role: "assistant",
      message_type: "chat",
      content: decision.answer,
      evidence: decision.evidence,
      created_at: new Date(new Date(completedAt).valueOf() + 1).toISOString(),
    })
    .select("id")
    .single();

  if (!questionMessage || !answerMessage) {
    throw new Error("The property question could not be recorded.");
  }

  const { data: run } = await database
    .from("property_analysis_question_runs")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      question_message_id: questionMessage["id"],
      answer_message_id: answerMessage["id"],
      raw_question: decision.rawQuestion,
      normalized_question: decision.normalizedQuestion,
      detected_intent: decision.intent,
      handler_id: decision.handlerId,
      handler_can_answer: decision.handlerCanAnswer,
      route: decision.route,
      outcome_status: decision.status,
      missing_source_count: decision.missingSources.length,
      missing_sources: decision.missingSources,
      model_research_eligible: decision.modelResearchEligible,
      validation_passed: decision.validationPassed,
      trace_version: 1,
      started_at: startedAt,
      completed_at: completedAt,
    })
    .select("id")
    .single();

  if (!run) throw new Error("The property question run could not be recorded.");

  for (const [sequence, event] of decision.trace.entries()) {
    await database.from("property_analysis_question_events").insert({
      question_run_id: run["id"],
      sequence,
      stage: event.stage,
      decision: event.decision,
      data: event.data ?? {},
    });
  }

  return {
    questionId: String(questionMessage["id"]),
    answerId: String(answerMessage["id"]),
    runId: String(run["id"]),
    question,
    answer: decision.answer,
    decision,
  };
}

export async function getAnalysisQuestionMetrics(
  database: DossierDatabase,
  userId: string,
): Promise<AnalysisQuestionMetrics> {
  const { data } = await database
    .from("property_analysis_question_runs")
    .select(
      "detected_intent, route, handler_can_answer, validation_passed, model_research_eligible, missing_source_count, missing_sources",
    )
    .eq("user_id", userId);

  const runs = data ?? [];
  const missingCounts = new Map<string, number>();
  for (const run of runs) {
    const sources = run["missing_sources"];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const key = (source as { key?: unknown } | null)?.key;
      // A malformed historical payload is skipped rather than breaking the
      // whole aggregate, matching the source's behavior.
      if (typeof key === "string") missingCounts.set(key, (missingCounts.get(key) ?? 0) + 1);
    }
  }

  const count = (predicate: (run: (typeof runs)[number]) => boolean) =>
    runs.filter(predicate).length;

  return {
    totalQuestions: runs.length,
    handlerCanAnswer: {
      yes: count((run) => run["handler_can_answer"] === true),
      no: count((run) => run["handler_can_answer"] === false),
    },
    validation: {
      passed: count((run) => run["validation_passed"] === true),
      failed: count((run) => run["validation_passed"] === false),
    },
    modelResearch: {
      eligible: count((run) => run["model_research_eligible"] === true),
      notEligible: count((run) => run["model_research_eligible"] === false),
    },
    intents: tally(runs.map((run) => String(run["detected_intent"] ?? ""))),
    routes: tally(runs.map((run) => String(run["route"] ?? ""))),
    missingSources: [...missingCounts.entries()]
      .map(([key, value]) => ({ key, count: value }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)),
  };
}
