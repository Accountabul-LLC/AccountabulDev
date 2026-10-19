import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

/**
 * The in-app half of a hop-on alert: a persistent banner while any room is
 * live. It links to the Accountabul event page, never to an external guest URL.
 */
export function LiveNowBanner() {
  const location = useLocation();

  const live = useQuery({
    queryKey: ["live-now"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("slug, title")
        .eq("status", "live")
        .order("actual_start_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const event = live.data;
  if (!event) return null;
  // Do not shout about the room the person is already standing in.
  if (location.pathname.startsWith(`/live/${event.slug}`)) return null;

  return (
    <div className="border-b border-border bg-accent/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <span
            className="inline-block size-2 animate-pulse rounded-full bg-destructive"
            aria-hidden="true"
          />
          <span className="font-medium">We are live:</span>
          <span className="text-muted-foreground">{event.title}</span>
        </p>
        <Link
          to="/live/$slug"
          params={{ slug: event.slug }}
          className="text-sm font-medium text-accent underline"
        >
          Hop on
        </Link>
      </div>
    </div>
  );
}
