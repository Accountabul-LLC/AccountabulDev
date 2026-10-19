/**
 * The live-room side assistant: quick lookups without leaving the video.
 */

export const ASSISTANT_MAX_QUESTION = 500;
export const ASSISTANT_MAX_ANSWER_TOKENS = 700;
/** Keeps one person from turning the room into a chat client. */
export const ASSISTANT_MAX_TURNS = 12;

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export function normalizeQuestion(raw: string) {
  const question = raw.normalize("NFKC").trim();
  if (!question) throw new Error("Ask a question first.");
  if (question.length > ASSISTANT_MAX_QUESTION) {
    throw new Error(`Questions are limited to ${ASSISTANT_MAX_QUESTION} characters.`);
  }
  return question;
}

/** Older turns are dropped rather than refused, so the panel keeps working. */
export function trimHistory(history: readonly AssistantTurn[]): AssistantTurn[] {
  if (history.length <= ASSISTANT_MAX_TURNS) return [...history];
  return history.slice(history.length - ASSISTANT_MAX_TURNS);
}

/**
 * The assistant answers about the event and the Accountabul product. It is
 * explicitly not a financial adviser, because the audience is discussing deals.
 */
export function buildSystemPrompt(context: {
  eventTitle: string;
  eventDescription: string | null;
}) {
  return [
    "You are the Accountabul live-room assistant.",
    "You help someone watching a live Accountabul event look things up without leaving the stream.",
    "Answer briefly: a few sentences, or a short list. The reader is watching a video at the same time.",
    "If you do not know something about this specific event, say so and suggest asking in the room chat.",
    "Do not give personalized investment, tax, or legal advice. Explain general concepts instead and suggest a licensed professional.",
    "",
    `Current event: ${context.eventTitle}`,
    context.eventDescription ? `Event description: ${context.eventDescription}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function assistantIsConfigured(env: Record<string, string | undefined>) {
  return Boolean(env["ANTHROPIC_API_KEY"]);
}
