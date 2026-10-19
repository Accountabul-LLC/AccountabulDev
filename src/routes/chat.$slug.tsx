import { createFileRoute, Link } from "@tanstack/react-router";

import { Composer } from "@/components/community-chat/composer";
import { MessageStream } from "@/components/community-chat/message-stream";
import { ChatPolicyLink } from "@/components/community-chat/chat-policy";
import {
  useCommunityMessages,
  useCommunityRoom,
} from "@/components/community-chat/use-community-chat";
import { useSession } from "@/hooks/use-session";
import { Skeleton } from "@/components/ui/skeleton";
import { describeRoomAudience } from "@/lib/community-chat/chat";

export const Route = createFileRoute("/chat/$slug")({
  component: ChatRoomPage,
});

function ChatRoomPage() {
  const { slug } = Route.useParams();
  const { session } = useSession();
  const viewerId = session?.user.id ?? null;
  const { room, isPending: roomsPending } = useCommunityRoom(slug);
  const messages = useCommunityMessages(room?.id ?? null);

  if (roomsPending) {
    return (
      <section className="surface-card h-full p-4" aria-hidden>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-64 w-full" />
      </section>
    );
  }

  if (!room) {
    return (
      <section className="surface-card flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-semibold">This room is not available</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have been closed, or it may be open only to certain members. If you were expecting
          access, ask an Accountabul admin.
        </p>
        <Link to="/chat" className="text-sm text-accent underline">
          Back to your rooms
        </Link>
      </section>
    );
  }

  return (
    <section className="surface-card flex h-full min-h-0 flex-col overflow-hidden p-0">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{room.name}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {room.description ?? describeRoomAudience(room.access_policy)}
        </p>
      </header>

      <MessageStream
        // Remount per room so each one opens at its newest message.
        key={room.id}
        messages={messages.data ?? []}
        viewerId={viewerId}
        loading={messages.isPending}
        error={messages.isError}
        roomName={room.name}
      />

      <Composer room={room} />

      <footer className="flex shrink-0 justify-end border-t border-border px-4 py-1.5">
        <ChatPolicyLink />
      </footer>
    </section>
  );
}
