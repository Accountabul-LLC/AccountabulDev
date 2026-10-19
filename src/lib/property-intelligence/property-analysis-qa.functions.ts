import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";
import type { DossierDatabase } from "@/lib/property-intelligence/property-dossier.server";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

// Server-function surface for the property dossier and the analysis Q&A
// trail, ported from the source app's app/api/dossier/route.ts and
// app/api/analysis/route.ts.
//
// property-dossier.server.ts and property-analysis-qa.server.ts were ported
// and tested but unreachable: the Q&A module had no caller in src/ at all,
// and the dossier module was called only by other unreachable modules, so
// the whole dossier path was dead from the application's point of view.
//
// The security-relevant shape, and the reason these are not thin pass-throughs:
//
//   * The ANSWER is produced server-side. `askAnalysisThread` routes the
//     question through routePropertyQuestion against a dossier this handler
//     fetched; the client supplies only the question text and which workspace
//     it is about. A client-supplied answer, report or dossier would let a
//     caller write arbitrary content into an append-only audit trail that is
//     meant to record what the system actually concluded.
//   * The report and dossier are rebuilt here from stored facts rather than
//     accepted from the caller, for the same reason.
//   * Ownership of the workspace is confirmed before anything is read or
//     appended.
//
// The dossier refresh uses the service-role client (withPropertyDossierClient)
// because it writes canonical, all-users-readable parcel facts. The Q&A trail
// (property_analysis_messages/_question_runs/_question_events) also writes
// through the service role now -- those three tables are service-role write
// only (20260924210000; ACC-20260924-003), so the request's own authenticated
// client has no INSERT grant on any of them and cannot write them at all.
// Every row it writes still carries only the threadId/userId this handler
// already verified via ownedWorkspace below, so scoping to the caller comes
// from that check, not from which client performs the insert.

const ASK_RATE_LIMIT = 20;
const ASK_RATE_WINDOW_MS = 60_000;

function requireThreadId(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("A workspace id is required.");
  }
  return value;
}

function normalizedQuestion(value: unknown) {
  if (typeof value !== "string") throw new Error("Ask a question about this property.");
  const question = value.replace(/\s+/g, " ").trim();
  if (!question) throw new Error("Ask a question about this property.");
  if (question.length > 1_000) throw new Error("That question is too long.");
  return question;
}

type WorkspaceRow = {
  id: string;
  parcel_id: string | null;
  property_intel_parcels: {
    asr_parcel_id: string | null;
    current_address: string | null;
    property_intel_profiles: unknown;
  } | null;
};

/**
 * Loads the signed-in user's workspace and the parcel it points at. Throws
 * when the workspace is not theirs, so every caller below is ownership-checked.
 */
async function ownedWorkspace(supabase: unknown, threadId: string): Promise<WorkspaceRow> {
  const client = supabase as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          is: (
            column: string,
            value: null,
          ) => { maybeSingle: () => Promise<{ data: WorkspaceRow | null; error: unknown }> };
        };
      };
    };
  };
  const { data, error } = await client
    .from("property_analysis_threads")
    .select(
      "id, parcel_id, property_intel_parcels(asr_parcel_id, current_address, property_intel_profiles(*))",
    )
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That workspace was not found.");
  return data;
}

function profileOf(workspace: WorkspaceRow) {
  const raw = workspace.property_intel_parcels?.property_intel_profiles ?? null;
  const profile = Array.isArray(raw) ? (raw[0] ?? null) : raw;
  return (profile ?? null) as never;
}

/** One workspace's dossier: stored facts, refreshed when stale. */
export const getPropertyDossierForWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string }) => ({ threadId: requireThreadId(input?.threadId) }))
  .handler(async ({ data, context }) => {
    const workspace = await ownedWorkspace(context.supabase, data.threadId);
    const parcelId = workspace.property_intel_parcels?.asr_parcel_id ?? null;
    const { emptyDossier, getOrRefreshPropertyDossier, withPropertyDossierClient } =
      await import("@/lib/property-intelligence/property-dossier.server");
    if (!parcelId) return emptyDossier();
    // Service-role: a refresh writes canonical parcel facts shared by every
    // account, not rows owned by this user.
    return withPropertyDossierClient((database: DossierDatabase) =>
      getOrRefreshPropertyDossier(database, {
        parcelId,
        address: workspace.property_intel_parcels?.current_address ?? null,
        handle: null,
        userId: context.userId,
      }),
    );
  });

/**
 * Asks a question about one workspace and appends the exchange to the
 * append-only Q&A trail. The answer is computed here, never supplied.
 */
export const askPropertyAnalysisQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { threadId: string; question: string }) => ({
    threadId: requireThreadId(input?.threadId),
    question: normalizedQuestion(input?.question),
  }))
  .handler(async ({ data, context }) => {
    await throwIfRateLimited(
      `property-analysis-ask:${context.userId}`,
      ASK_RATE_LIMIT,
      ASK_RATE_WINDOW_MS,
    );
    const workspace = await ownedWorkspace(context.supabase, data.threadId);
    const parcelId = workspace.property_intel_parcels?.asr_parcel_id ?? null;

    const [
      { emptyDossier, getOrRefreshPropertyDossier, withPropertyDossierClient },
      { buildPropertyReport },
      { askAnalysisThread },
    ] = await Promise.all([
      import("@/lib/property-intelligence/property-dossier.server"),
      import("@/lib/property-intelligence/property-analysis"),
      import("@/lib/property-intelligence/property-analysis-qa.server"),
    ]);

    const dossier = parcelId
      ? await withPropertyDossierClient((database: DossierDatabase) =>
          getOrRefreshPropertyDossier(database, {
            parcelId,
            address: workspace.property_intel_parcels?.current_address ?? null,
            handle: null,
            userId: context.userId,
          }),
        )
      : emptyDossier();
    const profile = profileOf(workspace);
    // Built from stored facts, not from anything the caller sent.
    const report = buildPropertyReport(dossier, profile);

    // property_analysis_messages/_question_runs/_question_events are
    // service-role write only (20260924210000; ACC-20260924-003), so this
    // reuses the same withPropertyDossierClient helper as the dossier
    // refresh above rather than passing context.supabase (the request's own
    // client, which has no INSERT grant on any of the three).
    const result = await withPropertyDossierClient((database: DossierDatabase) =>
      askAnalysisThread(database, {
        threadId: data.threadId,
        userId: context.userId,
        question: data.question,
        report,
        dossier,
        profile,
      }),
    );

    // A serializable projection, not the raw decision. `decision.trace`
    // carries Record<string, unknown> payloads, which the server-function
    // boundary rejects as possibly-unserializable -- and the trace is
    // internal routing detail the browser has no use for. The durable copy
    // is the append-only row this call already wrote, so nothing is lost by
    // leaving it out of the response.
    return {
      questionId: result.questionId,
      answerId: result.answerId,
      runId: result.runId,
      question: result.question,
      answer: result.answer,
      decision: {
        intent: result.decision.intent,
        route: result.decision.route,
        status: result.decision.status,
        handlerCanAnswer: result.decision.handlerCanAnswer,
        validationPassed: result.decision.validationPassed,
        missingSources: result.decision.missingSources.map((source) => ({
          key: source.key,
          label: source.label,
          reason: source.reason,
        })),
      },
    };
  });

/** Aggregate routing/answerability metrics across the user's own questions. */
export const getPropertyAnalysisQuestionMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAnalysisQuestionMetrics } =
      await import("@/lib/property-intelligence/property-analysis-qa.server");
    return getAnalysisQuestionMetrics(context.supabase as never, context.userId);
  });
