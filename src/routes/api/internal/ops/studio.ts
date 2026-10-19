import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { hostStudioPath, hostStudioUrl } from "@/lib/conference/studio";
import { requirePublicSiteUrl } from "@/lib/stripe/client.server";

export const Route = createFileRoute("/api/internal/ops/studio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const params = new URL(request.url).searchParams;
        const eventId = params.get("eventId")?.trim() ?? "";
        const slug = params.get("slug")?.trim() ?? "";
        if (!eventId && !slug) {
          return Response.json({ error: "eventId or slug is required." }, { status: 400 });
        }

        let query = supabaseAdmin.from("events").select("id, slug, title, status");
        query = eventId ? query.eq("id", eventId) : query.eq("slug", slug);
        const { data: event, error } = await query.maybeSingle();
        if (error) throw error;
        if (!event) return Response.json({ error: "Event not found." }, { status: 404 });

        const studioPath = hostStudioPath(event.slug);
        return Response.json({
          eventId: event.id,
          slug: event.slug,
          title: event.title,
          status: event.status,
          studioPath,
          studioUrl: hostStudioUrl(requirePublicSiteUrl(), event.slug),
          publicLive: event.status === "live",
        });
      },
    },
  },
});
