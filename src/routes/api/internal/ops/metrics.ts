import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

export const Route = createFileRoute("/api/internal/ops/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const eventId = new URL(request.url).searchParams.get("eventId");
        if (!eventId) return Response.json({ error: "eventId is required." }, { status: 400 });
        const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const [presence, chat, passes, payments] = await Promise.all([
          supabaseAdmin
            .from("event_presence")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId)
            .gte("last_seen_at", cutoff),
          supabaseAdmin
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId)
            .eq("moderation_status", "approved"),
          supabaseAdmin
            .from("event_passes")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId)
            .eq("status", "active"),
          supabaseAdmin
            .from("payment_records")
            .select("amount_minor, kind")
            .eq("event_id", eventId)
            .eq("status", "paid"),
        ]);
        for (const result of [presence, chat, passes, payments])
          if (result.error) throw result.error;
        const paid = payments.data ?? [];
        return Response.json({
          eventId,
          concurrentViewers: presence.count ?? 0,
          publishedChatMessages: chat.count ?? 0,
          activePasses: passes.count ?? 0,
          tipsTotalMinor: paid
            .filter((item) => item.kind === "tip")
            .reduce((sum, item) => sum + Number(item.amount_minor), 0),
          measuredAt: new Date().toISOString(),
        });
      },
    },
  },
});
