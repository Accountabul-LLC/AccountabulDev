import { createFileRoute } from "@tanstack/react-router";

import { EVENT_PASS_TTL_MS } from "@/lib/conference/entitlements";
import { sha256Text } from "@/lib/conference/moderation";
import { rateLimitResponse } from "@/lib/security/rate-limit.server";
import { stripeCheckoutUnavailableResponse } from "@/lib/stripe/client.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

/**
 * Buy watch or watch + chat access without an account. Anonymous buyers are
 * recognized afterward by a random token, hashed here and stored on the
 * pending event_passes row, with the raw value set as an HttpOnly cookie —
 * the same mechanism a signed-in purchase gets from their user id.
 */
export const Route = createFileRoute("/api/public/event-passes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await rateLimitResponse(request, "event-passes", 10, 10 * 60_000);
        if (limited) return limited;
        // A free event still runs through this route without ever needing
        // Stripe, so only refuse up front when the amount will actually be
        // charged; purchaseEventAccess re-checks this once it knows the price.
        const payload = (await request.json()) as Record<string, unknown>;
        const eventId = typeof payload["eventId"] === "string" ? payload["eventId"] : "";
        const attemptId = typeof payload["attemptId"] === "string" ? payload["attemptId"] : "";
        const email =
          typeof payload["email"] === "string" ? payload["email"].trim().toLowerCase() : "";
        const accessType = payload["accessType"] === "watch" ? "watch" : "watch_and_chat";
        if (!UUID.test(eventId) || !UUID.test(attemptId) || !/^\S+@\S+\.\S+$/.test(email)) {
          return Response.json(
            { error: "Event, attempt, and valid email are required." },
            { status: 400 },
          );
        }

        const { loadEventForAccessPurchase, purchaseEventAccess } =
          await import("@/lib/conference/event-access.server");
        const event = await loadEventForAccessPurchase(eventId);

        const rawToken = randomToken();
        const accessTokenHash = await sha256Text(rawToken);
        let result;
        try {
          result = await purchaseEventAccess({
            event,
            accessType,
            attemptId,
            buyer: { email, accessTokenHash },
            successPath: `/live/${event.slug}?pass=success`,
            cancelPath: `/live/${event.slug}?pass=canceled`,
          });
        } catch (error) {
          const unavailable = stripeCheckoutUnavailableResponse();
          if (unavailable) return unavailable;
          throw error;
        }
        if (result.outcome === "unavailable") {
          return Response.json({ error: result.reason }, { status: 409 });
        }

        const cookieName = `accountabul_pass_${eventId.replaceAll("-", "")}`;
        const cookie = `${cookieName}=${encodeURIComponent(rawToken)}; Path=/; Max-Age=${EVENT_PASS_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
        if (result.outcome === "granted") {
          return Response.json(
            { checkoutUrl: null, granted: true },
            { headers: { "Set-Cookie": cookie } },
          );
        }
        return Response.json(
          { checkoutUrl: result.checkoutUrl, granted: false },
          { headers: { "Set-Cookie": cookie } },
        );
      },
    },
  },
});

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
