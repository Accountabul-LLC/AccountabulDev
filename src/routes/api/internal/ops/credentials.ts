import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  credentialReviewRequiresNote,
  isCredentialReviewDecision,
} from "@/lib/operations/content-review";
import { authorizeOperationsRequest } from "@/lib/operations/auth";
import { parseReviewRequest, reviewRpcErrorResponse } from "@/lib/operations/review-request";

const CREDENTIAL_REVIEW_COLUMNS =
  "id, business_id, credential_type, issuing_authority, identifier, issued_at, expires_at, document_path, private_notes, review_status, reviewed_by, reviewed_at, public_display_approved, submitted_by, created_at, updated_at";

export const Route = createFileRoute("/api/internal/ops/credentials")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const { data, error } = await supabaseAdmin
          .from("business_credentials")
          .select(CREDENTIAL_REVIEW_COLUMNS)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw error;
        return Response.json({ items: data ?? [] });
      },
      PATCH: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const review = await parseReviewRequest(request, {
          entity: "credential",
          isDecision: isCredentialReviewDecision,
          requiresNote: credentialReviewRequiresNote,
        });
        if (!review.ok) return review.response;

        const { data, error } = await supabaseAdmin.rpc("review_business_credential", {
          p_credential_id: review.id,
          p_decision: review.decision,
          ...(review.note ? { p_note: review.note } : {}),
          ...(request.headers.get("x-request-id")
            ? { p_request_id: request.headers.get("x-request-id")! }
            : {}),
        });
        const errorResponse = reviewRpcErrorResponse(error);
        if (errorResponse) return errorResponse;
        if (error) throw error;
        if (!data) return Response.json({ error: "Credential not found." }, { status: 404 });

        return Response.json(data);
      },
    },
  },
});
