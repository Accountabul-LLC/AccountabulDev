import { createFileRoute } from "@tanstack/react-router";

import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { verifyOperationsOperator } from "@/lib/operations/operator-auth.server";

export const Route = createFileRoute("/api/internal/ops/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const email = typeof payload["email"] === "string" ? payload["email"] : "";
        const password = typeof payload["password"] === "string" ? payload["password"] : "";
        if (!email || !password)
          return Response.json({ error: "Email and password are required." }, { status: 400 });
        const result = await verifyOperationsOperator(email, password);
        if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
        return Response.json(result.operator);
      },
    },
  },
});
