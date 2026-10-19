import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  contentReviewRequiresNote,
  isContentReviewDecision,
} from "@/lib/operations/content-review";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { parseReviewRequest, reviewRpcErrorResponse } from "@/lib/operations/review-request";

const PROPERTY_REVIEW_COLUMNS =
  "id, business_id, slug, title, description, property_type, address_line1, address_city, address_state, address_country, postal_code, bedrooms, bathrooms, area_sqft, price_minor, currency, cover_path, status, created_by, created_at, updated_at, published_at, archived_at";

export const Route = createFileRoute("/api/internal/ops/properties")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const { data, error } = await supabaseAdmin
          .from("properties")
          .select(PROPERTY_REVIEW_COLUMNS)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return Response.json({ items: data ?? [] });
      },
      PATCH: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const review = await parseReviewRequest(request, {
          entity: "property",
          isDecision: isContentReviewDecision,
          requiresNote: contentReviewRequiresNote,
        });
        if (!review.ok) return review.response;

        const { data, error } = await supabaseAdmin.rpc("review_property", {
          p_property_id: review.id,
          p_decision: review.decision,
          ...(review.note ? { p_note: review.note } : {}),
          ...(request.headers.get("x-request-id")
            ? { p_request_id: request.headers.get("x-request-id")! }
            : {}),
        });
        const errorResponse = reviewRpcErrorResponse(error);
        if (errorResponse) return errorResponse;
        if (error) throw error;
        if (!data) return Response.json({ error: "Property not found." }, { status: 404 });

        return Response.json(data);
      },
    },
  },
});
