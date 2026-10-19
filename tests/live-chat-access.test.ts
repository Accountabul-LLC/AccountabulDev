import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_NOTICES,
  decideChatSend,
  paidCommentProgress,
  shouldRemoveAfterPublication,
  type ChatSendInput,
} from "../src/lib/conference/chat-access.ts";
import type { EventEntitlement } from "../src/lib/conference/entitlements.ts";
import {
  guestCommentOffer,
  listEventOffers,
  offerFor,
  watchAndChatOffer,
  watchOffer,
  type EventPricingRow,
} from "../src/lib/conference/event-pricing.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const functions = read("../src/lib/conference/live-chat.functions.ts");
const server = read("../src/lib/conference/live-chat.server.ts");
const eventAccessServer = read("../src/lib/conference/event-access.server.ts");
const checkoutServer = read("../src/lib/billing/checkout.server.ts");
const billingFunctions = read("../src/lib/billing/billing.functions.ts");
const eventPassesRoute = read("../src/routes/api/public/event-passes.ts");
const opsEvents = read("../src/routes/api/internal/ops/events.ts");
const panel = read("../src/components/live/live-chat-panel.tsx");
const livePage = read("../src/routes/live.$slug.tsx");
const webhook = read("../src/routes/api/public/webhooks/stripe.ts");
const conference = read("../src/lib/conference/conference.functions.ts");
const entitlementServer = read("../src/lib/conference/entitlement.server.ts");
const migration = read("../supabase/migrations/20260917130000_event_access_pricing.sql");
const onboarding = read("../src/routes/onboarding.individual.tsx");

/** A browser-like localStorage, so the draft and return-path helpers run in Node. */
function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return values;
}

const member: EventEntitlement = {
  canWatch: true,
  canComment: true,
  canTakeStage: true,
  canRequestSpeaker: true,
  source: "membership",
  reason: "Active Accountabul membership.",
};
const noAccess: EventEntitlement = {
  canWatch: true,
  canComment: false,
  canTakeStage: false,
  canRequestSpeaker: false,
  source: "public",
  reason: "Public room.",
};

function pricing(overrides: Partial<EventPricingRow> = {}): EventPricingRow {
  return {
    access_mode: "subscriber_or_pass",
    watch_price_minor: 500,
    allow_watch_purchase: true,
    watch_and_chat_price_minor: 1000,
    allow_watch_and_chat_purchase: true,
    guest_comment_price_minor: 100,
    allow_guest_comment: true,
    pricing_currency: "USD",
    ...overrides,
  };
}

function input(overrides: Partial<ChatSendInput> = {}): ChatSendInput {
  return {
    chatOpen: true,
    userId: "0f2b0d0d-5a4b-4a1b-9d3f-9b6a5a4f31cc",
    restricted: false,
    entitlement: member,
    pricing: pricing(),
    ...overrides,
  };
}

test("Test A: a member or pass holder publishes immediately, whatever this event charges", () => {
  assert.deepEqual(decideChatSend(input({ entitlement: member })), {
    outcome: "publish",
    badge: "accountabul_member",
  });
  const passHolder: EventEntitlement = { ...member, canTakeStage: false, source: "pass" };
  assert.deepEqual(decideChatSend(input({ entitlement: passHolder })), {
    outcome: "publish",
    badge: "event_guest",
  });
});

test("Test B: a signed-in account without access is offered this event's actual guest-comment price", () => {
  assert.deepEqual(decideChatSend(input({ entitlement: noAccess })), {
    outcome: "payment_required",
    purchasable: true,
    priceMinor: 100,
    currency: "USD",
  });
  // A different event can charge a different amount for the exact same shape of request.
  assert.deepEqual(
    decideChatSend(
      input({ entitlement: noAccess, pricing: pricing({ guest_comment_price_minor: 300 }) }),
    ),
    { outcome: "payment_required", purchasable: true, priceMinor: 300, currency: "USD" },
  );
  // This event doesn't sell guest comments at all.
  assert.deepEqual(
    decideChatSend(
      input({ entitlement: noAccess, pricing: pricing({ allow_guest_comment: false }) }),
    ),
    { outcome: "payment_required", purchasable: false, priceMinor: null, currency: "USD" },
  );
});

test("a free guest comment publishes directly, with no checkout", () => {
  assert.deepEqual(
    decideChatSend(
      input({ entitlement: noAccess, pricing: pricing({ guest_comment_price_minor: 0 }) }),
    ),
    { outcome: "publish_free_comment" },
  );
});

test("Test C: an anonymous visitor can pay this event's guest-comment price without an account", () => {
  assert.deepEqual(decideChatSend(input({ userId: null, entitlement: null })), {
    outcome: "payment_required",
    purchasable: true,
    priceMinor: 100,
    currency: "USD",
  });
  // A signed-in session doesn't change the offer.
  assert.deepEqual(decideChatSend(input({ userId: null, entitlement: member })), {
    outcome: "payment_required",
    purchasable: true,
    priceMinor: 100,
    currency: "USD",
  });
  // Only when this event sells no guest comments at all does an anonymous
  // visitor have nothing to do but sign in.
  assert.deepEqual(
    decideChatSend(input({ userId: null, pricing: pricing({ allow_guest_comment: false }) })),
    { outcome: "sign_in" },
  );
  // A free guest comment publishes directly for an anonymous visitor too.
  assert.deepEqual(
    decideChatSend(input({ userId: null, pricing: pricing({ guest_comment_price_minor: 0 }) })),
    { outcome: "publish_free_comment" },
  );
});

test("closed rooms and removed members are refused before anything else, price or no price", () => {
  assert.deepEqual(decideChatSend(input({ chatOpen: false, userId: null })), {
    outcome: "closed",
  });
  assert.deepEqual(decideChatSend(input({ restricted: true })), { outcome: "restricted" });
  assert.deepEqual(decideChatSend(input({ restricted: true, entitlement: noAccess })), {
    outcome: "restricted",
  });
});

test("event-pricing: an offer needs both the toggle and a configured price", () => {
  assert.deepEqual(watchOffer(pricing()), { amountMinor: 500, currency: "USD", free: false });
  assert.equal(watchOffer(pricing({ allow_watch_purchase: false })), null);
  assert.equal(watchOffer(pricing({ watch_price_minor: null })), null);
  assert.deepEqual(watchAndChatOffer(pricing({ watch_and_chat_price_minor: 0 })), {
    amountMinor: 0,
    currency: "USD",
    free: true,
  });
  assert.equal(guestCommentOffer(pricing({ allow_guest_comment: false })), null);
  assert.deepEqual(offerFor(pricing(), "watch"), watchOffer(pricing()));
  assert.deepEqual(offerFor(pricing(), "watch_and_chat"), watchAndChatOffer(pricing()));
});

test("event-pricing: a subscriber-only or fully public room sells no watch or watch+chat access", () => {
  const subscriberOnly = listEventOffers(pricing({ access_mode: "subscriber" }));
  assert.equal(subscriberOnly.watch, null);
  assert.equal(subscriberOnly.watchAndChat, null);
  // Guest comments are independent of access_mode: a public room can still sell them.
  assert.notEqual(subscriberOnly.guestComment, null);

  const publicRoom = listEventOffers(pricing({ access_mode: "public" }));
  assert.equal(publicRoom.watch, null);
  assert.equal(publicRoom.watchAndChat, null);

  const paidRoom = listEventOffers(pricing());
  assert.notEqual(paidRoom.watch, null);
  assert.notEqual(paidRoom.watchAndChat, null);
});

test("Ops can price three completely different events three different ways, including free", () => {
  const eventA = listEventOffers(
    pricing({
      watch_price_minor: 500,
      watch_and_chat_price_minor: 1000,
      guest_comment_price_minor: 100,
    }),
  );
  const eventB = listEventOffers(
    pricing({
      watch_price_minor: 1500,
      watch_and_chat_price_minor: 3000,
      guest_comment_price_minor: 500,
    }),
  );
  const eventC = listEventOffers(
    pricing({ watch_price_minor: 0, watch_and_chat_price_minor: 0, guest_comment_price_minor: 0 }),
  );
  assert.equal(eventA.watch?.amountMinor, 500);
  assert.equal(eventB.watch?.amountMinor, 1500);
  assert.equal(eventC.watch?.free, true);
  assert.equal(eventC.watchAndChat?.free, true);
  assert.equal(eventC.guestComment?.free, true);
});

test("the server, not the browser, makes the send decision on every attempt", () => {
  assert.doesNotMatch(functions, /requireSupabaseAuth/);
  assert.match(functions, /getOptionalUserId\(\)/);
  assert.match(functions, /loadEntitlement\(eventId, userId\)/);
  assert.match(functions, /rpc\("is_chat_banned"/);
  assert.equal((functions.match(/await decideFor\(data\.eventId\)/g) ?? []).length, 2);
  const pay = functions.slice(functions.indexOf("export const payForLiveChatComment"));
  assert.ok(
    pay.indexOf('decision.outcome === "publish"') < pay.indexOf("createPaidCommentCheckout"),
  );
  assert.match(functions, /guestDisplayName\?: string/);
  assert.match(functions, /guestEmail\?: string/);
  // The price paid comes from the decision the server just computed, not a
  // second, independently-trusted number.
  assert.match(functions, /amountMinor: decision\.priceMinor/);
  assert.match(functions, /currency: decision\.currency/);
});

test("ordinary messages and free comments publish at once; nothing waits for a moderator", () => {
  assert.match(server, /moderation_status: "approved",/);
  assert.match(server, /published_at: now,/);
  assert.match(server, /screenAfterPublication\(data\.id, input\.body\)/);
  assert.doesNotMatch(server, /pending_moderator|awaiting_moderator/);
  assert.match(server, /export async function publishFreeGuestComment/);
  assert.match(server, /status: "published",/);
  assert.doesNotMatch(conference, /postConferenceMessage/);
  assert.doesNotMatch(conference, /Held for moderator review/);
});

test("a free comment still leaves an audit record, without touching Stripe", () => {
  const free = server.slice(
    server.indexOf("export async function publishFreeGuestComment"),
    server.indexOf("export async function createPaidCommentCheckout"),
  );
  assert.match(free, /from\("paid_comments"\)/);
  assert.doesNotMatch(free, /getStripeRuntime|createVariableAmountCheckout|payment_records/);
  assert.match(migration, /events_guest_comment_price_nonneg/);
});

test("safeguards run after publication and remove only real problems", () => {
  assert.equal(
    shouldRemoveAfterPublication({ deterministicReasons: [], providerFlagged: false }),
    false,
  );
  assert.equal(
    shouldRemoveAfterPublication({ deterministicReasons: ["links"], providerFlagged: false }),
    false,
  );
  assert.equal(
    shouldRemoveAfterPublication({ deterministicReasons: ["threat"], providerFlagged: false }),
    true,
  );
  assert.equal(
    shouldRemoveAfterPublication({ deterministicReasons: [], providerFlagged: true }),
    true,
  );
  assert.match(server, /is_hidden: true,/);
  assert.match(server, /provider\.provider === "openai" && provider\.status === "quarantined"/);
});

test("the guest-comment checkout is priced per event and reuses the existing checkout helper", () => {
  assert.match(server, /createVariableAmountCheckout\(\{/);
  assert.match(server, /kind: "paid_comment",/);
  assert.match(server, /amountMinor: input\.amountMinor,/);
  assert.match(server, /currency: input\.currency,/);
  // No fixed global price left to fall back to.
  assert.doesNotMatch(server, /PAID_COMMENT_PRICE_MINOR|STRIPE_PAID_COMMENT_PRICE_ID/);
  assert.match(server, /approved_body_sha256: bodySha256,/);
  assert.match(server, /body_sha256: bodySha256,/);
  assert.match(server, /status: "approved",/);
  assert.match(server, /guest_email: identity\.email,/);
  assert.match(server, /paid_comment=success&comment_id=/);
  assert.match(server, /paid_comment=canceled&comment_id=/);
});

test("createVariableAmountCheckout now covers event access and guest comments, not just tips", () => {
  assert.match(checkoutServer, /kind: "tip" \| "event_pass" \| "paid_comment"/);
});

test("the webhook posts the paid comment as the member who wrote it", () => {
  assert.match(webhook, /user_id: authorId,/);
  assert.match(webhook, /author_avatar_url: identity\?\.avatarUrl \?\? null,/);
  assert.match(webhook, /exactApprovedText/);
});

test("only the member (or the guest holding the unguessable comment id) can see how it is going", () => {
  assert.match(server, /\.is\("user_id", null\)/);
  assert.equal(paidCommentProgress("published"), "posted");
  assert.equal(paidCommentProgress("checkout_created"), "pending");
  assert.equal(paidCommentProgress("payment_failed"), "failed");
  assert.equal(paidCommentProgress("expired"), "failed");
  assert.equal(paidCommentProgress("refunded"), "failed");
});

test("watch and watch+chat access are purchased through the same event-pricing module the send path uses", () => {
  assert.match(eventAccessServer, /offerFor\(event, accessType\)/);
  assert.match(eventAccessServer, /if \(offer\.free\)/);
  assert.match(eventAccessServer, /granted_free: true,/);
  assert.match(eventAccessServer, /createVariableAmountCheckout\(\{/);
  assert.match(eventAccessServer, /kind: "event_pass",/);
  // Watch and watch+chat are separately toggleable and priced.
  assert.match(eventAccessServer, /watch: "Accountabul live event — watch access"/);
  assert.match(
    eventAccessServer,
    /watch_and_chat: "Accountabul live event — watch \+ chat access"/,
  );
});

test("a free event grants access directly, with no Stripe checkout", () => {
  const freeGrant = eventAccessServer.slice(
    eventAccessServer.indexOf("if (offer.free)"),
    eventAccessServer.indexOf("if (missingStripeCheckoutSecrets"),
  );
  assert.doesNotMatch(freeGrant, /getStripeRuntime|createVariableAmountCheckout/);
  assert.match(freeGrant, /status: "active",/);
});

test("an anonymous buyer is recognized afterward by a hashed cookie token, same as before", () => {
  assert.match(eventAccessServer, /accessTokenHash: string/);
  assert.match(eventAccessServer, /access_token_hash: buyer\.accessTokenHash/);
  assert.match(eventPassesRoute, /sha256Text\(rawToken\)/);
  assert.match(eventPassesRoute, /HttpOnly; Secure; SameSite=Lax/);
});

test("the webhook records which access type a completed purchase was for", () => {
  assert.match(
    webhook,
    /input\.payment\.metadata\["access_type"\] === "watch" \? "watch" : "watch_and_chat"/,
  );
  assert.match(webhook, /access_type: accessType,/);
});

test("buying event access re-verifies the price server-side; the caller only ever names an access type", () => {
  const handler = billingFunctions.slice(
    billingFunctions.indexOf("export const createEventPassCheckout"),
  );
  assert.doesNotMatch(handler, /amountMinor|amount_minor/);
  assert.match(handler, /accessType: "watch" \| "watch_and_chat"/);
  assert.match(handler, /loadEventForAccessPurchase\(data\.eventId\)/);
  assert.match(handler, /purchaseEventAccess\(\{/);
});

test("Ops configures prices on the existing events endpoint; a price of 0 is free, not 'unset'", () => {
  assert.match(opsEvents, /allowWatchPurchase/);
  assert.match(opsEvents, /allowWatchAndChatPurchase/);
  assert.match(opsEvents, /allowGuestComment/);
  assert.match(opsEvents, /watch_price_minor: watchPriceMinor,/);
  // Turning an access type on without a price is refused; the price itself may be 0.
  assert.match(opsEvents, /!allowWatchPurchase \|\| watchPriceMinor !== null/);
  assert.match(opsEvents, /Number\.isInteger\(value\)/);
});

test("the typed message survives sign-in, signup, and checkout", async () => {
  const values = installStorage();
  const { clearChatDraft, readChatDraft, writeChatDraft } =
    await import("../src/lib/live/chat-draft.ts");
  const eventId = "6f1f0b5a-6f0e-4e44-9a29-2c3b62f18f0b";
  const message = "Anybody know if this property has been evaluated?";

  writeChatDraft(eventId, { body: message, lifecycle: "pending_authentication" }, 1_000);
  assert.deepEqual(readChatDraft(eventId, 2_000), {
    body: message,
    lifecycle: "pending_authentication",
    savedAt: 1_000,
  });

  writeChatDraft(
    eventId,
    { body: message, lifecycle: "pending_payment", paidCommentId: "c-1" },
    3_000,
  );
  assert.equal(readChatDraft(eventId, 4_000)?.body, message);
  assert.equal(readChatDraft(eventId, 4_000)?.paidCommentId, "c-1");
  assert.equal(readChatDraft(eventId, 3_000 + 25 * 60 * 60 * 1000), null);

  writeChatDraft(eventId, { body: "   ", lifecycle: "draft" }, 6_000);
  assert.equal(readChatDraft(eventId, 6_000), null);
  writeChatDraft(eventId, { body: message, lifecycle: "draft" }, 7_000);
  clearChatDraft(eventId);
  assert.equal(values.size, 0);

  values.set(`accountabul:live-chat-draft:${eventId}`, "{not json");
  assert.equal(readChatDraft(eventId), null);
});

test("the draft is cleared only once the message is actually in the room", () => {
  const clears = panel.match(/clearChatDraft\(eventId\)/g) ?? [];
  assert.equal(clears.length, 1, "clearChatDraft should be called from one place");
  const messageSent = panel.slice(
    panel.indexOf("const messageSent"),
    panel.indexOf("const handleResult"),
  );
  assert.match(messageSent, /clearChatDraft\(eventId\)/);
  const handle = panel.slice(
    panel.indexOf("const handleResult"),
    panel.indexOf("const sendMessage"),
  );
  assert.equal(handle.match(/messageSent\(\)/g)?.length, 1);
  assert.doesNotMatch(handle, /setBody\(""\)/);
});

test("new accounts come back to the room they left, and only to safe paths", async () => {
  installStorage();
  const { isSafeReturnPath, rememberReturnTo, takeReturnTo } =
    await import("../src/lib/account.ts");
  assert.equal(isSafeReturnPath("/live/sandbox-room"), true);
  assert.equal(isSafeReturnPath("//evil.example"), false);
  assert.equal(isSafeReturnPath("https://evil.example"), false);

  rememberReturnTo("/live/sandbox-room", 1_000);
  assert.equal(takeReturnTo(2_000), "/live/sandbox-room");
  assert.equal(takeReturnTo(2_000), null, "the path is consumed once");

  rememberReturnTo("/live/sandbox-room", 1_000);
  assert.equal(takeReturnTo(1_000 + 3 * 60 * 60 * 1000), null, "stale paths are dropped");

  assert.match(onboarding, /takeReturnTo\(\) \?\? "\/dashboard"/);
});

test("the composer always looks open, shows the real price, and the old approval form is gone", () => {
  assert.match(panel, /placeholder="Write a message\.\.\."/);
  assert.doesNotMatch(panel, /<Textarea[^>]*disabled=/);
  assert.match(panel, /readOnly=\{pending\}/);
  assert.match(panel, /formatMoney\(prompt\.priceMinor, prompt\.currency\)/);
  assert.doesNotMatch(panel, /Pay \$1/);

  for (const removed of [
    "Submit for review",
    "Human approval happens before checkout",
    "Exact comment for review",
    "$1 paid guest comment",
    "GuestPaidCommentPanel",
    "Rejected comments are never charged",
  ]) {
    assert.ok(!livePage.includes(removed), `live page still contains "${removed}"`);
    assert.ok(!panel.includes(removed), `chat panel contains "${removed}"`);
  }
  assert.match(livePage, /<LiveChatPanel/);
  assert.match(panel, /By sending, you agree to the/);
  assert.doesNotMatch(panel, /<details/);
});

test("the event page shows real per-event watch and watch+chat prices, never a hard-coded number", () => {
  assert.match(livePage, /getEventAccessOffers/);
  assert.match(livePage, /Watch Event/);
  assert.match(livePage, /Watch \+ Chat/);
  assert.doesNotMatch(livePage, /\$5|\$10|\$15/);
});

test("the prompts offer exactly the right next steps", () => {
  assert.match(panel, /Join the conversation/);
  assert.match(panel, /Create a free Accountabul account or sign in to continue/);
  assert.match(panel, /search=\{\{ redirect: roomPath \}\}/);
  assert.match(panel, /Join Membership/);
  for (const notice of Object.values(CHAT_NOTICES)) {
    assert.ok(notice.length > 0 && notice.length < 160);
  }
  assert.equal(
    CHAT_NOTICES.paymentNotCompleted,
    "Payment wasn't completed. Your message is still here.",
  );
});

test("a watch-only pass unlocks video but not the room, in the shared entitlement helper too", () => {
  assert.match(entitlementServer, /highestPassAccessType/);
  assert.doesNotMatch(entitlementServer, /hasActivePass/);
});
