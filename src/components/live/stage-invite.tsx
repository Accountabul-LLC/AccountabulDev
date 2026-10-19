import { useState } from "react";
import { toast } from "sonner";

import { useMeeting, useSelfStageStatus } from "@/components/live/room-hooks";
import { Button } from "@/components/ui/button";

/**
 * Viewer-side stage invite. The camera and microphone stay off until the person
 * presses Accept, and everything happens on this page - there is no second URL.
 */
export function StageInvite() {
  const meeting = useMeeting();
  const status = useSelfStageStatus();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await meeting.stage.join();
      toast.success("You are on stage.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not join the stage.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await meeting.stage.leave();
      toast.success("You are back in the audience.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not leave the stage.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "ACCEPTED_TO_JOIN_STAGE") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent bg-accent/10 px-4 py-3">
        <p className="text-sm">
          <span className="font-medium">The host invited you on stage.</span> Your camera and
          microphone turn on only when you accept.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void accept()}>
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void leave()}
          >
            Not now
          </Button>
        </div>
      </div>
    );
  }

  if (status === "ON_STAGE") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-sm font-medium">You are live on stage.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void leave()}
        >
          Leave stage
        </Button>
      </div>
    );
  }

  return null;
}
