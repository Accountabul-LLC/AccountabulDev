import { createFileRoute } from "@tanstack/react-router";

import { ingestExternalChat } from "@/lib/chat-adapters/ingest.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

const SOURCES = new Set(["restream", "youtube", "facebook", "linkedin", "twitch", "x"]);

export const Route = createFileRoute("/api/internal/ops/restream-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const eventId = stringField(payload, "eventId");
        const externalId = stringField(payload, "externalId");
        const body = stringField(payload, "body").normalize("NFKC").trim();
        const sourceValue = stringField(payload, "source").toLowerCase();
        if (!eventId || !externalId || !body || body.length > 500 || !SOURCES.has(sourceValue)) {
          return Response.json({ error: "Invalid normalized Restream message." }, { status: 400 });
        }

        const result = await ingestExternalChat(
          {
            eventId,
            source: sourceValue as
              "restream" | "youtube" | "facebook" | "linkedin" | "twitch" | "x",
            externalId,
            authorDisplayName: stringField(payload, "authorDisplayName"),
            authorAvatarUrl: stringField(payload, "authorAvatarUrl") || null,
            body,
            sourceCreatedAt: stringField(payload, "sourceCreatedAt"),
          },
          payload,
          "restream",
        );
        if (result.status === "closed") {
          return Response.json({ error: "Chat is not open for this event." }, { status: 409 });
        }
        if (result.status === "duplicate") return Response.json({ status: "duplicate" });
        return Response.json({ id: result.id, status: result.status }, { status: 202 });
      },
    },
  },
});

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}
