import { Link } from "@tanstack/react-router";
import { createPortal } from "react-dom";

import { AudienceStage } from "@/components/live/audience-stage";
import type { LiveSession } from "@/components/live/live-dock-context";
import { RtkRoom } from "@/components/live/rtk-room";

/**
 * The single mounted live room. Loaded lazily so the RealtimeKit SDK, which
 * touches browser globals at import time, never loads during server rendering.
 */
export default function LiveRoomMount({
  session,
  target,
  onClose,
}: {
  session: LiveSession;
  target: HTMLElement | null;
  onClose: () => void;
}) {
  return (
    <RtkRoom authToken={session.authToken} role="viewer">
      {target ? (
        createPortal(<AudienceStage />, target)
      ) : (
        <div className="fixed bottom-4 right-4 z-50 w-72 overflow-hidden rounded-lg border border-border bg-background shadow-lg sm:w-80">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="truncate text-xs font-medium">{session.title}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                to="/live/$slug"
                params={{ slug: session.slug }}
                className="text-xs text-accent underline"
              >
                Full screen
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label="Leave the live room"
              >
                Close
              </button>
            </div>
          </div>
          <AudienceStage />
        </div>
      )}
    </RtkRoom>
  );
}
