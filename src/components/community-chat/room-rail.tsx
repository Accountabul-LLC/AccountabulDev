import { Link } from "@tanstack/react-router";
import { Lock, MessagesSquare, Store, Users } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import type { CommunityAccessPolicy, CommunityRoomSummary } from "@/lib/community-chat/chat";
import { cn } from "@/lib/utils";

const POLICY_ICON: Record<CommunityAccessPolicy, typeof MessagesSquare> = {
  signed_in: MessagesSquare,
  verified_vendor: Store,
  role_allowlist: Users,
  user_allowlist: Lock,
};

export function RoomRail({
  rooms,
  activeSlug,
  loading,
}: {
  rooms: CommunityRoomSummary[];
  activeSlug: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex gap-2 lg:flex-col" aria-hidden>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-9 w-28 lg:h-14 lg:w-full" />
        ))}
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <p className="surface-card p-4 text-sm text-muted-foreground">
        No rooms are open to your account yet. An Accountabul admin opens rooms from the operations
        console.
      </p>
    );
  }

  return (
    // A scrolling strip of rooms on phones keeps the conversation on screen; on
    // wide screens it becomes a column that scrolls on its own.
    <nav
      aria-label="Chat rooms"
      className="-mx-1 flex min-h-0 gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:px-0 lg:pb-0"
    >
      {rooms.map((room) => {
        const Icon = POLICY_ICON[room.access_policy];
        const active = room.slug === activeSlug;
        return (
          <Link
            key={room.id}
            to="/chat/$slug"
            params={{ slug: room.slug }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-start gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left transition-colors lg:py-2.5",
              active
                ? "border-border bg-secondary/70"
                : "hover:border-border hover:bg-secondary/40",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium whitespace-nowrap">
                {room.name}
              </span>
              {room.description ? (
                <span className="mt-0.5 hidden truncate text-xs text-muted-foreground lg:block">
                  {room.description}
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
