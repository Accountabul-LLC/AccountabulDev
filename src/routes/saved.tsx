import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PageShell } from "@/components/page-shell";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, locationLabel } from "@/lib/format";

export const Route = createFileRoute("/saved")({
  head: () => ({
    meta: [
      { title: "Saved listings — Accountabul" },
      { name: "description", content: "Your saved Accountabul listings, private to your account." },
      { property: "og:title", content: "Saved listings — Accountabul" },
      {
        property: "og:description",
        content: "Your saved Accountabul listings, private to your account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SavedPage,
});

function SavedPage() {
  const { session, loading } = useSession();
  const userId = session?.user.id;

  const saved = useQuery({
    queryKey: ["saved-list", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_properties")
        .select(
          "id, created_at, properties(id, slug, title, address_city, address_state, price_minor, currency, cover_path, status)",
        )
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <PageShell
      eyebrow="Your account"
      title="Saved listings"
      description="Listings you saved. Only you can see this list."
      phase="Phase 2"
    >
      {loading ? <p className="text-sm text-muted-foreground">Checking your session…</p> : null}
      {!loading && !userId ? (
        <p className="text-sm text-muted-foreground">
          <Link to="/login" search={{}} className="text-accent underline">
            Sign in
          </Link>{" "}
          to see the listings you saved.
        </p>
      ) : null}

      {userId ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {saved.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {saved.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing saved yet. Browse the{" "}
              <Link to="/marketplace" className="text-accent underline">
                marketplace
              </Link>
              .
            </p>
          ) : null}
          {saved.data?.map((row) =>
            row.properties ? (
              <Link
                key={row.id}
                to="/properties/$slug"
                params={{ slug: row.properties.slug }}
                className="surface-card overflow-hidden transition-colors hover:border-accent"
              >
                <div className="aspect-[4/3] w-full bg-secondary">
                  {row.properties.cover_path ? (
                    <img
                      src={row.properties.cover_path}
                      alt={row.properties.title}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                      No photo
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h2 className="font-semibold">{row.properties.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {locationLabel([row.properties.address_city, row.properties.address_state]) ||
                      "Location on request"}
                  </p>
                  <p className="mt-2 font-semibold">
                    {formatMoney(row.properties.price_minor, row.properties.currency)}
                  </p>
                  {row.properties.status !== "published" ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      This listing is no longer published.
                    </p>
                  ) : null}
                </div>
              </Link>
            ) : null,
          )}
        </div>
      ) : null}
    </PageShell>
  );
}
