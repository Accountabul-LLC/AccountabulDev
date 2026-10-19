import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ASSISTANT_MAX_ANSWER_TOKENS,
  buildSystemPrompt,
  normalizeQuestion,
  trimHistory,
  type AssistantTurn,
} from "@/lib/live/assistant";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

const ANTHROPIC_MODEL = "claude-sonnet-5";

/**
 * Side-panel lookups for people in a live room.
 *
 * Gated on the same watch entitlement as the stream itself, so the assistant
 * is not a way for a signed-out visitor to use the room without access.
 */
export const askLiveAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { eventId: string; question: string; history?: AssistantTurn[] }) => {
    if (!UUID.test(input.eventId)) throw new Error("Invalid event.");
    return {
      eventId: input.eventId,
      question: normalizeQuestion(input.question),
      history: trimHistory(input.history ?? []),
    };
  })
  .handler(async ({ data, context }) => {
    const { loadEventEntitlementFor } = await import("@/lib/conference/entitlement.server");
    const entitlement = await loadEventEntitlementFor(data.eventId, context.userId);
    if (!entitlement.canWatch) {
      throw new Error("The room assistant is available to people with access to this event.");
    }

    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new Error("The room assistant is not configured yet.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event, error } = await supabaseAdmin
      .from("events")
      .select("title, description")
      .eq("id", data.eventId)
      .single();
    if (error) throw error;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ASSISTANT_MAX_ANSWER_TOKENS,
        system: buildSystemPrompt({
          eventTitle: event.title,
          eventDescription: event.description,
        }),
        messages: [
          ...data.history.map((turn) => ({ role: turn.role, content: turn.content })),
          { role: "user", content: data.question },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      // Never surface the provider body; it can carry request metadata.
      throw new Error("The room assistant is unavailable right now.");
    }

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const answer = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (!answer) throw new Error("The room assistant did not return an answer.");
    return { answer };
  });
