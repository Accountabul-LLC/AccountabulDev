import { ArrowDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { ReportMessageButton } from "@/components/community-chat/report-message";
import { Skeleton } from "@/components/ui/skeleton";
import {
  authorInitials,
  avatarSource,
  authorLabel,
  formatMessageTime,
  groupMessages,
  type CommunityMessage,
} from "@/lib/community-chat/chat";
import { cn } from "@/lib/utils";

/** Within this distance of the bottom, new messages keep the view pinned. */
const NEAR_BOTTOM_PX = 120;

export function MessageStream({
  messages,
  viewerId,
  loading,
  error,
  roomName,
}: {
  messages: CommunityMessage[];
  viewerId: string | null;
  loading: boolean;
  error: boolean;
  roomName: string;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const nearBottom = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const last = messages.at(-1);
  const lastId = last?.id ?? null;
  const hasMessages = lastId !== null;

  // Scroll the history itself, never the page. scrollIntoView would also move
  // every scrollable ancestor, including the document.
  const toNewest = () => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
    nearBottom.current = true;
    setUnseen(0);
  };

  useLayoutEffect(() => {
    if (!logRef.current || !lastId) return;
    if (!opened.current) {
      // First paint of a room opens at the newest message.
      opened.current = true;
      toNewest();
      return;
    }
    const ownMessage = viewerId !== null && last?.user_id === viewerId;
    if (nearBottom.current || ownMessage) {
      toNewest();
    } else {
      // Someone is reading older history: leave them there and say so.
      setUnseen((count) => count + 1);
    }
    // Only a new newest message should move the view, not a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, loading]);

  // A shorter history pane (phone keyboard opening, window resize) would leave
  // the reader stranded above the newest message. Stay pinned if they were there.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, [loading, hasMessages]);

  const onScroll = () => {
    const log = logRef.current;
    if (!log) return;
    nearBottom.current = log.scrollHeight - log.clientHeight - log.scrollTop < NEAR_BOTTOM_PX;
    if (nearBottom.current && unseen > 0) setUnseen(0);
  };

  if (loading) {
    return (
      <div className="min-h-0 flex-1 space-y-4 p-4" aria-hidden>
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="min-h-0 flex-1 p-4 text-sm text-muted-foreground">
        The messages in {roomName} could not be loaded. Refresh to try again.
      </p>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="min-h-0 flex-1 p-4 text-sm text-muted-foreground">
        No messages in {roomName} yet. Start the conversation.
      </p>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        role="log"
        aria-label={`${roomName} messages`}
      >
        {groupMessages(messages).map((group) => (
          <section key={group.dayKey} aria-label={group.label}>
            {/* An inline divider, as in Discord: it scrolls with the history
                instead of floating over the messages. */}
            <div
              role="separator"
              aria-label={group.label}
              className="my-3 flex items-center gap-3 text-[11px] font-semibold text-muted-foreground"
            >
              <span aria-hidden className="h-px flex-1 bg-border" />
              <span>{group.label}</span>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            <ul className="space-y-0.5">
              {group.messages.map((message) => {
                const mine = viewerId !== null && message.user_id === viewerId;
                return (
                  <li
                    key={message.id}
                    className={cn(
                      "group relative flex gap-3 rounded-md px-2 py-1.5 hover:bg-secondary/30",
                      message.continuesAuthor ? "pt-0.5" : "mt-3 first:mt-0",
                    )}
                  >
                    <span aria-hidden className="w-9 shrink-0">
                      {message.continuesAuthor ? null : avatarSource(message) ? (
                        <img
                          src={avatarSource(message)!}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-9 rounded-full bg-secondary object-cover"
                        />
                      ) : (
                        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-foreground ring-1 ring-primary/30">
                          {authorInitials(message)}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {message.continuesAuthor ? null : (
                        <p className="flex flex-wrap items-baseline gap-2">
                          <span className={cn("text-sm font-semibold", mine && "text-accent")}>
                            {authorLabel(message, viewerId)}
                          </span>
                          {message.author_badge !== "member" ? (
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {message.author_badge}
                            </span>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            {formatMessageTime(message.created_at)}
                          </span>
                        </p>
                      )}
                      <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {message.body}
                      </p>
                    </div>
                    {mine ? null : (
                      <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                        <ReportMessageButton
                          messageId={message.id}
                          roomId={message.room_id}
                          authorLabel={authorLabel(message, viewerId)}
                        />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {unseen > 0 ? (
        <button
          type="button"
          onClick={toNewest}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {unseen === 1 ? "1 new message" : `${unseen} new messages`}
        </button>
      ) : null}
    </div>
  );
}
