/**
 * The message someone typed in a live room, kept safe across everything that
 * can interrupt sending it: signing in, creating an account (including an email
 * confirmation link opened in a new tab), Google sign-in, and Stripe checkout.
 *
 * localStorage rather than component state, because each of those is a full
 * page navigation. Kept per event, and dropped after a day so an old draft does
 * not resurface weeks later.
 */

import type { ChatMessageLifecycle } from "@/lib/conference/chat-access";

const PREFIX = "accountabul:live-chat-draft:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type LiveChatDraft = {
  body: string;
  lifecycle: Extract<ChatMessageLifecycle, "draft" | "pending_authentication" | "pending_payment">;
  /** Set while a $1 checkout is in progress for this exact text. */
  paidCommentId?: string;
  savedAt: number;
};

function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChatDraft(eventId: string, now = Date.now()): LiveChatDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + eventId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiveChatDraft>;
    if (typeof parsed.body !== "string" || typeof parsed.savedAt !== "number") return null;
    if (now - parsed.savedAt > MAX_AGE_MS) {
      store.removeItem(PREFIX + eventId);
      return null;
    }
    const lifecycle =
      parsed.lifecycle === "pending_authentication" || parsed.lifecycle === "pending_payment"
        ? parsed.lifecycle
        : "draft";
    return {
      body: parsed.body,
      lifecycle,
      ...(typeof parsed.paidCommentId === "string" ? { paidCommentId: parsed.paidCommentId } : {}),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function writeChatDraft(
  eventId: string,
  draft: Omit<LiveChatDraft, "savedAt">,
  now = Date.now(),
) {
  const store = storage();
  if (!store) return;
  try {
    if (!draft.body.trim()) {
      store.removeItem(PREFIX + eventId);
      return;
    }
    store.setItem(PREFIX + eventId, JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    // Storage full or blocked: the draft still lives in the composer.
  }
}

/** Only once the message is actually in the room. */
export function clearChatDraft(eventId: string) {
  try {
    storage()?.removeItem(PREFIX + eventId);
  } catch {
    // Nothing to clean up.
  }
}
