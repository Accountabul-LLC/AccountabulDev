import { createFileRoute } from "@tanstack/react-router";

import { businessReviewRequiresNote, isBusinessReviewDecision } from "@/lib/business-review";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { getOpsDataClient } from "@/lib/operations/ops-data-client.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";
import { trimmedString as stringValue } from "@/lib/validation/strings";

const BUSINESS_REVIEW_COLUMNS =
  "id, slug, display_name, handle, headline, description, logo_path, cover_path, website_url, public_email, public_phone, year_founded, employee_count_range, primary_industry, address_city, address_state, address_country, service_areas, profile_status, verification_status, public_profile_enabled, created_at, updated_at, published_at, created_by";

export const Route = createFileRoute("/api/internal/ops/businesses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const db = await getOpsDataClient();
        const { data, error } = await db
          .from("businesses")
          .select(BUSINESS_REVIEW_COLUMNS)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return Response.json({ items: data ?? [] });
      },
      PATCH: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        let payload: Record<string, unknown>;
        try {
          const parsed: unknown = await request.json();
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return Response.json(
              { error: "A JSON object review request is required." },
              { status: 400 },
            );
          }
          payload = parsed as Record<string, unknown>;
        } catch {
          return Response.json(
            { error: "A valid JSON review request is required." },
            { status: 400 },
          );
        }
        const id = stringValue(payload, "id");
        const decision = stringValue(payload, "decision");
        const note = stringValue(payload, "note");
        if (!UUID.test(id) || !isBusinessReviewDecision(decision)) {
          return Response.json(
            { error: "A valid business and review decision are required." },
            {
              status: 400,
            },
          );
        }
        if (businessReviewRequiresNote(decision) && !note) {
          return Response.json(
            { error: "A review note is required for this decision." },
            { status: 400 },
          );
        }
        if (note.length > 2_000) {
          return Response.json(
            { error: "A review note may not exceed 2,000 characters." },
            { status: 400 },
          );
        }

        const db = await getOpsDataClient();
        const { data, error } = await db.rpc("review_business", {
          p_business_id: id,
          p_decision: decision,
          ...(note ? { p_note: note } : {}),
          ...(request.headers.get("x-request-id")
            ? { p_request_id: request.headers.get("x-request-id")! }
            : {}),
        });
        if (error?.code === "22023") {
          return Response.json({ error: error.message }, { status: 409 });
        }
        if (error?.code === "42501") {
          return Response.json(
            { error: "This review decision is not authorized." },
            { status: 403 },
          );
        }
        if (error) throw error;
        if (!data) return Response.json({ error: "Business not found." }, { status: 404 });

        return Response.json(data);
      },
    },
  },
});
