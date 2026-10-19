import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canHostLiveStudio, hostStudioPath } from "@/lib/conference/studio";
import { UUID_V1_TO_V8 as UUID_PATTERN } from "../validation/patterns.ts";

export async function userCanHostStudio(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [admin, moderator] = await Promise.all([
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "moderator" }),
  ]);
  if (admin.error) throw admin.error;
  if (moderator.error) throw moderator.error;
  return canHostLiveStudio([
    ...(admin.data ? (["admin"] as const) : []),
    ...(moderator.data ? (["moderator"] as const) : []),
  ]);
}

export const getHostStudio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((slug: string) => {
    const value = slug.trim();
    if (!value || value.length > 120) throw new Error("Invalid event.");
    return value;
  })
  .handler(async ({ data: slug, context }) => {
    if (!(await userCanHostStudio(context.userId))) {
      throw new Error("Host studio is limited to Accountabul operators.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event, error } = await supabaseAdmin
      .from("events")
      .select("id, slug, title, status, scheduled_start_at")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!event) throw new Error("Event not found.");

    return {
      event,
      studioPath: hostStudioPath(event.slug),
      audienceCanSeeHost: event.status === "live",
    };
  });

const HOST_DISPLAY_FALLBACK = "Accountabul host";

async function loadLiveSession(slug: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: event, error } = await supabaseAdmin
    .from("events")
    .select("id, slug, title, status, actual_start_at, provider, provider_record_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!event) throw new Error("Event not found.");
  return event;
}

async function requireHost(userId: string) {
  if (!(await userCanHostStudio(userId))) {
    throw new Error("Host studio is limited to Accountabul operators.");
  }
}

async function hostDisplayName(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.display_name?.trim() || HOST_DISPLAY_FALLBACK;
}

/**
 * Arms the ten-second countdown. Creates the RealtimeKit meeting if needed and
 * issues the host token, but leaves the event `scheduled` so the audience still
 * cannot receive media.
 */
export const beginLiveCountdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((slug: string) => {
    const value = slug.trim();
    if (!value || value.length > 120) throw new Error("Invalid event.");
    return value;
  })
  .handler(async ({ data: slug, context }) => {
    await requireHost(context.userId);
    const event = await loadLiveSession(slug);

    const { canBeginCountdown, countdownTargetFrom } =
      await import("@/lib/conference/live-session");
    if (!canBeginCountdown(event.status)) {
      throw new Error(`This event is ${event.status}. Only a scheduled event can go live.`);
    }

    const { createLiveMeeting, issueParticipantToken } =
      await import("@/lib/conference/realtimekit.server");
    const meetingId = event.provider_record_id ?? (await createLiveMeeting(event.title));
    const token = await issueParticipantToken({
      meetingId,
      userId: context.userId,
      displayName: await hostDisplayName(context.userId),
      role: "host",
    });

    const startsAt = countdownTargetFrom();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("events")
      .update({
        provider: "realtimekit",
        provider_record_id: meetingId,
        actual_start_at: startsAt,
      })
      .eq("id", event.id)
      .eq("status", "scheduled");
    if (error) throw error;

    return { startsAt, meetingId, authToken: token.authToken, participantId: token.participantId };
  });

/**
 * Commits the room to public. Refuses until the armed countdown has actually
 * reached zero, so the ten seconds cannot be skipped from the browser.
 */
export const goLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((slug: string) => {
    const value = slug.trim();
    if (!value || value.length > 120) throw new Error("Invalid event.");
    return value;
  })
  .handler(async ({ data: slug, context }) => {
    await requireHost(context.userId);
    const event = await loadLiveSession(slug);

    const { canGoLive } = await import("@/lib/conference/live-session");
    if (
      !canGoLive({
        status: event.status,
        actualStartAt: event.actual_start_at,
        meetingId: event.provider_record_id,
      })
    ) {
      throw new Error("The countdown has not finished. Arm the countdown and wait for zero.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("events")
      .update({ status: "live" })
      .eq("id", event.id)
      .eq("status", "scheduled")
      .select("id, status")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("This event is no longer scheduled.");

    // Hop-on alerts must never be able to fail the go live itself.
    let alerts = { recipients: 0, sent: 0 };
    try {
      const { dispatchHopOnAlerts } = await import("@/lib/live/alerts.server");
      const { requirePublicSiteUrl } = await import("@/lib/stripe/client.server");
      alerts = await dispatchHopOnAlerts({
        eventId: event.id,
        slug: event.slug,
        title: event.title,
        origin: requirePublicSiteUrl(),
      });
    } catch (caught) {
      console.error("[live] hop-on alerts failed", caught);
    }

    return { status: updated.status, meetingId: event.provider_record_id, alerts };
  });

/** Ends the public stream. The meeting id is kept for replay reconciliation. */
export const endLiveStream = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((slug: string) => {
    const value = slug.trim();
    if (!value || value.length > 120) throw new Error("Invalid event.");
    return value;
  })
  .handler(async ({ data: slug, context }) => {
    await requireHost(context.userId);
    const event = await loadLiveSession(slug);

    const { canEndStream } = await import("@/lib/conference/live-session");
    if (!canEndStream(event.status)) throw new Error("This event is not live.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("events")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("status", "live");
    if (error) throw error;
    return { status: "ended" as const };
  });

/**
 * Re-issues the host media token, so reopening the studio mid-broadcast
 * rejoins the same meeting instead of stranding the stream.
 */
export const getHostMediaToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((slug: string) => {
    const value = slug.trim();
    if (!value || value.length > 120) throw new Error("Invalid event.");
    return value;
  })
  .handler(async ({ data: slug, context }) => {
    await requireHost(context.userId);
    const event = await loadLiveSession(slug);
    if (!event.provider_record_id) throw new Error("This event has no live room yet.");
    if (event.status !== "live") throw new Error("This event is not live.");

    const { issueParticipantToken } = await import("@/lib/conference/realtimekit.server");
    const token = await issueParticipantToken({
      meetingId: event.provider_record_id,
      userId: context.userId,
      displayName: await hostDisplayName(context.userId),
      role: "host",
    });
    return { authToken: token.authToken, meetingId: event.provider_record_id };
  });

/**
 * Authorizes a stage invite before the host grants media access.
 *
 * The browser decides who to click; the server decides who is allowed. A
 * commenter with no live entitlement can never be pulled onto camera, and
 * imported external comments have no Accountabul user to invite at all.
 */
export const confirmStageInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { slug: string; targetUserId: string }) => {
    const slug = input.slug.trim();
    if (!slug || slug.length > 120) throw new Error("Invalid event.");
    if (!UUID_PATTERN.test(input.targetUserId)) throw new Error("Invalid participant.");
    return { slug, targetUserId: input.targetUserId };
  })
  .handler(async ({ data, context }) => {
    await requireHost(context.userId);
    const event = await loadLiveSession(data.slug);
    if (event.status !== "live") throw new Error("Stage invites are only available while live.");

    const { loadEventEntitlementFor } = await import("@/lib/conference/entitlement.server");
    const entitlement = await loadEventEntitlementFor(event.id, data.targetUserId);
    if (!entitlement.canTakeStage) {
      throw new Error("That person is not entitled to take the stage in this room.");
    }

    return { ok: true as const, targetUserId: data.targetUserId };
  });

/**
 * Removes someone from the live room for the rest of this event. Recorded as an
 * event-scoped ban, so their media token is refused on rejoin and their chat is
 * closed. The browser then disconnects them from the meeting.
 */
export const removeFromLiveRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { slug: string; targetUserId: string }) => {
    const slug = input.slug.trim();
    if (!slug || slug.length > 120) throw new Error("Invalid event.");
    if (!UUID_PATTERN.test(input.targetUserId)) throw new Error("Invalid participant.");
    return { slug, targetUserId: input.targetUserId };
  })
  .handler(async ({ data, context }) => {
    await requireHost(context.userId);
    if (data.targetUserId === context.userId) {
      throw new Error("You cannot remove yourself. End the stream instead.");
    }
    const event = await loadLiveSession(data.slug);
    if (event.status !== "live") throw new Error("Removal is only available while live.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("chat_moderation_actions").insert({
      event_id: event.id,
      target_user_id: data.targetUserId,
      actor_user_id: context.userId,
      action: "ban",
      reason: "Removed from the live room by the host.",
    });
    if (error) throw error;
    return { ok: true as const, targetUserId: data.targetUserId };
  });
