import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { ClientOnly } from "@/components/live/client-only";
import { Countdown } from "@/components/live/countdown";
import { GreenRoom } from "@/components/live/green-room";
import { HostBroadcast } from "@/components/live/host-broadcast";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import {
  beginLiveCountdown,
  endLiveStream,
  getHostMediaToken,
  getHostStudio,
  goLive,
} from "@/lib/conference/studio.functions";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/live_/$slug/studio")({
  head: ({ params }) => ({
    meta: [
      { title: `Host studio ${params.slug} — Accountabul` },
      {
        name: "description",
        content: "Private green room to check camera, microphone, and sound before going live.",
      },
    ],
  }),
  component: HostStudioPage,
});

function HostStudioPage() {
  const { slug } = Route.useParams();
  const { session, loading } = useSession();
  const queryClient = useQueryClient();

  const loadStudio = useServerFn(getHostStudio);
  const armCountdown = useServerFn(beginLiveCountdown);
  const commitGoLive = useServerFn(goLive);
  const endStream = useServerFn(endLiveStream);
  const rejoinAsHost = useServerFn(getHostMediaToken);

  const [greenRoomReady, setGreenRoomReady] = useState(false);
  const [countdownTo, setCountdownTo] = useState<string | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);

  const studio = useQuery({
    queryKey: ["host-studio", slug, session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: () => loadStudio({ data: slug }),
    retry: false,
  });

  const status = studio.data?.event.status;
  const isLive = status === "live";

  // Reopening the studio while the stream is running rejoins the same meeting.
  const rejoin = useQuery({
    queryKey: ["host-media-token", slug, session?.user.id],
    enabled: Boolean(session?.user.id) && isLive && !hostToken,
    queryFn: () => rejoinAsHost({ data: slug }),
    retry: false,
  });
  const activeToken = hostToken ?? rejoin.data?.authToken ?? null;

  const arm = useMutation({
    mutationFn: () => armCountdown({ data: slug }),
    onSuccess: (result) => {
      setHostToken(result.authToken);
      setCountdownTo(result.startsAt);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commit = useMutation({
    mutationFn: () => commitGoLive({ data: slug }),
    onSuccess: () => {
      setCountdownTo(null);
      toast.success("You are live.");
      void queryClient.invalidateQueries({ queryKey: ["host-studio", slug] });
    },
    onError: (error: Error) => {
      setCountdownTo(null);
      toast.error(error.message);
    },
  });

  const finish = useMutation({
    mutationFn: () => endStream({ data: slug }),
    onSuccess: () => {
      setHostToken(null);
      toast.success("Stream ended.");
      void queryClient.invalidateQueries({ queryKey: ["host-studio", slug] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const onCountdownComplete = useCallback(() => {
    commit.mutate();
  }, [commit]);

  if (loading) {
    return (
      <PageShell
        eyebrow="Host studio"
        title="Opening studio"
        description="Checking operator access."
      >
        <p className="text-sm text-muted-foreground">Loading…</p>
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell
        eyebrow="Host studio"
        title="Sign in to open studio"
        description="Green room checks stay on this Accountabul page. They never go to the public live room."
      >
        <Button asChild>
          <Link to="/login" search={{ redirect: `/live/${slug}/studio` }}>
            Sign in
          </Link>
        </Button>
      </PageShell>
    );
  }

  if (studio.isError) {
    return (
      <PageShell
        eyebrow="Host studio"
        title="Studio is not available"
        description="Only Accountabul operators can open the green room for an event."
      >
        <p className="text-sm text-muted-foreground">
          {studio.error instanceof Error ? studio.error.message : "Access denied."}
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/live/$slug" params={{ slug }}>
            Back to event
          </Link>
        </Button>
      </PageShell>
    );
  }

  const event = studio.data?.event;
  const counting = Boolean(countdownTo) && !isLive;

  return (
    <PageShell
      eyebrow={isLive ? "Host studio · on air" : "Host studio · not public"}
      title={event?.title ?? "Green room"}
      description={
        isLive
          ? "You are live. The audience sees this camera on the event page."
          : "Check camera, microphone, and speakers here. The audience cannot see this preview."
      }
      contentWidth="wide"
    >
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>Status: {status ?? "…"}</span>
        {event?.scheduled_start_at ? (
          <span>Scheduled {formatDateTime(event.scheduled_start_at)}</span>
        ) : (
          <span>Unscheduled / start when ready</span>
        )}
        {isLive ? (
          <span className="font-medium text-destructive">Live to the audience.</span>
        ) : (
          <span>Audience cannot see the host yet.</span>
        )}
      </div>

      {isLive ? (
        activeToken ? (
          <ClientOnly fallback={<p className="text-sm text-muted-foreground">Rejoining…</p>}>
            <HostBroadcast
              authToken={activeToken}
              slug={slug}
              ending={finish.isPending}
              onEndStream={() => finish.mutate()}
            />
          </ClientOnly>
        ) : rejoin.isError ? (
          <p className="text-sm text-destructive">
            {rejoin.error instanceof Error ? rejoin.error.message : "Could not rejoin the room."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Connecting to the live room…</p>
        )
      ) : counting && countdownTo ? (
        <div className="space-y-4">
          <Countdown startsAt={countdownTo} onComplete={onCountdownComplete} tone="host" />
          {commit.isPending ? (
            <p className="text-center text-sm text-muted-foreground">Going live…</p>
          ) : null}
        </div>
      ) : (
        <>
          <GreenRoom onReadyChange={setGreenRoomReady} />
          <div className="mt-8 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!greenRoomReady || arm.isPending || status !== "scheduled"}
              onClick={() => arm.mutate()}
            >
              {arm.isPending ? "Starting countdown…" : "Go live"}
            </Button>
            <Button asChild variant="outline">
              <Link to="/live/$slug" params={{ slug }}>
                View audience page
              </Link>
            </Button>
          </div>
          {!greenRoomReady ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Pass the camera, microphone, and sound checks before the countdown unlocks.
            </p>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
