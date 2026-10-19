import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { useMeeting, useRoomParticipants } from "@/components/live/room-hooks";
import { Button } from "@/components/ui/button";
import { confirmStageInvite, removeFromLiveRoom } from "@/lib/conference/studio.functions";

/**
 * Host-side stage control. The host picks a name from the room; the server
 * decides whether that person may actually take the stage before any media
 * access is granted.
 */
export function StageControls({ slug }: { slug: string }) {
  const meeting = useMeeting();
  const participants = useRoomParticipants();
  const authorizeInvite = useServerFn(confirmStageInvite);
  const recordRemoval = useServerFn(removeFromLiveRoom);

  const invite = useMutation({
    mutationFn: async (participant: { userId: string; accountabulUserId: string | undefined }) => {
      if (!participant.accountabulUserId) {
        throw new Error("This participant has no Accountabul account to invite.");
      }
      await authorizeInvite({
        data: { slug, targetUserId: participant.accountabulUserId },
      });
      // Only after the server agrees does the provider grant publish rights.
      await meeting.stage.grantAccess([participant.userId]);
    },
    onSuccess: () => toast.success("Invite sent. They join once they accept."),
    onError: (error: Error) => toast.error(error.message),
  });

  const sendBack = useMutation({
    mutationFn: (participant: { userId: string }) => meeting.stage.kick([participant.userId]),
    onSuccess: () => toast.success("Returned to the audience."),
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (participant: {
      id: string;
      name: string;
      accountabulUserId: string | undefined;
    }) => {
      if (!participant.accountabulUserId) {
        throw new Error("This participant has no Accountabul account to remove.");
      }
      // Record the ban first, so a reconnect is refused even if the kick races.
      await recordRemoval({ data: { slug, targetUserId: participant.accountabulUserId } });
      await meeting.participants.joined.get(participant.id)?.kick();
    },
    onSuccess: () => toast.success("Removed from the room for the rest of this event."),
    onError: (error: Error) => toast.error(error.message),
  });

  function confirmRemove(participant: {
    id: string;
    name: string;
    accountabulUserId: string | undefined;
  }) {
    if (window.confirm(`Remove ${participant.name} from this live room? They cannot rejoin.`)) {
      remove.mutate(participant);
    }
  }

  const audience = participants.filter((participant) => participant.stageStatus !== "ON_STAGE");
  const onStage = participants.filter((participant) => participant.stageStatus === "ON_STAGE");

  return (
    <section className="surface-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Stage</h2>

      {onStage.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">On stage now</p>
          {onStage.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="text-sm">{participant.name}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={sendBack.isPending}
                  onClick={() => sendBack.mutate(participant)}
                >
                  Return to audience
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => confirmRemove(participant)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium">In the room</p>
        {audience.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody else has joined yet.</p>
        ) : (
          audience.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="text-sm">
                {participant.name}
                {participant.stageStatus === "ACCEPTED_TO_JOIN_STAGE" ? (
                  <span className="ml-2 text-xs text-muted-foreground">invited, waiting</span>
                ) : null}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    invite.isPending || participant.stageStatus === "ACCEPTED_TO_JOIN_STAGE"
                  }
                  onClick={() => invite.mutate(participant)}
                >
                  Bring to stage
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => confirmRemove(participant)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
