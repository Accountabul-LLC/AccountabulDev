import { createFileRoute } from "@tanstack/react-router";

import { useCommunityRooms } from "@/components/community-chat/use-community-chat";

export const Route = createFileRoute("/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const rooms = useCommunityRooms();

  return (
    <section className="surface-card flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-semibold">
        {rooms.isPending
          ? "Loading your rooms…"
          : rooms.data && rooms.data.length > 0
            ? "Choose a room"
            : "No rooms yet"}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {rooms.isPending
          ? "Checking which rooms are open to your account."
          : rooms.data && rooms.data.length > 0
            ? "Pick a room to read along and join in. Each room keeps its own conversation."
            : "Nothing is open to your account yet. Rooms are created by Accountabul admins and appear here immediately."}
      </p>
    </section>
  );
}
