import { createFileRoute } from "@tanstack/react-router";

import { sha256Text } from "@/lib/conference/moderation";
import { rateLimitResponse } from "@/lib/security/rate-limit.server";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

export const Route = createFileRoute("/api/public/speakers/join")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await rateLimitResponse(request, "speaker-join", 10, 10 * 60_000);
        if (limited) return limited;

        const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const requestId = typeof payload?.["request"] === "string" ? payload["request"] : "";
        const token = typeof payload?.["token"] === "string" ? payload["token"] : "";
        if (!UUID.test(requestId) || !token) {
          return Response.json({ error: "Invalid speaker link" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptSpeakerLink } = await import("@/lib/conference/speaker-links.server");
        const { data: speaker, error } = await supabaseAdmin
          .from("speaker_requests")
          .select(
            "id, status, guest_link_token_hash, guest_link_ciphertext, guest_link_iv, guest_link_expires_at",
          )
          .eq("id", requestId)
          .single();
        if (error) throw error;
        if (
          speaker["status"] !== "link_issued" ||
          speaker["guest_link_token_hash"] !== (await sha256Text(token)) ||
          typeof speaker["guest_link_expires_at"] !== "string" ||
          new Date(speaker["guest_link_expires_at"] as string) <= new Date() ||
          typeof speaker["guest_link_ciphertext"] !== "string" ||
          typeof speaker["guest_link_iv"] !== "string"
        ) {
          return Response.json({ error: "Speaker link is invalid or expired" }, { status: 410 });
        }

        const destination = await decryptSpeakerLink(
          speaker["guest_link_ciphertext"] as string,
          speaker["guest_link_iv"] as string,
        );
        const { data: consumed, error: consumeError } = await supabaseAdmin
          .from("speaker_requests")
          .update({ status: "expired", guest_link_token_hash: null })
          .eq("id", requestId)
          .eq("status", "link_issued")
          .select("id")
          .maybeSingle();
        if (consumeError) throw consumeError;
        if (!consumed) {
          return Response.json({ error: "Speaker link was already used" }, { status: 410 });
        }
        return Response.json({ destination });
      },
    },
  },
});
