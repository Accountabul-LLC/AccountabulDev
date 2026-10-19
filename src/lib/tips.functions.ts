import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { UUID_V1_TO_V8 as UUID_PATTERN } from "./validation/patterns.ts";

type TipMethod = "stripe" | "usdc";

type CreateTipInput = {
  eventId: string;
  amountMinor: number;
  attemptId: string;
  displayName: string;
  message: string;
  method?: TipMethod;
};

/**
 * Creates a tip intent server-side. Clients can never mark a tip paid:
 * the row is written with the service role at status `created`, and only the
 * verified provider webhook may advance it to `paid`.
 */
export const createTipIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: CreateTipInput) => {
    if (!input || typeof input.eventId !== "string") throw new Error("An event is required.");
    if (typeof input.attemptId !== "string" || !UUID_PATTERN.test(input.attemptId)) {
      throw new Error("A valid tip attempt is required.");
    }
    const amount = Math.round(Number(input.amountMinor));
    if (!Number.isFinite(amount) || amount < 100 || amount > 100_000_00) {
      throw new Error("Tip amounts must be between $1 and $100,000.");
    }
    const method: TipMethod = input.method === "usdc" ? "usdc" : "stripe";
    return {
      eventId: input.eventId,
      attemptId: input.attemptId,
      amountMinor: amount,
      displayName: input.displayName,
      message: input.message,
      method,
    };
  })
  .handler(async ({ data, context }) => {
    if (data.method === "stripe") {
      const { requireStripeCheckoutSecrets } = await import("@/lib/stripe/client.server");
      requireStripeCheckoutSecrets();
    }
    const { createNamedTipIntent } = await import("@/lib/tips/intent.server");
    return createNamedTipIntent({
      eventId: data.eventId,
      amountMinor: data.amountMinor,
      attemptId: data.attemptId,
      displayName: data.displayName,
      message: data.message,
      method: data.method,
      userId: context.userId,
    });
  });
