import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Text } from "@/lib/conference/moderation";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

export const Route = createFileRoute("/api/internal/ops/moderation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const [paidComments, quarantinedMessages] = await Promise.all([
          supabaseAdmin
            .from("paid_comments")
            .select(
              "id, event_id, guest_display_name, body, body_sha256, status, automated_moderation, created_at",
            )
            .in("status", ["screening", "awaiting_moderator"])
            .order("created_at", { ascending: true })
            .limit(100),
          supabaseAdmin
            .from("chat_messages")
            .select(
              "id, event_id, source, external_id, author_display_name, author_badge, body, content_sha256, moderation_status, metadata, created_at",
            )
            .in("moderation_status", ["pending", "quarantined"])
            .order("created_at", { ascending: true })
            .limit(100),
        ]);
        if (paidComments.error) throw paidComments.error;
        if (quarantinedMessages.error) throw quarantinedMessages.error;
        return Response.json({
          paidComments: (paidComments.data ?? []).map((comment) => ({
            ...comment,
            display_name: comment.guest_display_name,
          })),
          quarantinedMessages: (quarantinedMessages.data ?? []).map((message) => ({
            ...message,
            display_name: message.author_display_name,
            status: message.moderation_status,
          })),
        });
      },
      PATCH: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });

        const payload = (await request.json()) as Record<string, unknown>;
        const id = typeof payload["id"] === "string" ? payload["id"] : "";
        const decision = payload["decision"];
        const queue = payload["queue"] === "chat" ? "chat" : "paid_comment";
        const moderatorUserId = await resolveOperationsModeratorId();
        const note = typeof payload["note"] === "string" ? payload["note"].slice(0, 500) : null;
        if (!id || (decision !== "approve" && decision !== "reject")) {
          return Response.json(
            { error: "id and approve/reject decision are required." },
            { status: 400 },
          );
        }

        if (queue === "chat") {
          const { data: updated, error } = await supabaseAdmin
            .from("chat_messages")
            .update(
              decision === "approve"
                ? {
                    moderation_status: "approved",
                    is_hidden: false,
                    published_at: new Date().toISOString(),
                  }
                : { moderation_status: "rejected", is_hidden: true, published_at: null },
            )
            .eq("id", id)
            .in("moderation_status", ["pending", "quarantined"])
            .select("id, moderation_status, published_at")
            .maybeSingle();
          if (error) throw error;
          if (!updated)
            return Response.json(
              { error: "Message is no longer awaiting review." },
              { status: 409 },
            );
          return Response.json(updated);
        }

        const { data: comment, error: commentError } = await supabaseAdmin
          .from("paid_comments")
          .select("id, body, body_sha256, status")
          .eq("id", id)
          .single();
        if (commentError) throw commentError;
        const body = comment["body"];
        const recordedHash = comment["body_sha256"];
        if (
          typeof body !== "string" ||
          typeof recordedHash !== "string" ||
          (await sha256Text(body)) !== recordedHash
        ) {
          return Response.json(
            { error: "Comment text hash mismatch. Approval is invalid." },
            { status: 409 },
          );
        }
        if (comment["status"] !== "screening" && comment["status"] !== "awaiting_moderator") {
          return Response.json({ error: "Comment is no longer awaiting review." }, { status: 409 });
        }
        if (decision === "approve" && comment["status"] === "screening") {
          return Response.json(
            { error: "Automated moderation has not completed. Approval fails closed." },
            { status: 503 },
          );
        }

        const patch =
          decision === "approve"
            ? {
                status: "approved" as const,
                approved_body_sha256: recordedHash,
                moderator_user_id: moderatorUserId,
                moderator_note: note,
                moderated_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              }
            : {
                status: "rejected" as const,
                approved_body_sha256: null,
                moderator_user_id: moderatorUserId,
                moderator_note: note,
                moderated_at: new Date().toISOString(),
              };
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("paid_comments")
          .update(patch)
          .eq("id", id)
          .select("id, status, expires_at")
          .single();
        if (updateError) throw updateError;
        return Response.json(updated);
      },
    },
  },
});

async function resolveOperationsModeratorId() {
  const email = process.env["OPERATIONS_OPERATOR_EMAIL"]?.trim().toLowerCase();
  if (!email) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
