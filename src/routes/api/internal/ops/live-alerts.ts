import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchHopOnAlerts } from "@/lib/live/alerts.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { requirePublicSiteUrl } from "@/lib/stripe/client.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

/**
 * Sends the schedule-time announcement for an event. The go-live alert is sent
 * separately by the host studio; the delivery ledger keeps the two apart, so
 * calling this twice never double-announces.
 */
export const Route = createFileRoute("/api/internal/ops/live-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        let body: { eventId?: unknown };
        try {
          body = (await request.json()) as { eventId?: unknown };
        } catch {
          return Response.json({ error: "Body must be JSON." }, { status: 400 });
        }
        const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
        if (!UUID.test(eventId)) {
          return Response.json({ error: "eventId is required." }, { status: 400 });
        }

        const { data: event, error } = await supabaseAdmin
          .from("events")
          .select("id, slug, title, status, scheduled_start_at")
          .eq("id", eventId)
          .maybeSingle();
        if (error) throw error;
        if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
        if (event.status !== "scheduled" || !event.scheduled_start_at) {
          return Response.json(
            { error: "Only a scheduled event with a start time can be announced." },
            { status: 409 },
          );
        }

        const result = await dispatchHopOnAlerts({
          eventId: event.id,
          slug: event.slug,
          title: event.title,
          origin: requirePublicSiteUrl(),
          kind: "scheduled",
          startsAt: event.scheduled_start_at,
        });
        return Response.json({ eventId: event.id, kind: "scheduled", ...result });
      },
    },
  },
});
