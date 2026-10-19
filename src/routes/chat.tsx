import { createFileRoute, Link, Outlet, useParams } from "@tanstack/react-router";

import { RoomRail } from "@/components/community-chat/room-rail";
import { useCommunityRooms } from "@/components/community-chat/use-community-chat";
import { useFillViewport } from "@/components/community-chat/use-fill-viewport";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Community chat — Accountabul" },
      {
        name: "description",
        content:
          "Talk with other Accountabul members: real estate, vendors, deal evaluation, and help.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Community chat — Accountabul" },
      {
        property: "og:description",
        content: "Member conversations across Accountabul's community rooms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatLayout,
});

function ChatLayout() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div className="container-page py-16">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container-page py-16">
        <div className="surface-card max-w-md p-6">
          <h1 className="text-2xl font-semibold">Community chat</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Chat rooms are for signed-in Accountabul members.{" "}
            <Link to="/login" search={{}} className="text-accent underline">
              Sign in
            </Link>{" "}
            to see the rooms open to your account.
          </p>
        </div>
      </div>
    );
  }

  return <ChatShell />;
}

/**
 * Full-screen chat: the shell fills the viewport under the site header, the
 * page never scrolls, and only the room list and message history scroll inside
 * it. Mounted only for signed-in members so the scroll lock never applies to
 * the sign-in prompt.
 */
function ChatShell() {
  const rooms = useCommunityRooms();
  // Present on /chat/$slug, absent on /chat.
  const params = useParams({ strict: false }) as { slug?: string };
  const shell = useFillViewport<HTMLDivElement>();

  return (
    <div
      ref={shell}
      className="container-page flex min-h-0 flex-col gap-3 py-3 lg:grid lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-6 lg:py-6"
    >
      <aside className="flex min-h-0 shrink-0 flex-col gap-2 lg:gap-4">
        <header className="flex items-baseline justify-between gap-3 lg:block">
          <h1 className="text-lg font-semibold tracking-tight lg:text-2xl">Chat</h1>
          <p className="hidden text-sm text-muted-foreground lg:mt-1 lg:block">
            Rooms open to your account. New rooms appear here as soon as an admin opens them.
          </p>
        </header>
        <RoomRail
          rooms={rooms.data ?? []}
          activeSlug={params.slug ?? null}
          loading={rooms.isPending}
        />
      </aside>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
