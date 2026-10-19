import { createFileRoute } from "@tanstack/react-router";

import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { getFreshRestreamAccessToken } from "@/lib/restream/oauth.server";

export const Route = createFileRoute("/api/internal/restream-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["RESTREAM_BRIDGE_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        return Response.json(await getFreshRestreamAccessToken());
      },
    },
  },
});
