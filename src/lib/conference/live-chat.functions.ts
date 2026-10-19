import { createServerFn } from "@tanstack/react-start";

import {
  decideChatSend,
  paidCommentProgress,
  type ChatSendDecision,
  type ChatSendResult,
} from "@/lib/conference/chat-access";
import type { EventPricingRow } from "@/lib/conference/event-pricing";

// Dynamic, not static: this file is imported by a client component
// (live-chat-panel.tsx). auth.server.ts and conference.functions.ts both read
// the request directly and must never reach the client bundle.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^\S+@\S+\.\S+$/;
export const LIVE_CHAT_MAX_LENGTH = 500;
const LIVE_CHAT_RATE_LIMIT = 20;
const LIVE_CHAT_RATE_WINDOW_MS = 60_000;

type SendInput = {
  eventId: string;
  body: string;
  attemptId: string;
  /** Required only when the sender has no session — a guest paying to comment. */
  guestDisplayName?: string;
  guestEmail?: string;
};

function validateSend(input: SendInput): SendInput {
  if (!UUID.test(input.eventId) || !UUID.test(input.attemptId)) {
    throw new Error("Invalid message attempt.");
  }
  const body = input.body.normalize("NFKC").trim();
  if (!body || body.length > LIVE_CHAT_MAX_LENGTH) {
    throw new Error(`Messages must be between 1 and ${LIVE_CHAT_MAX_LENGTH} characters.`);
  }
  const guestDisplayName = input.guestDisplayName?.trim();
  const guestEmail = input.guestEmail?.trim().toLowerCase();
  if (guestDisplayName !== undefined && (!guestDisplayName || guestDisplayName.length > 80)) {
    throw new Error("Enter a display name.");
  }
  if (guestEmail !== undefined && !EMAIL.test(guestEmail)) {
    throw new Error("Enter a valid email.");
  }
  return {
    ...input,
    body,
    ...(guestDisplayName ? { guestDisplayName } : {}),
    ...(guestEmail ? { guestEmail } : {}),
  };
}

/**
 * The single place that decides what happens when someone presses Send.
 * No auth middleware: a guest is a valid caller, and "sign in" is an answer,
 * not an error. Everything — access, restriction, and this event's configured
 * price — is re-read from the database on every attempt; nothing here trusts
 * anything the browser sent except which event and which message.
 */
async function decideFor(eventId: string) {
  const { getOptionalUserId } = await import("@/lib/conference/auth.server");
  const { loadEntitlement } = await import("@/lib/conference/conference.functions");
  const userId = await getOptionalUserId();
  const { event, entitlement } = await loadEntitlement(eventId, userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let restricted = false;
  if (userId) {
    const { data: banned, error } = await supabaseAdmin.rpc("is_chat_banned", {
      _event_id: eventId,
      _user_id: userId,
    });
    if (error) throw error;
    restricted = banned === true;
  }

  const pricing: EventPricingRow = {
    access_mode: event.access_mode,
    watch_price_minor: event.watch_price_minor,
    allow_watch_purchase: event.allow_watch_purchase,
    watch_and_chat_price_minor: event.watch_and_chat_price_minor,
    allow_watch_and_chat_purchase: event.allow_watch_and_chat_purchase,
    guest_comment_price_minor: event.guest_comment_price_minor,
    allow_guest_comment: event.allow_guest_comment,
    pricing_currency: event.pricing_currency,
  };

  const decision: ChatSendDecision = decideChatSend({
    chatOpen: event.chat_enabled && event.status === "live",
    userId,
    restricted,
    entitlement: userId ? entitlement : null,
    pricing,
  });
  return { userId, event, decision };
}

async function throttle(key: string, eventId: string) {
  const { throwIfRateLimited } = await import("@/lib/security/rate-limit.server");
  await throwIfRateLimited(
    `live-chat:${key}:${eventId}`,
    LIVE_CHAT_RATE_LIMIT,
    LIVE_CHAT_RATE_WINDOW_MS,
  );
}

/**
 * Who is actually commenting: a signed-in member, or — for a guest comment —
 * whoever just typed their name and email into the payment prompt. The
 * caller has already confirmed (via decideChatSend) that a guest offer
 * exists; this only resolves identity, never price or eligibility.
 */
function authorFor(userId: string | null, data: SendInput) {
  if (userId) return { userId } as const;
  return { guestDisplayName: data.guestDisplayName!, guestEmail: data.guestEmail! } as const;
}

/** True once there is enough identity to act — a session, or a guest's name and email. */
function hasIdentity(userId: string | null, data: SendInput) {
  return Boolean(userId) || Boolean(data.guestDisplayName && data.guestEmail);
}

function throttleKeyFor(userId: string | null, data: SendInput) {
  return userId ?? `guest:${data.guestEmail}`;
}

/** Send → the server decides → publish now, or say what is needed first. */
export const sendLiveChatMessage = createServerFn({ method: "POST" })
  .validator(validateSend)
  .handler(async ({ data }): Promise<ChatSendResult> => {
    const { userId, decision } = await decideFor(data.eventId);
    const server = await import("@/lib/conference/live-chat.server");

    if (decision.outcome === "publish") {
      await throttle(userId!, data.eventId);
      const messageId = await server.publishLiveChatMessage({
        eventId: data.eventId,
        author: { userId: userId! },
        body: data.body,
        attemptId: data.attemptId,
        badge: decision.badge,
      });
      return { outcome: "published", messageId };
    }
    if (decision.outcome === "publish_free_comment") {
      if (!hasIdentity(userId, data)) {
        return { outcome: "guest_info_required", free: true, priceMinor: null, currency: "USD" };
      }
      await throttle(throttleKeyFor(userId, data), data.eventId);
      const messageId = await server.publishFreeGuestComment({
        eventId: data.eventId,
        author: authorFor(userId, data),
        body: data.body,
        attemptId: data.attemptId,
      });
      return { outcome: "published", messageId };
    }
    return decision;
  });

/**
 * "Pay $X to Comment" for the message already in the composer, at this
 * event's configured guest-comment price.
 *
 * Access is decided again first: if the member became eligible in the meantime
 * (joined, bought a pass) or the price is now free, the message is simply
 * published and nobody is charged. Anyone without unlimited chat access can
 * pay here — signed in or not; an anonymous guest supplies a name and email
 * instead of a session.
 */
export const payForLiveChatComment = createServerFn({ method: "POST" })
  .validator(validateSend)
  .handler(async ({ data }): Promise<ChatSendResult> => {
    const { userId, event, decision } = await decideFor(data.eventId);
    const server = await import("@/lib/conference/live-chat.server");

    if (decision.outcome === "publish") {
      await throttle(userId!, data.eventId);
      const messageId = await server.publishLiveChatMessage({
        eventId: data.eventId,
        author: { userId: userId! },
        body: data.body,
        attemptId: data.attemptId,
        badge: decision.badge,
      });
      return { outcome: "published", messageId };
    }
    if (decision.outcome === "publish_free_comment") {
      if (!hasIdentity(userId, data)) {
        return { outcome: "guest_info_required", free: true, priceMinor: null, currency: "USD" };
      }
      await throttle(throttleKeyFor(userId, data), data.eventId);
      const messageId = await server.publishFreeGuestComment({
        eventId: data.eventId,
        author: authorFor(userId, data),
        body: data.body,
        attemptId: data.attemptId,
      });
      return { outcome: "published", messageId };
    }
    if (decision.outcome !== "payment_required" || !decision.purchasable || !decision.priceMinor) {
      return decision;
    }
    if (!hasIdentity(userId, data)) {
      return {
        outcome: "guest_info_required",
        free: false,
        priceMinor: decision.priceMinor,
        currency: decision.currency,
      };
    }

    await throttle(throttleKeyFor(userId, data), data.eventId);
    const checkout = await server.createPaidCommentCheckout({
      eventId: data.eventId,
      eventSlug: event.slug,
      author: authorFor(userId, data),
      body: data.body,
      attemptId: data.attemptId,
      amountMinor: decision.priceMinor,
      currency: decision.currency,
    });
    if (!checkout.ok) return { ...decision, purchasable: false };
    return {
      outcome: "checkout",
      checkoutUrl: checkout.checkoutUrl,
      commentId: checkout.commentId,
    };
  });

/** Polled after returning from checkout, until the webhook has posted the comment. */
export const getLiveChatPaidCommentStatus = createServerFn({ method: "GET" })
  .validator((input: { commentId: string }) => {
    if (!UUID.test(input.commentId)) throw new Error("Invalid comment.");
    return input;
  })
  .handler(async ({ data }) => {
    const { getOptionalUserId } = await import("@/lib/conference/auth.server");
    const userId = await getOptionalUserId();
    const { loadOwnPaidCommentStatus } = await import("@/lib/conference/live-chat.server");
    // A guest has no session, so their commentId — an unguessable UUID handed
    // back only on their own Stripe redirect — is the whole credential.
    const comment = await loadOwnPaidCommentStatus(data.commentId, userId);
    if (!comment) return { progress: "unknown" as const, body: null };
    return { progress: paidCommentProgress(comment.status), body: comment.body };
  });

/**
 * What the event page and video player show before anyone commits to a
 * purchase: this event's actual configured offers. Same pricing module the
 * send/checkout handlers use, so the price shown is never allowed to drift
 * from the price charged.
 */
export const getEventAccessOffers = createServerFn({ method: "GET" })
  .validator((eventId: string) => {
    if (!UUID.test(eventId)) throw new Error("Invalid event.");
    return eventId;
  })
  .handler(async ({ data: eventId }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listEventOffers } = await import("@/lib/conference/event-pricing");
    const { data: event, error } = await supabaseAdmin
      .from("events")
      .select(
        "access_mode, watch_price_minor, allow_watch_purchase, watch_and_chat_price_minor, allow_watch_and_chat_purchase, guest_comment_price_minor, allow_guest_comment, pricing_currency",
      )
      .eq("id", eventId)
      .single();
    if (error) throw error;
    return listEventOffers(event);
  });
