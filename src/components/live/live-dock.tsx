import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";

import {
  LiveDockContext,
  type LiveDockValue,
  type LiveSession,
} from "@/components/live/live-dock-context";

/**
 * Keeps one live room mounted above the router.
 *
 * The room is rendered once, here, and portaled into whichever container is
 * currently registered. The event page registers its player box; when the
 * person navigates away that registration clears and the same, still-connected
 * video falls back into a corner dock. Nothing re-joins, so the stream does not
 * drop while they use the rest of the app.
 */

const LiveRoomMount = lazy(() => import("@/components/live/live-room-mount"));

export function LiveDockProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [stageTarget, setStageTarget] = useState<HTMLElement | null>(null);

  const openSession = useCallback((next: LiveSession) => {
    setSession((current) => (current?.authToken === next.authToken ? current : next));
  }, []);

  const closeSession = useCallback(() => {
    setSession(null);
    setStageTarget(null);
  }, []);

  const value = useMemo<LiveDockValue>(
    () => ({ session, openSession, closeSession, setStageTarget }),
    [session, openSession, closeSession],
  );

  return (
    <LiveDockContext.Provider value={value}>
      {children}
      {/* session is only ever set in the browser, so this stays inert on the server. */}
      {session ? (
        <Suspense fallback={null}>
          <LiveRoomMount session={session} target={stageTarget} onClose={closeSession} />
        </Suspense>
      ) : null}
    </LiveDockContext.Provider>
  );
}
