import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  hasActiveMembership,
  highestPassAccessType,
  resolveEventEntitlement,
  type EventPassAccessType,
  type MembershipSnapshot,
} from "@/lib/conference/entitlements";
import { sha256Text } from "@/lib/conference/moderation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function loadEntitlement(eventId: string, userId: string | null) {
  // Dynamic, not a top-level import: auth.server.ts reads the request directly
  // and must never be reachable from a client bundle. loadEntitlement is called
  // from route components as well as server handlers, so a static import here
  // would pull getRequest() into the browser graph.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getOptionalEventPassToken } = await import("@/lib/conference/auth.server");
  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select(
      "id, slug, status, access_mode, embed_url, replay_url_path, chat_enabled, speaker_requests_enabled, actual_start_at, provider_record_id, watch_price_minor, allow_watch_purchase, watch_and_chat_price_minor, allow_watch_and_chat_purchase, guest_comment_price_minor, allow_guest_comment, pricing_currency",
    )
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  let membership: MembershipSnapshot | null = null;
  const passAccessTypes: EventPassAccessType[] = [];
  if (userId) {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
      .from("membership_subscriptions")
      .select("status, current_period_end, grace_expires_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (subscription) {
      membership = {
        status: subscription.status as MembershipSnapshot["status"],
        currentPeriodEnd: subscription.current_period_end,
        graceExpiresAt: subscription.grace_expires_at,
      };
    }

    // A user can hold more than one pass for the same event (an upgrade
    // buys a second, better one rather than mutating the first); take the
    // best of everything currently active.
    const { data: passes, error: passError } = await supabaseAdmin
      .from("event_passes")
      .select("access_type")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString());
    if (passError) throw passError;
    for (const pass of passes ?? []) passAccessTypes.push(pass.access_type);
  }
  if (highestPassAccessType(passAccessTypes) === null) {
    const passToken = getOptionalEventPassToken(eventId);
    if (passToken) {
      const tokenHash = await sha256Text(passToken);
      const { data: pass, error: passError } = await supabaseAdmin
        .from("event_passes")
        .select("access_type")
        .eq("event_id", eventId)
        .eq("access_token_hash", tokenHash)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .maybeSingle();
      if (passError) throw passError;
      if (pass) passAccessTypes.push(pass.access_type);
    }
  }

  return {
    event,
    membership,
    entitlement: resolveEventEntitlement({
      accessMode: event.access_mode,
      membership,
      passAccessType: highestPassAccessType(passAccessTypes),
    }),
  };
}

export const getConferencePlayback = createServerFn({ method: "GET" })
  .validator((eventId: string) => {
    if (!UUID.test(eventId)) throw new Error("Invalid event.");
    return eventId;
  })
  .handler(async ({ data: eventId }) => {
    const { getOptionalUserId } = await import("@/lib/conference/auth.server");
    const userId = await getOptionalUserId();
    const { event, entitlement } = await loadEntitlement(eventId, userId);
    const streamable = event.status === "live" || event.status === "replay_available";
    const playbackUrl =
      entitlement.canWatch && streamable
        ? event.status === "replay_available"
          ? event.replay_url_path || event.embed_url
          : event.embed_url
        : null;

    const { livePhase, countdownRemainingMs } = await import("@/lib/conference/live-session");
    const snapshot = {
      status: event.status,
      actualStartAt: event.actual_start_at,
      meetingId: event.provider_record_id,
    };

    return {
      entitlement,
      playbackUrl,
      requiresSignIn: !userId && event.access_mode !== "public",
      phase: livePhase(snapshot),
      // The audience learns only how long is left, never the meeting id.
      countdownMsRemaining: entitlement.canWatch ? countdownRemainingMs(snapshot.actualStartAt) : 0,
      startsAt: entitlement.canWatch ? event.actual_start_at : null,
    };
  });

export const requestSpeakerAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { eventId: string; topic: string }) => {
    if (!UUID.test(input.eventId)) throw new Error("Invalid event.");
    const topic = input.topic.normalize("NFKC").trim();
    if (!topic || topic.length > 500)
      throw new Error("Describe your topic in 500 characters or fewer.");
    return { eventId: input.eventId, topic };
  })
  .handler(async ({ data, context }) => {
    const { event, membership } = await loadEntitlement(data.eventId, context.userId);
    if (
      !hasActiveMembership(membership) ||
      !event.speaker_requests_enabled ||
      (event.status !== "scheduled" && event.status !== "live")
    ) {
      throw new Error(
        "Speaker requests are unavailable, or your active subscription could not be confirmed.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: request, error } = await supabaseAdmin
      .from("speaker_requests")
      .upsert(
        { event_id: data.eventId, user_id: context.userId, topic: data.topic, status: "pending" },
        { onConflict: "event_id,user_id" },
      )
      .select("id, status")
      .single();
    if (error) throw error;
    const requestId = request["id"];
    const status = request["status"];
    if (typeof requestId !== "string" || typeof status !== "string") {
      throw new Error("Speaker request could not be confirmed.");
    }
    return { id: requestId, status };
  });

/**
 * Issues a viewer-scoped RealtimeKit token. The preset is chosen by the server,
 * and a token is only ever minted for an entitled caller in a room that is
 * already public — green room and countdown never reach the audience.
 */
export const joinLiveMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((eventId: string) => {
    if (!UUID.test(eventId)) throw new Error("Invalid event.");
    return eventId;
  })
  .handler(async ({ data: eventId, context }) => {
    const { event, entitlement } = await loadEntitlement(eventId, context.userId);
    const { viewerMayJoinMedia } = await import("@/lib/conference/live-session");
    const snapshot = {
      status: event.status,
      actualStartAt: event.actual_start_at,
      meetingId: event.provider_record_id,
    };
    if (!viewerMayJoinMedia(snapshot, entitlement.canWatch)) {
      throw new Error("This room is not open to you yet.");
    }

    // A host removal is an event-scoped ban; rejoining must not undo it.
    const { isRemovedFromLiveRoom } = await import("@/lib/conference/entitlement.server");
    if (await isRemovedFromLiveRoom(eventId, context.userId)) {
      throw new Error("You were removed from this live room.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const { issueParticipantToken } = await import("@/lib/conference/realtimekit.server");
    const token = await issueParticipantToken({
      meetingId: snapshot.meetingId!,
      userId: context.userId,
      displayName: profile?.display_name?.trim() || "Accountabul guest",
      role: "viewer",
    });

    return {
      authToken: token.authToken,
      participantId: token.participantId,
      canTakeStage: entitlement.canTakeStage,
    };
  });
