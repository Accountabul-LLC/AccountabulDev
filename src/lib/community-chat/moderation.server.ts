/**
 * Post-publication moderation for community chat.
 *
 * Every function here acts on a message that is already live. Nothing in this
 * file is on the send path: screening runs after the response, report handling
 * runs when a member reports, and staff actions run from the operations API.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { moderateWithProvider } from "@/lib/conference/moderation.server";
import {
  assessMessageText,
  decideAutomatedOutcome,
  primaryCategory,
  providerSignals,
  shouldAutoHideFromReports,
} from "@/lib/community-chat/safeguards";

type ActionKind = Database["public"]["Enums"]["community_moderation_action_kind"];
type Actor = { actor: "system" } | { actor: "operator"; reference: string | null };

/** Messages older than this with no screening are picked up by the sweep. */
const SWEEP_GRACE_MS = 2 * 60_000;
/** The sweep does not reach back further than this. */
const SWEEP_HORIZON_MS = 7 * 24 * 60 * 60_000;

export async function recordModerationAction(input: {
  action: ActionKind;
  by: Actor;
  messageId?: string | null;
  roomId?: string | null;
  targetUserId?: string | null;
  restrictionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("community_moderation_actions")
    .insert({
      action: input.action,
      actor: input.by.actor,
      actor_reference: input.by.actor === "operator" ? input.by.reference : null,
      message_id: input.messageId ?? null,
      room_id: input.roomId ?? null,
      target_user_id: input.targetUserId ?? null,
      restriction_id: input.restrictionId ?? null,
      reason: input.reason ?? null,
      metadata: (input.metadata ?? {}) as Json,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Hide a live message. Idempotent: hiding an already hidden message changes
 * nothing and records nothing. Returns whether this call hid it.
 */
export async function hideMessage(input: { messageId: string; reason: string; by: Actor }) {
  const { data, error } = await supabaseAdmin
    .from("community_messages")
    .update({ hidden_at: new Date().toISOString(), hidden_reason: input.reason })
    .eq("id", input.messageId)
    .is("hidden_at", null)
    .select("id, room_id, user_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  await recordModerationAction({
    action: "message_hidden",
    by: input.by,
    messageId: data.id,
    roomId: data.room_id,
    targetUserId: data.user_id,
    reason: input.reason,
  });
  return true;
}

/**
 * Run automated safeguards on one published message.
 *
 * Deterministic rules and the moderation provider both run; their signals
 * decide between doing nothing, filing an automated flag, or hiding the message
 * and filing the flag. A provider outage contributes no signals, so it never
 * flags or hides ordinary conversation.
 */
export async function screenCommunityMessage(messageId: string) {
  const { data: message, error } = await supabaseAdmin
    .from("community_messages")
    .select("id, room_id, user_id, body, screened_at, hidden_at, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message || message.screened_at || message.deleted_at) return "skipped" as const;

  const deterministic = assessMessageText(message.body);
  const provider = await moderateWithProvider(message.body);
  const signals = [...deterministic, ...providerSignals(provider)];
  const outcome = decideAutomatedOutcome(signals);

  // Claim after computing, so a lost worker leaves the message for the sweep
  // rather than marking it screened without a result.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("community_messages")
    .update({
      screened_at: new Date().toISOString(),
      screening: JSON.parse(
        JSON.stringify({
          outcome,
          signals,
          provider: { name: provider.provider, reasons: provider.reasons },
        }),
      ) as Json,
    })
    .eq("id", message.id)
    .is("screened_at", null)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "skipped" as const;
  if (outcome === "none") return outcome;

  const { error: flagError } = await supabaseAdmin.from("community_message_flags").insert({
    message_id: message.id,
    room_id: message.room_id,
    source: "automated",
    category: primaryCategory(signals),
    signals: JSON.parse(JSON.stringify({ signals })) as Json,
  });
  if (flagError) throw flagError;

  if (outcome === "hide") {
    await hideMessage({
      messageId: message.id,
      reason: `Hidden automatically: ${signals
        .filter((signal) => signal.severity === "high")
        .map((signal) => signal.rule)
        .join(", ")}`,
      by: { actor: "system" },
    });
  }
  return outcome;
}

/**
 * Backstop for background work that never ran: screen recent messages that
 * are still unscreened after a short grace period. Seed data is excluded.
 */
export async function sweepUnscreenedMessages(limit = 25) {
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from("community_messages")
    .select("id")
    .is("screened_at", null)
    .is("seed_batch_id", null)
    .is("deleted_at", null)
    .lt("created_at", new Date(now - SWEEP_GRACE_MS).toISOString())
    .gt("created_at", new Date(now - SWEEP_HORIZON_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let screened = 0;
  for (const row of data ?? []) {
    const outcome = await screenCommunityMessage(row.id);
    if (outcome !== "skipped") screened += 1;
  }
  return screened;
}

/**
 * Recount distinct member reports on a message, and hide it pending review
 * once enough different members have reported it.
 */
export async function applyReportSignals(messageId: string) {
  const reportCount = (status?: "open") => {
    let query = supabaseAdmin
      .from("community_message_flags")
      .select("id", { count: "exact", head: true })
      .eq("message_id", messageId)
      .eq("source", "member_report");
    if (status) query = query.eq("status", status);
    return query;
  };
  const [total, open] = await Promise.all([reportCount(), reportCount("open")]);
  if (total.error) throw total.error;
  if (open.error) throw open.error;

  const { error: countError } = await supabaseAdmin
    .from("community_messages")
    .update({ report_count: total.count ?? 0 })
    .eq("id", messageId);
  if (countError) throw countError;

  // Only open reports count toward hiding: once staff dismiss reports and
  // restore a message, earlier reports do not hide it again.
  const openReports = open.count ?? 0;
  if (shouldAutoHideFromReports(openReports)) {
    await hideMessage({
      messageId,
      reason: `Hidden automatically after ${openReports} member reports, pending review.`,
      by: { actor: "system" },
    });
  }
  return openReports;
}
