import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, MapPin, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_MEDIA_BUCKET, useMediaUrls } from "@/lib/media";

const searchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
});

export const Route = createFileRoute("/businesses/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Find local businesses — Accountabul" },
      {
        name: "description",
        content:
          "Search verified local businesses and service providers by name, category, or city on Accountabul.",
      },
      { property: "og:title", content: "Find local businesses — Accountabul" },
      {
        property: "og:description",
        content:
          "Search verified local businesses and service providers by name, category, or city on Accountabul.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessesPage,
});

function BusinessesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [term, setTerm] = useState(search.q ?? "");
  const [city, setCity] = useState(search.city ?? "");

  useEffect(() => {
    setTerm(search.q ?? "");
    setCity(search.city ?? "");
  }, [search.q, search.city]);

  function apply(next: Partial<z.infer<typeof searchSchema>>) {
    void navigate({
      to: "/businesses",
      search: (prev) => {
        const merged = { ...prev, ...next };
        return {
          q: merged.q?.trim() || undefined,
          city: merged.city?.trim() || undefined,
          category: merged.category || undefined,
        };
      },
    });
  }

  const listings = useQuery({
    queryKey: ["directory", search.q, search.city, search.category],
    queryFn: async () => {
      let query = supabase
        .from("businesses")
        .select(
          "id, slug, display_name, logo_path, headline, primary_industry, address_city, address_state, verification_status",
        )
        .eq("profile_status", "published")
        .eq("verification_status", "verified")
        .eq("public_profile_enabled", true)
        .order("published_at", { ascending: false })
        .limit(60);

      if (search.q?.trim()) {
        const like = `%${search.q.trim()}%`;
        query = query.or(
          `display_name.ilike.${like},headline.ilike.${like},primary_industry.ilike.${like}`,
        );
      }
      if (search.city?.trim()) query = query.ilike("address_city", `%${search.city.trim()}%`);
      if (search.category) query = query.eq("primary_industry", search.category);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const categories = useQuery({
    queryKey: ["directory-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("primary_industry")
        .eq("profile_status", "published")
        .eq("verification_status", "verified")
        .eq("public_profile_enabled", true)
        .not("primary_industry", "is", null)
        .limit(500);
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((row) => row.primary_industry!))).sort();
    },
  });

  const logos = useMediaUrls(
    BUSINESS_MEDIA_BUCKET,
    (listings.data ?? []).map((b) => b.logo_path),
  );

  return (
    <main className="pb-20">
      <section className="border-b border-border bg-muted/40">
        <div className="container-page py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Directory</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Find verified local businesses and service providers
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Every profile here is a published, verified business in the Accountabul network.
          </p>

          <form
            className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              apply({ q: term, city });
            }}
          >
            <div className="relative">
              <Search
                aria-hidden
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                placeholder="Search businesses, services, or categories…"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                aria-label="Search businesses"
              />
            </div>
            <Input
              placeholder="City or ZIP"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              aria-label="City or ZIP code"
            />
            <Button type="submit">Search</Button>
          </form>

          {categories.data?.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <CategoryChip
                label="All categories"
                active={!search.category}
                onClick={() => apply({ category: undefined })}
              />
              {categories.data.map((category) => (
                <CategoryChip
                  key={category}
                  label={category}
                  active={search.category === category}
                  onClick={() =>
                    apply({ category: search.category === category ? undefined : category })
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="container-page py-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">
            {listings.data ? `${listings.data.length} businesses` : "Businesses"}
          </h2>
          {search.q || search.city || search.category ? (
            <button
              type="button"
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              onClick={() => apply({ q: undefined, city: undefined, category: undefined })}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.isLoading ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Loading…
            </p>
          ) : null}
          {listings.error ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-destructive">
              The directory could not be loaded.
            </p>
          ) : null}
          {(listings.data ?? []).map((b) => (
            <Link
              key={b.id}
              to="/businesses/$slug"
              params={{ slug: b.slug }}
              className="group flex flex-col rounded-lg border border-border bg-card p-6 transition-colors hover:border-accent/50 hover:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground">
                  {b.logo_path && logos[b.logo_path] ? (
                    <img
                      src={logos[b.logo_path]!}
                      alt={`${b.display_name} logo`}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    b.display_name.charAt(0)
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold group-hover:text-accent">
                    {b.display_name}
                  </h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.primary_industry ?? "Local business"}
                  </p>
                </div>
              </div>

              {b.headline ? (
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {b.headline}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                {b.address_city || b.address_state ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin aria-hidden size={13} />
                    {[b.address_city, b.address_state].filter(Boolean).join(", ")}
                  </span>
                ) : null}
                {b.verification_status === "verified" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-2 py-0.5 font-medium text-accent">
                    <BadgeCheck aria-hidden size={13} /> Verified Business
                  </span>
                ) : null}
              </div>

              <span className="mt-5 text-sm font-medium text-accent">View business →</span>
            </Link>
          ))}
          {listings.data && listings.data.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              No published businesses match that search yet.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-card text-muted-foreground hover:border-accent/50 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
