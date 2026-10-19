/**
 * Per-event access pricing: the single place that reads an event's configured
 * amounts and says what is actually for sale.
 *
 * Nothing here talks to Stripe or the database — it is pure so the event page,
 * the video player, the chat composer, and the backend send/checkout handlers
 * can all call the same functions instead of five copies of "is this free?"
 * logic drifting apart. The event row (whatever loaded it: an ops route, a
 * server function, a webhook) is the only input.
 */

export type EventPricingRow = {
  access_mode: "public" | "subscriber" | "subscriber_or_pass";
  watch_price_minor: number | null;
  allow_watch_purchase: boolean;
  watch_and_chat_price_minor: number | null;
  allow_watch_and_chat_purchase: boolean;
  guest_comment_price_minor: number | null;
  allow_guest_comment: boolean;
  pricing_currency: string;
};

export type EventAccessType = "watch" | "watch_and_chat";

export type PriceOffer = { amountMinor: number; currency: string; free: boolean };

/** Ops turned this on and gave it a real (possibly zero) price. Missing either and it isn't for sale. */
function offer(enabled: boolean, amountMinor: number | null, currency: string): PriceOffer | null {
  if (!enabled || amountMinor === null) return null;
  return { amountMinor, currency, free: amountMinor === 0 };
}

export function watchOffer(event: EventPricingRow): PriceOffer | null {
  return offer(event.allow_watch_purchase, event.watch_price_minor, event.pricing_currency);
}

export function watchAndChatOffer(event: EventPricingRow): PriceOffer | null {
  return offer(
    event.allow_watch_and_chat_purchase,
    event.watch_and_chat_price_minor,
    event.pricing_currency,
  );
}

export function guestCommentOffer(event: EventPricingRow): PriceOffer | null {
  return offer(event.allow_guest_comment, event.guest_comment_price_minor, event.pricing_currency);
}

export function offerFor(event: EventPricingRow, accessType: EventAccessType): PriceOffer | null {
  return accessType === "watch" ? watchOffer(event) : watchAndChatOffer(event);
}

/**
 * What the public event page and video player show before anyone commits to
 * anything: every access type this event actually sells, with its price. An
 * event that only takes membership (access_mode "subscriber") or is fully
 * open (access_mode "public", no separate purchases configured) offers nothing
 * here — there is nothing to buy.
 */
export function listEventOffers(event: EventPricingRow) {
  if (event.access_mode !== "subscriber_or_pass") {
    return { watch: null, watchAndChat: null, guestComment: guestCommentOffer(event) };
  }
  return {
    watch: watchOffer(event),
    watchAndChat: watchAndChatOffer(event),
    guestComment: guestCommentOffer(event),
  };
}
