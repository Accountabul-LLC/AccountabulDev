import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { getOptionalUserId } from "@/lib/conference/auth.server";
import { PAID_COMMENT_MAX_LENGTH, sha256Text } from "@/lib/conference/moderation";
import { moderateComment } from "@/lib/conference/moderation.server";
import { rateLimitResponse } from "@/lib/security/rate-limit.server";

export const Route = createFileRoute("/api/public/paid-comments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await rateLimitResponse(request, "paid-comments", 8, 10 * 60_000);
        if (limited) return limited;
        const payload = await readPayload(request);
        if (!payload.ok) return Response.json({ error: payload.error }, { status: 400 });

        const { data: event, error: eventError } = await supabaseAdmin
          .from("events")
          .select("id, status, chat_enabled")
          .eq("id", payload.value.eventId)
          .maybeSingle();
        if (eventError) throw eventError;
        if (!event || !event.chat_enabled || event.status !== "live") {
          return Response.json(
            { error: "Paid comments are unavailable for this event." },
            { status: 409 },
          );
        }

        const { data: standards, error: standardsError } = await supabaseAdmin
          .from("community_standards_versions")
          .select("id, version")
          .eq("is_active", true)
          .order("published_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (standardsError) throw standardsError;
        if (!standards)
          return Response.json({ error: "Community Standards are unavailable." }, { status: 503 });
        if (payload.value.standardsVersion !== standards.version) {
          return Response.json(
            { error: "Community Standards changed. Review and accept the current version." },
            { status: 409 },
          );
        }

        const moderation = await moderateComment(payload.value.body);
        const bodySha256 = await sha256Text(payload.value.body);
        const userId = await getOptionalUserId();
        const status = moderation.provider === "unavailable" ? "screening" : "awaiting_moderator";
        const { data: comment, error } = await supabaseAdmin
          .from("paid_comments")
          .insert({
            event_id: event.id,
            user_id: userId,
            guest_display_name: payload.value.displayName,
            guest_email: payload.value.email,
            body: payload.value.body,
            body_sha256: bodySha256,
            standards_version_id: standards.id,
            status,
            automated_moderation: moderation as unknown as Json,
          })
          .select("id, status")
          .single();
        if (error) throw error;

        return Response.json(
          {
            id: comment["id"],
            status: comment["status"],
            standardsVersion: standards.version,
            message:
              moderation.provider === "unavailable"
                ? "Moderation is temporarily unavailable. The comment is safely held and cannot be charged."
                : "Submitted for human review. You will only receive checkout access after approval.",
          },
          { status: 202 },
        );
      },
    },
  },
});

async function readPayload(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return { ok: false as const, error: "Invalid JSON." };
  }
  if (!value || typeof value !== "object") return { ok: false as const, error: "Invalid request." };
  const record = value as Record<string, unknown>;
  const eventId = typeof record["eventId"] === "string" ? record["eventId"] : "";
  const displayName = typeof record["displayName"] === "string" ? record["displayName"].trim() : "";
  const email = typeof record["email"] === "string" ? record["email"].trim().toLowerCase() : "";
  const body = typeof record["body"] === "string" ? record["body"].normalize("NFKC").trim() : "";
  const standardsVersion =
    typeof record["standardsVersion"] === "string" ? record["standardsVersion"].trim() : "";
  if (
    !eventId ||
    !displayName ||
    displayName.length > 80 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !standardsVersion
  ) {
    return { ok: false as const, error: "Event, display name, and valid email are required." };
  }
  if (!body || body.length > PAID_COMMENT_MAX_LENGTH) {
    return {
      ok: false as const,
      error: `Comments must be 1-${PAID_COMMENT_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true as const, value: { eventId, displayName, email, body, standardsVersion } };
}
