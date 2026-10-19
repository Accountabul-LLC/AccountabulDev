import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";
import { trimmedString as stringValue } from "../validation/strings.ts";

const MAX_REVIEW_NOTE_LENGTH = 2_000;

type ReviewRequestSuccess<Decision extends string> = {
  ok: true;
  id: string;
  decision: Decision;
  note: string | null;
};

type ReviewRequestFailure = {
  ok: false;
  response: Response;
};

export async function parseReviewRequest<Decision extends string>(
  request: Request,
  options: {
    entity: string;
    isDecision: (value: string) => value is Decision;
    requiresNote: (decision: Decision) => boolean;
  },
): Promise<ReviewRequestSuccess<Decision> | ReviewRequestFailure> {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failure("A JSON object review request is required.");
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return failure("A valid JSON review request is required.");
  }

  const id = stringValue(payload, "id");
  const decision = stringValue(payload, "decision");
  const note = stringValue(payload, "note");

  if (!UUID.test(id) || !options.isDecision(decision)) {
    return failure(`A valid ${options.entity} and review decision are required.`);
  }

  if (options.requiresNote(decision) && !note) {
    return failure("A review note is required for this decision.");
  }

  if (note.length > MAX_REVIEW_NOTE_LENGTH) {
    return failure("A review note may not exceed 2,000 characters.");
  }

  return { ok: true, id, decision, note: note || null };
}

export function reviewRpcErrorResponse(error: { code?: string; message: string } | null) {
  if (error?.code === "22023") {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error?.code === "42501") {
    return Response.json({ error: "This review decision is not authorized." }, { status: 403 });
  }
  return null;
}

function failure(message: string): ReviewRequestFailure {
  return { ok: false, response: Response.json({ error: message }, { status: 400 }) };
}
