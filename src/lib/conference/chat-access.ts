import type { EventEntitlement } from "@/lib/conference/entitlements";
// Relative, with the extension Node's test runner needs to resolve it directly
// (see tests/live-chat-access.test.ts) — everything else here is type-only and
// erased, so this is the one import that actually has to run.
import { guestCommentOffer, type EventPricingRow } from "./event-pricing.ts";

/**
 * Who may send a live room chat message, decided at the moment they press Send.
 *
 * The chat always looks open: anyone can read it and type. Access is resolved
 * here, on the server, only when a message is actually sent. The browser never
 * decides whether someone is signed in, holds a membership or pass, or paid.
 *
 * Pure, so new rules (paid rooms, private rooms, property or vendor rooms) slot
 * in as additional inputs and outcomes without touching the transport.
 */

export type ChatSendInput = {
  chatOpen: boolean;
  /** Null when the request carries no verified session. */
  userId: string | null;
  /** Removed from this room by the host or staff. */
  restricted: boolean;
  /** Null for a guest; entitlement is only resolved for a signed-in person. */
  entitlement: EventEntitlement | null;
  /** This event's configured pricing, read fresh from the database — never from the client. */
  pricing: EventPricingRow;
  /** A configured $0 guest-comment price still needs a live Stripe account to exist for >0 comments elsewhere in the room; this event's guest-comment price specifically doesn't touch Stripe when it's free. */
};

export type ChatSendDecision =
  | { outcome: "publish"; badge: "accountabul_member" | "event_guest" }
  /** Guest comments are configured and free for this event: publish with no checkout. */
  | { outcome: "publish_free_comment" }
  | { outcome: "sign_in" }
  | {
      outcome: "payment_required";
      /** False when this event does not sell guest comments at all. */
      purchasable: boolean;
      priceMinor: number | null;
      currency: string;
    }
  | { outcome: "restricted" }
  | { outcome: "closed" };

export function decideChatSend(input: ChatSendInput): ChatSendDecision {
  if (!input.chatOpen) return { outcome: "closed" };
  if (input.userId && input.restricted) return { outcome: "restricted" };
  if (input.userId && input.entitlement?.canComment) {
    return {
      outcome: "publish",
      badge: input.entitlement.source === "pass" ? "event_guest" : "accountabul_member",
    };
  }
  // A guest comment is sold at this event's configured price to anyone who
  // doesn't already have unlimited chat access — signed in or not. Signing in
  // isn't required to pay: we want the purchase regardless of whether they
  // ever create an account.
  const offer = guestCommentOffer(input.pricing);
  if (offer?.free) return { outcome: "publish_free_comment" };
  if (offer) {
    return {
      outcome: "payment_required",
      purchasable: true,
      priceMinor: offer.amountMinor,
      currency: offer.currency,
    };
  }
  // Nothing is for sale here: an anonymous visitor has no way to comment at
  // all, so ask them to sign in (a signed-in member without an offer still
  // gets a non-purchasable payment_required, matching membership-gated rooms).
  if (!input.userId) return { outcome: "sign_in" };
  return {
    outcome: "payment_required",
    purchasable: false,
    priceMinor: null,
    currency: input.pricing.pricing_currency,
  };
}

/**
 * Where a message is in its life, from the sender's point of view.
 *
 * draft                  typed, not sent yet
 * pending_authentication sent by a guest; kept while they sign in or sign up
 * pending_payment        $1 checkout started; kept until the payment posts it
 * published              visible in the room
 * deleted                removed after publication by safeguards or staff
 *
 * There is deliberately no "waiting for a moderator" state. Moderation acts on
 * messages that are already published.
 */
export type ChatMessageLifecycle =
  "draft" | "pending_authentication" | "pending_payment" | "published" | "deleted";

/** The result a send or a $1 payment reports back to the room. */
export type ChatSendResult =
  | { outcome: "published"; messageId: string }
  | { outcome: "checkout"; checkoutUrl: string; commentId: string }
  /** An anonymous visitor is eligible to comment (free or paid) but hasn't given a name and email yet. */
  | { outcome: "guest_info_required"; free: boolean; priceMinor: number | null; currency: string }
  | Exclude<ChatSendDecision, { outcome: "publish" }>;

/** Toast copy for every outcome, kept in one place so the tone stays consistent. */
export const CHAT_NOTICES = {
  sent: "Message sent.",
  signIn: "Create an account or sign in to join the conversation.",
  paymentRequired: "Chat is available with membership, or pay to post this comment.",
  paymentConfirmed: "Payment confirmed. Your message is being posted.",
  commentPosted: "Your comment has been posted.",
  paymentNotCompleted: "Payment wasn't completed. Your message is still here.",
  sendFailed: "We couldn't send your message. Please try again.",
  restricted: "You can't send messages in this room.",
  closed: "Chat isn't open for this room right now. Your message is still here.",
  paidCommentUnavailable:
    "Paying per comment isn't available right now. Your message is still here.",
} as const;

/**
 * After a message is published, automated safeguards decide whether it should
 * come down. Ordinary links are fine in room chat; spam, threats, and
 * self-harm encouragement are not, and neither is anything the moderation
 * provider flags.
 */
export function shouldRemoveAfterPublication(screening: {
  deterministicReasons: string[];
  providerFlagged: boolean;
}) {
  if (screening.providerFlagged) return true;
  return screening.deterministicReasons.some(
    (reason) => reason !== "links" && reason !== "empty" && reason !== "too_long",
  );
}

/** A paid comment's status, reduced to what the sender needs to know. */
export function paidCommentProgress(status: string): "posted" | "pending" | "failed" {
  if (status === "published") return "posted";
  if (status === "payment_failed" || status === "refunded" || status === "expired") return "failed";
  if (status === "rejected") return "failed";
  return "pending";
}
