import { useState } from "react";

import { MediaTile } from "@/components/live/media-tile";
import { useMeeting, useOnStageParticipants, useSelfMedia } from "@/components/live/room-hooks";
import { RtkRoom } from "@/components/live/rtk-room";
import { StageControls } from "@/components/live/stage-controls";
import { Button } from "@/components/ui/button";

/**
 * The host's on-air view. The room is already public by the time this renders —
 * the green room and countdown live upstream in the studio page.
 */
export function HostBroadcast({
  authToken,
  slug,
  onEndStream,
  ending,
}: {
  authToken: string;
  slug: string;
  onEndStream: () => void;
  ending: boolean;
}) {
  return (
    <RtkRoom authToken={authToken} role="host">
      <HostStage slug={slug} onEndStream={onEndStream} ending={ending} />
    </RtkRoom>
  );
}

function HostStage({
  slug,
  onEndStream,
  ending,
}: {
  slug: string;
  onEndStream: () => void;
  ending: boolean;
}) {
  const meeting = useMeeting();
  const self = useSelfMedia();
  const callers = useOnStageParticipants();
  const [busy, setBusy] = useState(false);

  async function toggleVideo() {
    setBusy(true);
    try {
      if (self.videoEnabled) await meeting.self.disableVideo();
      else await meeting.self.enableVideo();
    } finally {
      setBusy(false);
    }
  }

  async function toggleAudio() {
    setBusy(true);
    try {
      if (self.audioEnabled) await meeting.self.disableAudio();
      else await meeting.self.enableAudio();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MediaTile
          videoTrack={self.videoTrack}
          audioTrack={self.audioTrack}
          name={self.name}
          isSelf
          label="You — live"
        />
        {callers.map((caller) => (
          <MediaTile
            key={caller.id}
            videoTrack={caller.videoTrack}
            audioTrack={caller.audioTrack}
            name={caller.name}
            label="On stage"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void toggleVideo()}>
          {self.videoEnabled ? "Turn camera off" : "Turn camera on"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void toggleAudio()}>
          {self.audioEnabled ? "Mute" : "Unmute"}
        </Button>
        <Button type="button" variant="destructive" disabled={ending} onClick={onEndStream}>
          {ending ? "Ending…" : "End stream"}
        </Button>
      </div>
      <StageControls slug={slug} />
    </div>
  );
}
