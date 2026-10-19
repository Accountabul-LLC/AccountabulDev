import { screenDeterministically } from "@/lib/conference/moderation";

export type ModerationDecision = {
  status: "approved" | "quarantined";
  provider: "deterministic" | "openai" | "unavailable";
  reasons: string[];
  raw: Record<string, unknown>;
};

/**
 * Screens chat using deterministic rules and omni-moderation-latest.
 * Any missing key, timeout, malformed response, or provider failure quarantines
 * the message. Callers must never turn an unavailable result into approval.
 */
export async function moderateComment(body: string): Promise<ModerationDecision> {
  const deterministic = screenDeterministically(body);
  if (!deterministic.allowed) {
    return {
      status: "quarantined",
      provider: "deterministic",
      reasons: deterministic.reasons,
      raw: { deterministic },
    };
  }

  return moderateWithProvider(body);
}

/**
 * The moderation provider on its own, without the paid-comment deterministic
 * filter. Community chat calls this after publication so an ordinary link does
 * not stop the provider from running. The fail-closed status values are kept
 * for paid comments; chat reads `provider` and `reasons`, never `status`.
 */
export async function moderateWithProvider(body: string): Promise<ModerationDecision> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return {
      status: "quarantined",
      provider: "unavailable",
      reasons: ["moderation_provider_not_configured"],
      raw: {},
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: body }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`moderation_http_${response.status}`);

    const result = (await response.json()) as {
      id?: string;
      model?: string;
      results?: Array<{
        flagged?: boolean;
        categories?: Record<string, boolean>;
        category_scores?: Record<string, number>;
      }>;
    };
    const first = result.results?.[0];
    if (!first || typeof first.flagged !== "boolean")
      throw new Error("moderation_invalid_response");
    const reasons = Object.entries(first.categories ?? {})
      .filter(([, flagged]) => flagged)
      .map(([category]) => category);

    return {
      status: first.flagged ? "quarantined" : "approved",
      provider: "openai",
      reasons,
      raw: {
        id: result.id ?? null,
        model: result.model ?? "omni-moderation-latest",
        flagged: first.flagged,
        categories: first.categories ?? {},
        category_scores: first.category_scores ?? {},
      },
    };
  } catch (error) {
    return {
      status: "quarantined",
      provider: "unavailable",
      reasons: [error instanceof Error ? error.message : "moderation_provider_error"],
      raw: {},
    };
  }
}
