import { createFileRoute } from "@tanstack/react-router";

import type { Json } from "@/integrations/supabase/types";

import { MAX_SEED_MESSAGES_PER_ROOM } from "@/lib/community-chat/seed-conversation";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

/**
 * Development chat seeding, behind the operations bearer token.
 *
 * GET    room and seed counts, so the console can report before and after.
 * POST   write `messages_per_room` messages into every active room.
 * DELETE remove seeded messages, optionally a single batch.
 *
 * The environment gate runs before anything else, so in production this route
 * answers 404 exactly as if it were not deployed. Normal members never reach it
 * either way: every internal ops route requires OPERATIONS_API_KEY.
 */
export const Route = createFileRoute("/api/internal/ops/community-chat-seed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = await guard(request);
        if (denied) return denied;
        const { describeSeedState } = await import("@/lib/community-chat/seed.server");
        return Response.json(await describeSeedState());
      },

      POST: async ({ request }) => {
        const denied = await guard(request);
        if (denied) return denied;

        const payload = await readJson(request);
        const requested = payload["messages_per_room"];
        if (requested !== undefined && !isPositiveInteger(requested)) {
          return Response.json(
            {
              error: `messages_per_room must be a whole number between 1 and ${MAX_SEED_MESSAGES_PER_ROOM}.`,
            },
            { status: 400 },
          );
        }

        const { seedCommunityChat } = await import("@/lib/community-chat/seed.server");
        const summary = await seedCommunityChat(
          isPositiveInteger(requested) ? { messagesPerRoom: requested } : {},
        );
        await writeAudit(request, "ops.community_chat.seeded", summary.batch_id, {
          rooms_populated: summary.rooms_populated,
          messages_created: summary.messages_created,
          personas_used: summary.personas_used,
          messages_per_room: summary.messages_per_room,
        });
        return Response.json(summary, { status: 201 });
      },

      DELETE: async ({ request }) => {
        const denied = await guard(request);
        if (denied) return denied;

        const batchId = await readBatchId(request);
        if (batchId === null) {
          return Response.json({ error: "batch_id must be a valid uuid." }, { status: 400 });
        }

        const { clearSeededCommunityChat } = await import("@/lib/community-chat/seed.server");
        const summary = await clearSeededCommunityChat(batchId ? { batchId } : {});
        await writeAudit(request, "ops.community_chat.seed_cleared", batchId || "all", {
          messages_removed: summary.messages_removed,
          batches_cleared: summary.batches_cleared,
        });
        return Response.json(summary);
      },
    },
  },
});

/** Environment gate first, then the operations bearer token. */
async function guard(request: Request) {
  const { checkSeedingAllowed } = await import("@/lib/community-chat/seed.server");
  const gate = checkSeedingAllowed();
  if (!gate.ok) return Response.json({ error: gate.message }, { status: gate.status });

  const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
  return null;
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SEED_MESSAGES_PER_ROOM
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Returns "" for "clear everything", a uuid to scope, or null when malformed. */
async function readBatchId(request: Request) {
  const fromQuery = new URL(request.url).searchParams.get("batch_id")?.trim();
  const payload = fromQuery ? "" : await readJson(request).then((body) => body["batch_id"]);
  const candidate = fromQuery || (typeof payload === "string" ? payload.trim() : "");
  if (!candidate) return "";
  return UUID.test(candidate) ? candidate : null;
}

async function writeAudit(request: Request, action: string, targetId: string, diff: Json) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_log").insert({
    action,
    target_table: "community_messages",
    target_id: UUID.test(targetId) ? targetId : null,
    request_id: request.headers.get("x-request-id"),
    diff,
  });
  if (error) throw error;
}
