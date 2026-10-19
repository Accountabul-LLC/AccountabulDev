import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { runAfterResponse } from "@/lib/background.server";
import { createVariableAmountCheckout } from "@/lib/billing/checkout.server";
import { shouldRemoveAfterPublication } from "@/lib/conference/chat-access";
import { screenDeterministically, sha256Text } from "@/lib/conference/moderation";
import { getStripeRuntime, missingStripeCheckoutSecrets } from "@/lib/stripe/client.server";

/**
 * Live room chat, publish-first.
 *
 * A message from someone with access goes straight into the room. A guest
 * comment is locked to the exact text the member typed, priced at whatever
 * this event is configured to charge (see event-pricing.ts — never a fixed
 * global amount), approved automatically, and published by the verified
 * Stripe webhook. Safeguards run after publication and take a message down
 * when they find a real problem; nothing waits for a moderator first.
 */

/** A guest-comment checkout that is never completed stops being payable after this. */
const PAID_COMMENT_CHECKOUT_TTL_MS = 60 * 60 * 1000;

/** The name and photo a message carries, taken from the member's own account. */
export async function loadAuthorIdentity(userId: string) {
  const [profile, account] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("display_name, first_name, last_name, handle")
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(userId),
  ]);
  if (profile.error) throw profile.error;

  const fullName = [profile.data?.first_name, profile.data?.last_name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ");
  const displayName =
    profile.data?.display_name?.trim() ||
    fullName ||
    (profile.data?.handle ? `@${profile.data.handle}` : null);

  const metadata = account.error ? null : account.data.user?.user_metadata;
  let avatarUrl: string | null = null;
  for (const key of ["avatar_url", "picture"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && /^https:\/\//i.test(value.trim()) && value.length <= 2048) {
      avatarUrl = value.trim();
      break;
    }
  }

  return {
    displayName,
    avatarUrl,
    email: account.error ? null : (account.data.user?.email ?? null),
  };
}

/** Either a signed-in member (identity loaded from their account) or a guest with no account. */
export type ChatAuthor = { userId: string } | { guestDisplayName: string; guestEmail: string };

async function resolveAuthorIdentity(author: ChatAuthor) {
  if ("userId" in author)
    return { userId: author.userId, ...(await loadAuthorIdentity(author.userId)) };
  return {
    userId: null as string | null,
    displayName: author.guestDisplayName,
    avatarUrl: null as string | null,
    email: author.guestEmail,
  };
}

export async function publishLiveChatMessage(input: {
  eventId: string;
  author: ChatAuthor;
  body: string;
  attemptId: string;
  badge: "accountabul_member" | "event_guest";
}) {
  const identity = await resolveAuthorIdentity(input.author);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      event_id: input.eventId,
      user_id: identity.userId,
      body: input.body,
      source: identity.userId ? "accountabul" : "paid_guest",
      external_id: input.attemptId,
      author_display_name: identity.displayName,
      author_avatar_url: identity.avatarUrl,
      author_badge: input.badge,
      moderation_status: "approved",
      content_sha256: await sha256Text(input.body),
      metadata: { moderation: { model: "post_publication" } },
      published_at: now,
    })
    .select("id")
    .single();

  if (error) {
    // The attempt id is unique per room, so a double click or a retry after a
    // dropped response lands on the message that already exists.
    if (error.code !== "23505") throw error;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("chat_messages")
      .select("id")
      .eq("event_id", input.eventId)
      .eq("source", identity.userId ? "accountabul" : "paid_guest")
      .eq("external_id", input.attemptId)
      .single();
    if (existingError) throw existingError;
    return existing.id;
  }

  screenAfterPublication(data.id, input.body);
  return data.id;
}

/**
 * Automated safeguards, after the message is already live. Losing this work is
 * acceptable: members can still report, and staff can still remove.
 */
export function screenAfterPublication(messageId: string, body: string, request?: Request) {
  runAfterResponse(
    "live-chat-screening",
    async () => {
      const deterministic = screenDeterministically(body);
      const { moderateWithProvider } = await import("@/lib/conference/moderation.server");
      const provider = await moderateWithProvider(body);
      const providerFlagged = provider.provider === "openai" && provider.status === "quarantined";
      const remove = shouldRemoveAfterPublication({
        deterministicReasons: deterministic.reasons,
        providerFlagged,
      });

      const screening = {
        model: "post_publication",
        deterministic_reasons: deterministic.reasons,
        provider: provider.provider,
        provider_reasons: provider.reasons,
        removed: remove,
        screened_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin
        .from("chat_messages")
        .update(
          remove
            ? {
                is_hidden: true,
                moderation_status: "quarantined",
                metadata: { moderation: screening } as Json,
              }
            : { metadata: { moderation: screening } as Json },
        )
        .eq("id", messageId);
      if (error) throw error;
    },
    request,
  );
}

/**
 * A free guest comment (this event's configured price is 0): authorize and
 * publish it directly, with the same audit trail a paid comment leaves, but
 * without creating a payment_records row or going anywhere near Stripe. See
 * the events_guest_comment_price_nonneg / payment_records amount_minor > 0
 * constraints — a $0 "payment" is deliberately not a thing this schema
 * models, so a free comment is its own record, not a Stripe checkout of $0.
 */
export async function publishFreeGuestComment(input: {
  eventId: string;
  author: ChatAuthor;
  body: string;
  attemptId: string;
}) {
  const { data: standards, error: standardsError } = await supabaseAdmin
    .from("community_standards_versions")
    .select("id")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (standardsError) throw standardsError;
  if (!standards) throw new Error("Community Standards are unavailable.");

  const identity = await resolveAuthorIdentity(input.author);
  const bodySha256 = await sha256Text(input.body);
  const now = new Date().toISOString();

  const { data: comment, error: commentError } = await supabaseAdmin
    .from("paid_comments")
    .insert({
      event_id: input.eventId,
      user_id: identity.userId,
      guest_display_name: identity.displayName ?? "Accountabul member",
      guest_email: identity.email ?? "",
      body: input.body,
      body_sha256: bodySha256,
      approved_body_sha256: bodySha256,
      standards_version_id: standards.id,
      status: "published",
      moderated_at: now,
      moderator_note: "Free comment for this event: approved automatically, no payment required.",
      automated_moderation: { model: "post_publication" },
    })
    .select("id")
    .single();
  if (commentError) throw commentError;

  const messageId = await publishLiveChatMessage({
    eventId: input.eventId,
    author: input.author,
    body: input.body,
    attemptId: input.attemptId,
    badge: "event_guest",
  });

  const { error: linkError } = await supabaseAdmin
    .from("paid_comments")
    .update({ chat_message_id: messageId })
    .eq("id", comment.id);
  if (linkError) throw linkError;

  return messageId;
}

/**
 * Starts a checkout for the exact text a signed-in member typed, at this
 * event's configured guest-comment price. The amount comes from the caller,
 * which reads it from the events table server-side (see
 * live-chat.functions.ts::decideFor) — never from the browser.
 *
 * The comment is approved automatically: approved_body_sha256 is the hash of
 * the text itself, and the webhook refuses to publish anything whose hash does
 * not match what was paid for. So the payment always posts the preserved
 * message, and only that message.
 */
export async function createPaidCommentCheckout(input: {
  eventId: string;
  eventSlug: string;
  author: ChatAuthor;
  body: string;
  attemptId: string;
  amountMinor: number;
  currency: string;
}) {
  if (missingStripeCheckoutSecrets().length > 0 || input.amountMinor <= 0) {
    return { ok: false as const, reason: "unavailable" as const };
  }

  const { data: standards, error: standardsError } = await supabaseAdmin
    .from("community_standards_versions")
    .select("id")
    .eq("is_active", true)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (standardsError) throw standardsError;
  if (!standards) return { ok: false as const, reason: "unavailable" as const };

  const identity = await resolveAuthorIdentity(input.author);
  if (!identity.email) return { ok: false as const, reason: "unavailable" as const };

  const bodySha256 = await sha256Text(input.body);
  const now = new Date();
  const { data: comment, error: commentError } = await supabaseAdmin
    .from("paid_comments")
    .insert({
      event_id: input.eventId,
      user_id: identity.userId,
      guest_display_name: identity.displayName ?? "Accountabul member",
      guest_email: identity.email,
      body: input.body,
      body_sha256: bodySha256,
      approved_body_sha256: bodySha256,
      standards_version_id: standards.id,
      status: "approved",
      moderated_at: now.toISOString(),
      moderator_note: "Approved automatically: live chat moderates after publication.",
      automated_moderation: { model: "post_publication" },
      expires_at: new Date(now.getTime() + PAID_COMMENT_CHECKOUT_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (commentError) throw commentError;

  const { accountId } = getStripeRuntime();
  const idempotencyKey = `paid-comment:${comment.id}:${input.attemptId}`;
  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payment_records")
    .insert({
      kind: "paid_comment",
      provider: "stripe",
      provider_account_id: accountId,
      event_id: input.eventId,
      ...(identity.userId ? { user_id: identity.userId } : {}),
      amount_minor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      status: "created",
      idempotency_key: idempotencyKey,
      metadata: { paid_comment_id: comment.id, live_chat_paid_comment: "true" },
    })
    .select("id")
    .single();
  if (paymentError) throw paymentError;

  const { error: claimError } = await supabaseAdmin
    .from("paid_comments")
    .update({ payment_record_id: payment.id, status: "checkout_created" })
    .eq("id", comment.id)
    .eq("status", "approved");
  if (claimError) throw claimError;

  const roomPath = `/live/${encodeURIComponent(input.eventSlug)}`;

  try {
    const session = await createVariableAmountCheckout({
      kind: "paid_comment",
      amountMinor: input.amountMinor,
      currency: input.currency,
      productName: "Accountabul live event — guest comment",
      referenceId: payment.id,
      ...(identity.userId ? { userId: identity.userId } : { customerEmail: identity.email }),
      successPath: `${roomPath}?paid_comment=success&comment_id=${comment.id}`,
      cancelPath: `${roomPath}?paid_comment=canceled&comment_id=${comment.id}`,
      idempotencyKey,
      metadata: {
        paid_comment_id: comment.id,
        payment_record_id: payment.id,
        event_id: input.eventId,
        body_sha256: bodySha256,
      },
    });

    const { error: paymentUpdateError } = await supabaseAdmin
      .from("payment_records")
      .update({ checkout_session_id: session.id, status: "processing" })
      .eq("id", payment.id);
    if (paymentUpdateError) throw paymentUpdateError;

    return { ok: true as const, checkoutUrl: session.url!, commentId: comment.id };
  } catch (error) {
    await Promise.all([
      supabaseAdmin
        .from("paid_comments")
        .update({ status: "expired", payment_record_id: null })
        .eq("id", comment.id),
      supabaseAdmin
        .from("payment_records")
        .update({ status: "canceled" })
        .eq("id", payment.id)
        .eq("status", "created"),
    ]);
    throw error;
  }
}

/**
 * Only the member (or, for a guest comment, whoever holds the unguessable
 * comment id from their own Stripe redirect) may see how it is going.
 */
export async function loadOwnPaidCommentStatus(commentId: string, userId: string | null) {
  const query = supabaseAdmin
    .from("paid_comments")
    .select("status, body, chat_message_id")
    .eq("id", commentId);
  const { data, error } = await (
    userId ? query.eq("user_id", userId) : query.is("user_id", null)
  ).maybeSingle();
  if (error) throw error;
  return data;
}
