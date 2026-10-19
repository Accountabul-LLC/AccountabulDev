import { createContext, useContext } from "react";

export type LiveSession = { eventId: string; slug: string; title: string; authToken: string };

export type LiveDockValue = {
  session: LiveSession | null;
  openSession: (session: LiveSession) => void;
  closeSession: () => void;
  setStageTarget: (element: HTMLElement | null) => void;
};

export const LiveDockContext = createContext<LiveDockValue | null>(null);

export function useLiveDock() {
  const value = useContext(LiveDockContext);
  if (!value) throw new Error("useLiveDock must be used inside LiveDockProvider.");
  return value;
}
