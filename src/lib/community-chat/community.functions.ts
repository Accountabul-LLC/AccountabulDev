import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runAfterResponse } from "@/lib/background.server";
import { sha256Text } from "@/lib/conference/moderation";
import {
  avatarFromAccountMetadata,
  COMMUNITY_MESSAGE_RATE_LIMIT,
  COMMUNITY_MESSAGE_RATE_WINDOW_MS,
  policyAcceptanceRequired,
  resolveAuthorBadge,
  validateMessageBody,
} from "@/lib/community-chat/chat";
import {
  describeRestriction,
  DUPLICATE_WINDOW_MS,
  isFlagCategory,
  REPORT_DETAIL_MAX_LENGTH,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  type FlagCategory,
} from "@/lib/community-chat/safeguards";
import { throwIfRateLimited } from "@/lib/security/rate-limit.server";
import { UUID_V1_TO_V8 as UUID } from "../validation/patterns.ts";

/**
 * Post one message to a community room. Publish-first.
 *
 * The message is published in the same request that receives it. The only
 * checks on this path are cheap gates that never read the message's meaning:
 * a verified session, room access, an active mute or ban, the chat policy,
 * the rate limit, and exact-duplicate flooding. Content screening runs after
 * the response (see screenCommunityMessage) and can flag or hide the message
 * later; it never delays or blocks the send.
 */
export const postCommunityMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { roomId: string; body: string; attemptId: string }) => {
    if (!UUID.test(input.roomId) || !UUID.test(input.attemptId)) {
      throw new Error("Invalid message attempt.");
    }
    const validated = validateMessageBody(input.body);
    if (!validated.ok) throw new Error(validated.error);
    return { ...input, body: validated.body };
  })
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await throwIfRateLimited(
      `community-message:${userId}:${data.roomId}`,
      COMMUNITY_MESSAGE_RATE_LIMIT,
      COMMUNITY_MESSAGE_RATE_WINDOW_MS,
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const contentHash = await sha256Text(data.body);

    const [
      accessResult,
      restrictionResult,
      policyResult,
      acceptancesResult,
      duplicateResult,
      profileResult,
      accountResult,
      adminResult,
      moderatorResult,
      vendorResult,
    ] = await Promise.all([
      supabaseAdmin.rpc("can_access_community_room", {
        _room_id: data.roomId,
        _user_id: userId,
      }),
      supabaseAdmin.rpc("community_chat_restriction", {
        _room_id: data.roomId,
        _user_id: userId,
      }),
      supabaseAdmin
        .from("community_chat_policy_versions")
        .select("id")
        .eq("is_active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("community_chat_policy_acceptances")
        .select("policy_version_id")
        .eq("user_id", userId),
      supabaseAdmin
        .from("community_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("room_id", data.roomId)
        .eq("content_sha256", contentHash)
        .gt("created_at", new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString())
        .limit(1),
      supabaseAdmin.from("profiles").select("display_name, handle").eq("id", userId).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin.rpc("has_role", { _role: "admin", _user_id: userId }),
      supabaseAdmin.rpc("has_role", { _role: "moderator", _user_id: userId }),
      supabaseAdmin.rpc("is_verified_vendor", { _user_id: userId }),
    ]);
    for (const result of [
      accessResult,
      restrictionResult,
      policyResult,
      acceptancesResult,
      duplicateResult,
      profileResult,
      adminResult,
      moderatorResult,
      vendorResult,
    ]) {
      if (result.error) throw result.error;
    }

    if (!accessResult.data) throw new Error("This room is not open to your account.");
    const restriction = restrictionResult.data?.[0];
    if (restriction) throw new Error(describeRestriction(restriction));
    const acceptedVersionIds = (acceptancesResult.data ?? []).map((row) => row.policy_version_id);
    if (policyAcceptanceRequired(policyResult.data, acceptedVersionIds)) {
      throw new Error("Accept the Chat Policy before posting.");
    }
    if ((duplicateResult.data ?? []).length > 0) {
      throw new Error("You just sent that message.");
    }

    // A missing account photo is not a reason to refuse the message.
    const authorAvatarUrl = accountResult.error
      ? null
      : avatarFromAccountMetadata(accountResult.data.user?.user_metadata);

    const now = new Date().toISOString();
    const { data: message, error } = await supabaseAdmin
      .from("community_messages")
      .insert({
        room_id: data.roomId,
        user_id: userId,
        body: data.body,
        client_attempt_id: data.attemptId,
        author_display_name: profileResult.data?.display_name ?? null,
        author_handle: profileResult.data?.handle ?? null,
        author_avatar_url: authorAvatarUrl,
        author_badge: resolveAuthorBadge({
          isAdmin: adminResult.data === true,
          isModerator: moderatorResult.data === true,
          isVerifiedVendor: vendorResult.data === true,
        }),
        moderation_status: "approved",
        published_at: now,
        content_sha256: contentHash,
      })
      .select("id, published_at")
      .single();
    if (error) {
      // The unique client_attempt_id turns a double submit into a no-op rather
      // than a duplicate message.
      if (error.code === "23505") return { messageId: null, publishedAt: null };
      throw error;
    }

    runAfterResponse("community-chat-screening", async () => {
      const { screenCommunityMessage } = await import("@/lib/community-chat/moderation.server");
      await screenCommunityMessage(message.id);
    });

    return { messageId: message.id, publishedAt: message.published_at };
  });

/**
 * Report a message to Accountabul staff. The report joins the same review
 * queue as automated flags. A member can report a message once; enough
 * distinct reports hide it until staff review it.
 */
export const reportCommunityMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { messageId: string; category: string; detail?: string }) => {
    if (!UUID.test(input.messageId)) throw new Error("Invalid message.");
    if (!isFlagCategory(input.category) || input.category === "flooding") {
      throw new Error("Choose a reason for the report.");
    }
    const detail = (input.detail ?? "").normalize("NFKC").trim();
    if (detail.length > REPORT_DETAIL_MAX_LENGTH) {
      throw new Error(`Keep the details under ${REPORT_DETAIL_MAX_LENGTH} characters.`);
    }
    return {
      messageId: input.messageId,
      category: input.category as FlagCategory,
      detail: detail || null,
    };
  })
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await throwIfRateLimited(
      `community-report:${userId}`,
      REPORT_RATE_LIMIT,
      REPORT_RATE_WINDOW_MS,
    );

    // Read through the member's own session: if row level security would not
    // show them the message, they cannot report it.
    const { data: message, error: readError } = await context.supabase
      .from("community_messages")
      .select("id, room_id, user_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (readError) throw readError;
    if (!message) throw new Error("This message is no longer available.");
    if (message.user_id === userId) throw new Error("You can't report your own message.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("community_message_flags").insert({
      message_id: message.id,
      room_id: message.room_id,
      source: "member_report",
      category: data.category,
      reporter_user_id: userId,
      detail: data.detail,
    });
    if (error) {
      if (error.code === "23505") return { alreadyReported: true };
      throw error;
    }

    const { applyReportSignals } = await import("@/lib/community-chat/moderation.server");
    await applyReportSignals(message.id);
    return { alreadyReported: false };
  });

/** Record that the member accepted the active chat policy version. */
export const acceptCommunityChatPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { policyVersionId: string }) => {
    if (!UUID.test(input.policyVersionId)) throw new Error("Invalid policy version.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: policy, error: policyError } = await supabaseAdmin
      .from("community_chat_policy_versions")
      .select("id")
      .eq("id", data.policyVersionId)
      .eq("is_active", true)
      .maybeSingle();
    if (policyError) throw policyError;
    if (!policy) throw new Error("That policy version is no longer current. Reload and try again.");

    const { error } = await supabaseAdmin
      .from("community_chat_policy_acceptances")
      .upsert(
        { user_id: context.userId, policy_version_id: policy.id },
        { onConflict: "user_id,policy_version_id", ignoreDuplicates: true },
      );
    if (error) throw error;
    return { accepted: true };
  });
