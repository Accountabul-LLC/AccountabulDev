import type RTKClient from "@cloudflare/realtimekit";
import { RealtimeKitProvider, useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import { useEffect, useState, type ReactNode } from "react";

export type RoomRole = "host" | "viewer";

/**
 * Boots a RealtimeKit client from a server-issued auth token and joins the room.
 *
 * The host publishes on join. A viewer joins with camera and mic off and only
 * ever publishes after accepting a stage invite, so audience cameras stay dark
 * until the person opts in.
 */
export function RtkRoom({
  authToken,
  role,
  children,
  fallback,
}: {
  authToken: string;
  role: RoomRole;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let joined: RTKClient | undefined;

    void (async () => {
      try {
        const client = await initMeeting({
          authToken,
          defaults: { audio: role === "host", video: role === "host" },
        });
        if (!client || cancelled) return;
        joined = client;
        await client.join();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not connect to the live room.");
      }
    })();

    return () => {
      cancelled = true;
      void joined?.leave().catch(() => undefined);
    };
  }, [authToken, role, initMeeting]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <RealtimeKitProvider value={meeting} fallback={fallback ?? <RoomConnecting />}>
      {children}
    </RealtimeKitProvider>
  );
}

function RoomConnecting() {
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-border bg-muted/40">
      <p className="text-sm text-muted-foreground">Connecting to the live room…</p>
    </div>
  );
}
