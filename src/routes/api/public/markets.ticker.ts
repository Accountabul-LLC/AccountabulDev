import { createFileRoute } from "@tanstack/react-router";

import { rateLimitResponse } from "@/lib/security/rate-limit.server";

export const Route = createFileRoute("/api/public/markets/ticker")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await rateLimitResponse(request, "markets-ticker", 60, 60_000);
        if (limited) return limited;

        const { getSharedMarketService } = await import("@/lib/markets/service.server");
        const payload = await getSharedMarketService().getTickerPayload();
        if (!payload) {
          return Response.json(
            { assets: [], lastUpdated: null, attribution: null },
            {
              status: 200,
              headers: {
                "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
              },
            },
          );
        }

        return Response.json(payload, {
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          },
        });
      },
    },
  },
});
