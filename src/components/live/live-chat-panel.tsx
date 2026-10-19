import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, Loader2, MessageCircle, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { rememberReturnTo } from "@/lib/account";
import { CHAT_NOTICES, type ChatSendResult } from "@/lib/conference/chat-access";
import { formatMoney } from "@/lib/format";
import {
  getLiveChatPaidCommentStatus,
  LIVE_CHAT_MAX_LENGTH,
  payForLiveChatComment,
  sendLiveChatMessage,
} from "@/lib/conference/live-chat.functions";
import {
  clearChatDraft,
  readChatDraft,
  writeChatDraft,
  type LiveChatDraft,
} from "@/lib/live/chat-draft";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/live/platform-icon";

type Standards = { id: string; version: string; title: string; body_markdown: string } | null;

type GuestIdentity = { displayName: string; email: string };

type Prompt =
  | { kind: "sign_in" }
  | {
      kind: "payment";
      purchasable: boolean;
      free: boolean;
      priceMinor: number | null;
      currency: string;
      /** Which mutation to retry once an anonymous visitor has given a name and email. */
      retry: "send" | "pay";
    }
  | null;

const NEAR_BOTTOM_PX = 120;
const PAID_COMMENT_POLL_MS = 2500;
const PAID_COMMENT_POLL_LIMIT = 36;
const GUEST_IDENTITY_KEY = "accountabul:live-chat-guest";
const GUEST_EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/**
 * A guest's name and email, remembered locally so paying to comment on a
 * second event (or a second comment on this one) doesn't ask again. Never
 * sent anywhere until they submit a comment; the server still re-validates.
 */
function readGuestIdentity(): GuestIdentity | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(GUEST_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestIdentity>;
    if (typeof parsed.displayName !== "string" || typeof parsed.email !== "string") return null;
    return { displayName: parsed.displayName, email: parsed.email };
  } catch {
    return null;
  }
}

function writeGuestIdentity(identity: GuestIdentity) {
  try {
    window.localStorage.setItem(GUEST_IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage full or blocked: the guest just re-enters it on their next comment.
  }
}

/**
 * Live room chat that always looks open.
 *
 * Anyone can read and type. Nothing about access is shown until Send, when the
 * server decides: publish now, sign in first, or membership / $1. The typed
 * message is kept through every one of those steps and sent once the
 * requirement is met, so nobody ever has to type it twice.
 */
export function LiveChatPanel({
  eventId,
  eventSlug,
  standards,
}: {
  eventId: string;
  eventSlug: string;
  standards: Standards;
}) {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const roomPath = `/live/${eventSlug}`;

  const send = useServerFn(sendLiveChatMessage);
  const pay = useServerFn(payForLiveChatComment);
  const paidStatus = useServerFn(getLiveChatPaidCommentStatus);

  const [body, setBody] = useState("");
  const [lifecycle, setLifecycle] = useState<LiveChatDraft["lifecycle"]>("draft");
  const [paidCommentId, setPaidCommentId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [standardsOpen, setStandardsOpen] = useState(false);
  const [guestInfo, setGuestInfo] = useState<GuestIdentity | null>(null);
  const [guestNameInput, setGuestNameInput] = useState("");
  const [guestEmailInput, setGuestEmailInput] = useState("");
  // State, not a ref: the save effect must not run until the restored text is in
  // the composer, or its first pass would erase the stored draft.
  const [hydrated, setHydrated] = useState(false);
  // One attempt id per exact text, so a retry of the same message is idempotent.
  const attempt = useRef<{ text: string; id: string } | null>(null);

  // Restore after hydration; the server render has no access to the draft.
  useEffect(() => {
    const draft = readChatDraft(eventId);
    if (draft) {
      setBody(draft.body);
      setLifecycle(draft.lifecycle);
      setPaidCommentId(draft.paidCommentId ?? null);
    }
    setGuestInfo(readGuestIdentity());
    setHydrated(true);
  }, [eventId]);

  // Prefill the guest-info fields whenever the payment prompt opens.
  useEffect(() => {
    if (prompt?.kind !== "payment" || userId) return;
    setGuestNameInput(guestInfo?.displayName ?? "");
    setGuestEmailInput(guestInfo?.email ?? "");
    // Only re-run when the prompt itself opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, userId]);

  useEffect(() => {
    if (!hydrated) return;
    writeChatDraft(eventId, {
      body,
      lifecycle,
      ...(paidCommentId ? { paidCommentId } : {}),
    });
  }, [hydrated, eventId, body, lifecycle, paidCommentId]);

  const attemptIdFor = (text: string) => {
    if (attempt.current?.text !== text) attempt.current = { text, id: crypto.randomUUID() };
    return attempt.current.id;
  };

  const messageSent = () => {
    attempt.current = null;
    setBody("");
    setLifecycle("draft");
    setPaidCommentId(null);
    clearChatDraft(eventId);
    void queryClient.invalidateQueries({ queryKey: ["chat", eventId] });
  };

  const handleResult = (result: ChatSendResult) => {
    switch (result.outcome) {
      case "published":
        setPrompt(null);
        messageSent();
        toast.success(CHAT_NOTICES.sent);
        return;
      case "checkout":
        setLifecycle("pending_payment");
        setPaidCommentId(result.commentId);
        writeChatDraft(eventId, {
          body,
          lifecycle: "pending_payment",
          paidCommentId: result.commentId,
        });
        window.location.assign(result.checkoutUrl);
        return;
      case "sign_in":
        // Marked pending only when they choose Sign In or Create Account, so a
        // dismissed prompt never sends the message on some later visit.
        setPrompt({ kind: "sign_in" });
        toast(CHAT_NOTICES.signIn);
        return;
      case "payment_required":
        setLifecycle("draft");
        setPrompt({
          kind: "payment",
          purchasable: result.purchasable,
          free: false,
          priceMinor: result.priceMinor,
          currency: result.currency,
          retry: "pay",
        });
        toast(
          result.purchasable && result.priceMinor
            ? `Chat is available with membership, or pay ${formatMoney(result.priceMinor, result.currency)} for this comment.`
            : CHAT_NOTICES.paymentRequired,
        );
        return;
      case "guest_info_required":
        setLifecycle("draft");
        setPrompt({
          kind: "payment",
          purchasable: true,
          free: result.free,
          priceMinor: result.priceMinor,
          currency: result.currency,
          retry: result.free ? "send" : "pay",
        });
        return;
      case "restricted":
        setPrompt(null);
        toast.error(CHAT_NOTICES.restricted);
        return;
      case "closed":
        setPrompt(null);
        toast.error(CHAT_NOTICES.closed);
        return;
    }
  };

  const sendMessage = useMutation({
    mutationFn: ({ text, guest }: { text: string; guest?: GuestIdentity }) =>
      send({
        data: {
          eventId,
          body: text,
          attemptId: attemptIdFor(text),
          ...(guest ? { guestDisplayName: guest.displayName, guestEmail: guest.email } : {}),
        },
      }),
    onSuccess: handleResult,
    onError: (error: Error) =>
      toast.error(/too many/i.test(error.message) ? error.message : CHAT_NOTICES.sendFailed),
  });

  const payForComment = useMutation({
    mutationFn: ({ text, guest }: { text: string; guest?: GuestIdentity }) =>
      pay({
        data: {
          eventId,
          body: text,
          attemptId: attemptIdFor(text),
          ...(guest ? { guestDisplayName: guest.displayName, guestEmail: guest.email } : {}),
        },
      }),
    onSuccess: (result) => {
      if (result.outcome === "payment_required" && !result.purchasable) {
        toast.error(CHAT_NOTICES.paidCommentUnavailable);
        setPrompt({
          kind: "payment",
          purchasable: false,
          free: false,
          priceMinor: null,
          currency: "USD",
          retry: "pay",
        });
        return;
      }
      handleResult(result);
    },
    onError: () => toast.error(CHAT_NOTICES.paymentNotCompleted),
  });

  const submit = () => {
    const text = body.normalize("NFKC").trim();
    if (!text || sendMessage.isPending || lifecycle === "pending_payment") return;
    sendMessage.mutate({ text, ...(guestInfo ? { guest: guestInfo } : {}) });
  };

  const confirmGuestInfo = () => {
    const displayName = guestNameInput.trim();
    const email = guestEmailInput.trim().toLowerCase();
    if (!displayName || displayName.length > 80) {
      toast.error("Enter your name.");
      return;
    }
    if (!GUEST_EMAIL_PATTERN.test(email)) {
      toast.error("Enter a valid email.");
      return;
    }
    const identity = { displayName, email };
    setGuestInfo(identity);
    writeGuestIdentity(identity);
    const text = body.normalize("NFKC").trim();
    if (!text || prompt?.kind !== "payment") return;
    if (prompt.retry === "send") sendMessage.mutate({ text, guest: identity });
    else payForComment.mutate({ text, guest: identity });
  };

  // Back from sign-in or signup: re-check access and send the waiting message.
  const resumedAfterAuth = useRef(false);
  useEffect(() => {
    if (!hydrated || sessionLoading || !userId || resumedAfterAuth.current) return;
    if (lifecycle !== "pending_authentication" || !body.trim()) return;
    resumedAfterAuth.current = true;
    setLifecycle("draft");
    sendMessage.mutate({ text: body.normalize("NFKC").trim() });
  }, [hydrated, sessionLoading, userId, lifecycle, body, sendMessage]);

  // Back from Stripe: report the outcome and watch for the webhook to post it.
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("paid_comment");
    if (!outcome) return;
    handledReturn.current = true;
    const returnedCommentId = params.get("comment_id");
    params.delete("paid_comment");
    params.delete("comment_id");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    if (outcome === "success") {
      toast.success(CHAT_NOTICES.paymentConfirmed);
      setLifecycle("pending_payment");
      if (returnedCommentId) setPaidCommentId(returnedCommentId);
    } else {
      toast(CHAT_NOTICES.paymentNotCompleted);
      setLifecycle("draft");
      setPaidCommentId(null);
    }
  }, []);

  // A guest is recognized here by the unguessable comment id alone, so
  // polling works whether or not they ever signed in.
  const polling = lifecycle === "pending_payment" && Boolean(paidCommentId);
  const polls = useRef(0);
  useEffect(() => {
    if (!polling || !paidCommentId) return;
    let cancelled = false;
    polls.current = 0;
    const check = async () => {
      if (cancelled) return;
      polls.current += 1;
      try {
        const status = await paidStatus({ data: { commentId: paidCommentId } });
        if (cancelled) return;
        if (status.progress === "posted") {
          messageSent();
          toast.success(CHAT_NOTICES.commentPosted);
          return;
        }
        if (status.progress === "failed") {
          setLifecycle("draft");
          setPaidCommentId(null);
          toast(CHAT_NOTICES.paymentNotCompleted);
          return;
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (polls.current < PAID_COMMENT_POLL_LIMIT) {
        timer = window.setTimeout(check, PAID_COMMENT_POLL_MS);
      }
    };
    let timer = window.setTimeout(check, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // messageSent is stable in effect for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, paidCommentId, paidStatus]);

  const beginSignIn = () => {
    writeChatDraft(eventId, { body, lifecycle: "pending_authentication" });
  };
  const beginSignup = () => {
    writeChatDraft(eventId, { body, lifecycle: "pending_authentication" });
    rememberReturnTo(roomPath);
  };
  const beginMembership = () => rememberReturnTo(roomPath);

  const pending = lifecycle === "pending_payment";
  const busy = sendMessage.isPending || payForComment.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageList eventId={eventId} viewerId={userId} />

      <form
        className="mt-3 shrink-0"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={LIVE_CHAT_MAX_LENGTH}
            readOnly={pending}
            placeholder="Write a message..."
            aria-label="Chat message"
            className="max-h-32 min-h-10 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!body.trim() || busy || pending}
            aria-label="Send"
          >
            {busy || pending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {pending ? (
            "Posting your comment…"
          ) : (
            <>
              By sending, you agree to the{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setStandardsOpen(true)}
                disabled={!standards}
              >
                Community Standards
              </button>
              .
            </>
          )}
        </p>
      </form>

      <Dialog open={prompt !== null} onOpenChange={(open) => !open && setPrompt(null)}>
        <DialogContent className="sm:max-w-md">
          {prompt?.kind === "sign_in" ? (
            <>
              <DialogHeader>
                <DialogTitle>Join the conversation</DialogTitle>
                <DialogDescription>
                  Create a free Accountabul account or sign in to continue. Your message will be
                  waiting.
                </DialogDescription>
              </DialogHeader>
              <DraftPreview body={body} />
              <DialogFooter className="gap-2 sm:gap-2">
                <Button asChild variant="outline">
                  <Link to="/signup/individual" onClick={beginSignup}>
                    Create Account
                  </Link>
                </Button>
                <Button asChild>
                  <Link to="/login" search={{ redirect: roomPath }} onClick={beginSignIn}>
                    Sign In
                  </Link>
                </Button>
              </DialogFooter>
            </>
          ) : prompt?.kind === "payment" ? (
            <>
              <DialogHeader>
                <DialogTitle>Join the chat</DialogTitle>
                <DialogDescription>
                  {prompt.purchasable && prompt.free
                    ? "This event's chat is free for guest comments — no account needed."
                    : prompt.purchasable && prompt.priceMinor
                      ? `Chat access comes with membership, or you can pay ${formatMoney(prompt.priceMinor, prompt.currency)} to post this comment as a guest — no account needed.`
                      : "Chat access comes with membership."}
                </DialogDescription>
              </DialogHeader>
              <DraftPreview body={body} />
              <div className="grid gap-2">
                {prompt.purchasable ? (
                  <div className="rounded-md border border-border p-2.5">
                    {!userId ? (
                      <div className="mb-2 grid gap-2">
                        <div className="grid gap-1">
                          <Label htmlFor="guest-name" className="text-xs">
                            Your name
                          </Label>
                          <Input
                            id="guest-name"
                            value={guestNameInput}
                            onChange={(event) => setGuestNameInput(event.target.value)}
                            maxLength={80}
                            placeholder="Jane Doe"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="guest-email" className="text-xs">
                            Email
                          </Label>
                          <Input
                            id="guest-email"
                            type="email"
                            value={guestEmailInput}
                            onChange={(event) => setGuestEmailInput(event.target.value)}
                            placeholder="jane@example.com"
                          />
                        </div>
                      </div>
                    ) : null}
                    <Button
                      className="h-auto w-full flex-col items-start gap-0.5 py-2.5 text-left"
                      disabled={payForComment.isPending || sendMessage.isPending}
                      onClick={() => {
                        if (!userId) {
                          confirmGuestInfo();
                          return;
                        }
                        payForComment.mutate({ text: body.normalize("NFKC").trim() });
                      }}
                    >
                      <span className="flex items-center gap-2">
                        {payForComment.isPending || sendMessage.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        {prompt.free || !prompt.priceMinor
                          ? "Post Comment"
                          : `Pay ${formatMoney(prompt.priceMinor, prompt.currency)} to Comment`}
                      </span>
                      <span className="text-xs font-normal opacity-80">
                        {prompt.free || !prompt.priceMinor
                          ? "Your message posts right away."
                          : "One-time comment access. Your message posts as soon as payment completes."}
                      </span>
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Paying per comment isn't available right now.
                  </p>
                )}
                <Button
                  asChild
                  variant="outline"
                  className="h-auto flex-col items-start gap-0.5 py-2.5 text-left"
                >
                  <Link to="/pricing" onClick={beginMembership}>
                    <span>Join Membership</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      Chat in every room, plus everything else membership includes.
                    </span>
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={standardsOpen} onOpenChange={setStandardsOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{standards?.title ?? "Community Standards"}</DialogTitle>
            {standards ? <DialogDescription>Version {standards.version}</DialogDescription> : null}
          </DialogHeader>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {standards?.body_markdown}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DraftPreview({ body }: { body: string }) {
  if (!body.trim()) return null;
  return (
    <blockquote className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <MessageCircle className="size-3" aria-hidden />
        Your message
      </span>
      <span className="line-clamp-4 whitespace-pre-wrap break-words">{body}</span>
    </blockquote>
  );
}

type LiveMessage = {
  id: string;
  body: string;
  kind: string;
  created_at: string;
  user_id: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_badge: string | null;
  source: string;
};

const PLATFORM_SOURCES = new Set(["youtube", "twitch", "kick"]);

const BADGE_LABEL: Record<string, string> = {
  moderator: "Moderator",
  paid_guest: "Guest comment",
  event_guest: "Pass",
  external: "External",
};

function initialsFor(name: string | null, fallback: string) {
  const letters = (name ?? "")
    .replace(/^@/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (letters || fallback.slice(0, 2)).toUpperCase();
}

function timeOf(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function MessageList({ eventId, viewerId }: { eventId: string; viewerId: string | null }) {
  const queryClient = useQueryClient();
  const logRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const opened = useRef(false);
  const [unseen, setUnseen] = useState(0);

  const messages = useQuery({
    queryKey: ["chat", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select(
          "id, body, kind, created_at, user_id, author_display_name, author_avatar_url, author_badge, source",
        )
        .eq("event_id", eventId)
        .order("published_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as LiveMessage[];
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`conference-chat:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `event_id=eq.${eventId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["chat", eventId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [eventId, queryClient]);

  const list = messages.data ?? [];
  const last = list.at(-1);

  const toNewest = () => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
    nearBottom.current = true;
    setUnseen(0);
  };

  useLayoutEffect(() => {
    if (!last || !logRef.current) return;
    if (!opened.current || nearBottom.current || (viewerId && last.user_id === viewerId)) {
      opened.current = true;
      toNewest();
    } else {
      setUnseen((count) => count + 1);
    }
    // Only a new newest message moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-label="Room chat messages"
        onScroll={() => {
          const log = logRef.current;
          if (!log) return;
          nearBottom.current = log.scrollHeight - log.clientHeight - log.scrollTop < NEAR_BOTTOM_PX;
          if (nearBottom.current && unseen > 0) setUnseen(0);
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1"
      >
        {messages.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the conversation…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Say hello.</p>
        ) : (
          list.map((message) => {
            const mine = Boolean(viewerId) && message.user_id === viewerId;
            const name = mine
              ? "You"
              : message.author_display_name || (message.user_id ? "Member" : "Guest");
            const avatar =
              message.author_avatar_url && /^https:\/\//i.test(message.author_avatar_url)
                ? message.author_avatar_url
                : null;
            const badge = message.author_badge ? BADGE_LABEL[message.author_badge] : undefined;
            return (
              <div key={message.id} className="flex gap-2.5">
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-8 shrink-0 rounded-full bg-secondary object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold ring-1 ring-primary/30"
                  >
                    {initialsFor(message.author_display_name, message.user_id ?? message.id)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className={cn("text-sm font-semibold", mine && "text-accent")}>
                      {name}
                    </span>
                    {badge ? (
                      <span className="rounded-full border border-border px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {badge}
                      </span>
                    ) : null}
                    {PLATFORM_SOURCES.has(message.source) ? (
                      <PlatformIcon source={message.source} />
                    ) : message.source !== "accountabul" && message.source !== "paid_guest" ? (
                      <span className="rounded-full bg-secondary px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {message.source}
                      </span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground">
                      {timeOf(message.created_at)}
                    </span>
                  </p>
                  <p
                    className={cn(
                      "text-sm leading-relaxed whitespace-pre-wrap break-words",
                      message.kind === "tip" && "font-medium text-accent",
                    )}
                  >
                    {message.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      {unseen > 0 ? (
        <button
          type="button"
          onClick={toNewest}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium shadow-sm"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {unseen === 1 ? "1 new message" : `${unseen} new messages`}
        </button>
      ) : null}
    </div>
  );
}
