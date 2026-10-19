import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/live/")({
  head: () => ({
    meta: [
      { title: "Live events — Accountabul" },
      {
        name: "description",
        content:
          "Join the current Accountabul live conference room, see scheduled events, and watch replays.",
      },
      { property: "og:title", content: "Live events — Accountabul" },
      {
        property: "og:description",
        content:
          "Join the current Accountabul live conference room, see scheduled events, and watch replays.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const events = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, slug, title, description, status, scheduled_start_at, ended_at, cover_path")
        .neq("status", "canceled")
        .order("scheduled_start_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const all = events.data ?? [];
  const liveNow = all.filter((e) => e.status === "live");
  const scheduled = all.filter((e) => e.status === "scheduled");
  const replays = all.filter((e) => e.status === "replay_available" || e.status === "ended");

  return (
    <PageShell
      eyebrow="Conference room"
      title="Live"
      description="The current live room, scheduled events, and replays when recordings are available."
      phase="Phase 3"
    >
      <section className="mb-10 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Badge>Members only</Badge>
            <h2 className="mt-3 text-2xl sm:text-3xl">Members watch live, from $16/month</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The schedule is public so you always know what is coming. Watching a room, joining the
              chat, and opening replays require an active Accountabul membership — or a one-off pass
              on rooms that offer one.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link to="/pricing">See membership plans</Link>
          </Button>
        </div>
      </section>

      {events.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the schedule…</p>
      ) : null}
      {!events.isLoading && all.length === 0 ? (
        <div className="surface-card p-6">
          <h2 className="font-semibold">No events scheduled yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            When a room is scheduled it appears here with a reminder option, and switches to the
            live player automatically.
          </p>
        </div>
      ) : null}

      <Section title="Live now" empty="No room is live right now." events={liveNow} />
      <Section title="Scheduled" empty="Nothing on the calendar yet." events={scheduled} />
      <Section title="Replays" empty="No replays published yet." events={replays} />
    </PageShell>
  );
}

type EventRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_start_at: string | null;
  cover_path: string | null;
};

function Section({ title, empty, events }: { title: string; empty: string; events: EventRow[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link
              key={e.id}
              to="/live/$slug"
              params={{ slug: e.slug }}
              className="surface-card p-5 transition-colors hover:border-accent"
            >
              <span className="text-xs uppercase tracking-wide text-accent">
                {e.status.replace("_", " ")}
              </span>
              <h3 className="mt-1 font-semibold">{e.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(e.scheduled_start_at)}
              </p>
              {e.description ? (
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{e.description}</p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
