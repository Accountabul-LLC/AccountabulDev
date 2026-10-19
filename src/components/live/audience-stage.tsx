import { MediaTile } from "@/components/live/media-tile";
import {
  useOnStageParticipants,
  useSelfMedia,
  useSelfStageStatus,
} from "@/components/live/room-hooks";
import { StageInvite } from "@/components/live/stage-invite";

/**
 * The people currently on stage, plus the viewer own tile once they accept an
 * invite. Shared by the inline page player and the corner dock.
 */
export function AudienceStage() {
  const onStage = useOnStageParticipants();
  const self = useSelfMedia();
  const selfStatus = useSelfStageStatus();
  const selfOnStage = selfStatus === "ON_STAGE";
  const tileCount = onStage.length + (selfOnStage ? 1 : 0);

  return (
    <div className="flex size-full flex-col gap-3">
      <StageInvite />
      {tileCount === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-muted/40">
          <p className="text-sm text-muted-foreground">Waiting for the host camera...</p>
        </div>
      ) : (
        <div className={tileCount > 1 ? "grid flex-1 gap-3 sm:grid-cols-2" : "flex-1"}>
          {onStage.map((participant) => (
            <MediaTile
              key={participant.id}
              videoTrack={participant.videoTrack}
              audioTrack={participant.audioTrack}
              name={participant.name}
            />
          ))}
          {selfOnStage ? (
            <MediaTile
              videoTrack={self.videoTrack}
              audioTrack={self.audioTrack}
              name={self.name}
              isSelf
              label="You"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
