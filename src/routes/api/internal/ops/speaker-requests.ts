import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sha256Text } from "@/lib/conference/moderation";
import { speakerJoinPath } from "@/lib/conference/speaker-join";
import { createProtectedSpeakerLink } from "@/lib/conference/speaker-links.server";
import { authorizeOperationsRequest } from "@/lib/operations/auth";

export const Route = createFileRoute("/api/internal/ops/speaker-requests")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const { data, error } = await supabaseAdmin
          .from("speaker_requests")
          .select(
            "id, event_id, user_id, topic, status, reviewed_by, reviewed_at, guest_link_expires_at, created_at, updated_at",
          )
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const requests = data ?? [];
        const userIds = [...new Set(requests.map((item) => item["user_id"]).filter(isString))];
        const profiles = userIds.length
          ? await supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds)
          : { data: [], error: null };
        if (profiles.error) throw profiles.error;
        const displayNames = new Map(
          (profiles.data ?? []).map((profile) => [profile.id, profile.display_name]),
        );
        return Response.json({
          items: requests.map((item) => ({
            ...item,
            display_name: displayNames.get(String(item["user_id"])) ?? null,
            requested_at: item["created_at"],
            decided_at: item["reviewed_at"],
          })),
        });
      },
      PATCH: async ({ request }) => {
        const auth = authorizeOperationsRequest(request, process.env["OPERATIONS_API_KEY"]);
        if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.status });
        const payload = (await request.json()) as Record<string, unknown>;
        const id = typeof payload["id"] === "string" ? payload["id"] : "";
        const decision = payload["decision"];
        if (!id || (decision !== "approve" && decision !== "reject")) {
          return Response.json(
            { error: "id and approve/reject decision are required." },
            { status: 400 },
          );
        }
        const guestUrl = typeof payload["guestUrl"] === "string" ? payload["guestUrl"] : "";
        const protectedLink =
          decision === "approve" ? await createProtectedSpeakerLink(guestUrl) : null;
        const status = decision === "approve" ? "link_issued" : "rejected";
        const { data, error } = await supabaseAdmin
          .from("speaker_requests")
          .update({
            status,
            reviewed_at: new Date().toISOString(),
            ...(protectedLink
              ? {
                  guest_link_token_hash: await sha256Text(protectedLink.token),
                  guest_link_ciphertext: protectedLink.ciphertext,
                  guest_link_iv: protectedLink.iv,
                  guest_link_expires_at: protectedLink.expiresAt,
                }
              : {}),
          })
          .eq("id", id)
          .eq("status", "pending")
          .select("id, event_id, user_id, status, reviewed_at")
          .maybeSingle();
        if (error) throw error;
        if (!data)
          return Response.json({ error: "Request is no longer pending." }, { status: 409 });
        const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
          action: `ops.speaker_request.${status}`,
          target_table: "speaker_requests",
          target_id: id,
          request_id: request.headers.get("x-request-id"),
        });
        if (auditError) throw auditError;
        return Response.json({
          ...data,
          protectedPath: protectedLink ? speakerJoinPath(id, protectedLink.token) : null,
          expiresAt: protectedLink?.expiresAt ?? null,
        });
      },
    },
  },
});

function isString(value: unknown): value is string {
  return typeof value === "string";
}
