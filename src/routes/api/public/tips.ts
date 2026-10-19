import { createFileRoute } from "@tanstack/react-router";

import { rateLimitResponse } from "@/lib/security/rate-limit.server";
import { normalizeEmail } from "@/lib/security/emails";
import { stripeCheckoutUnavailableResponse } from "@/lib/stripe/client.server";
import { circleUsdcUnavailableResponse } from "@/lib/crypto/circle-wallets.server";
import { createNamedTipIntent, type TipMethod } from "@/lib/tips/intent.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

export const Route = createFileRoute("/api/public/tips")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await rateLimitResponse(request, "tips", 10, 10 * 60_000);
        if (limited) return limited;
        const payload = (await request.json()) as Record<string, unknown>;
        const method: TipMethod = payload["method"] === "usdc" ? "usdc" : "stripe";
        const unavailable =
          method === "usdc" ? circleUsdcUnavailableResponse() : stripeCheckoutUnavailableResponse();
        if (unavailable) return unavailable;
        const eventId = typeof payload["eventId"] === "string" ? payload["eventId"] : "";
        const attemptId = typeof payload["attemptId"] === "string" ? payload["attemptId"] : "";
        const email = typeof payload["email"] === "string" ? normalizeEmail(payload["email"]) : "";
        const amountMinor = Math.round(Number(payload["amountMinor"]));
        if (!UUID.test(eventId) || !UUID.test(attemptId) || !/^\S+@\S+\.\S+$/.test(email)) {
          return Response.json(
            { error: "Event, attempt, and valid email are required." },
            { status: 400 },
          );
        }
        try {
          const result = await createNamedTipIntent({
            eventId,
            amountMinor,
            attemptId,
            displayName: payload["displayName"],
            message: payload["message"],
            method,
            guestEmail: email,
          });
          return Response.json(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Tip checkout could not be started.";
          const status = /required|between|cannot be submitted|does not match/i.test(message)
            ? 400
            : /not enabled|not available/i.test(message)
              ? 409
              : 500;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
