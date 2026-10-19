import type { RTKParticipant, StageStatus } from "@cloudflare/realtimekit";
import { useRealtimeKitMeeting, useRealtimeKitSelector } from "@cloudflare/realtimekit-react";

export type StageParticipant = {
  id: string;
  userId: string;
  /** The Accountabul user UUID, carried as custom_participant_id. */
  accountabulUserId: string | undefined;
  name: string;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  stageStatus: StageStatus;
};

function toStageParticipant(participant: RTKParticipant): StageParticipant {
  return {
    id: participant.id,
    userId: participant.userId,
    accountabulUserId: participant.customParticipantId,
    name: participant.name || "Guest",
    videoTrack: participant.videoEnabled ? (participant.videoTrack ?? null) : null,
    audioTrack: participant.audioEnabled ? (participant.audioTrack ?? null) : null,
    stageStatus: participant.stageStatus,
  };
}

/** Everyone currently publishing. */
export function useOnStageParticipants(): StageParticipant[] {
  return useRealtimeKitSelector((meeting) =>
    [...meeting.participants.joined.values()]
      .filter((participant) => participant.stageStatus === "ON_STAGE")
      .map(toStageParticipant),
  );
}

/** Everyone in the room, on stage or not — the host picks invitees from here. */
export function useRoomParticipants(): StageParticipant[] {
  return useRealtimeKitSelector((meeting) =>
    [...meeting.participants.joined.values()].map(toStageParticipant),
  );
}

export function useSelfStageStatus(): StageStatus {
  return useRealtimeKitSelector((meeting) => meeting.self.stageStatus);
}

export function useSelfMedia() {
  return useRealtimeKitSelector((meeting) => ({
    videoTrack: meeting.self.videoEnabled ? (meeting.self.videoTrack ?? null) : null,
    audioTrack: meeting.self.audioEnabled ? (meeting.self.audioTrack ?? null) : null,
    videoEnabled: meeting.self.videoEnabled,
    audioEnabled: meeting.self.audioEnabled,
    name: meeting.self.name || "You",
  }));
}

export function useMeeting() {
  return useRealtimeKitMeeting().meeting;
}
