import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, locationLabel } from "@/lib/format";
import { PROPERTY_MEDIA_BUCKET, useMediaUrls } from "@/lib/media";

export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Marketplace — Accountabul" },
      {
        name: "description",
        content: "Search and filter accountable real-estate listings on Accountabul.",
      },
      { property: "og:title", content: "Marketplace — Accountabul" },
      {
        property: "og:description",
        content: "Search and filter accountable real-estate listings on Accountabul.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplacePage,
});

function MarketplacePage() {
  const [term, setTerm] = useState("");
  const [city, setCity] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const listings = useQuery({
    queryKey: ["marketplace", term, city, maxPrice],
    queryFn: async () => {
      let query = supabase
        .from("properties")
        .select(
          "id, slug, title, description, property_type, address_city, address_state, price_minor, currency, cover_path, bedrooms, bathrooms, area_sqft, businesses!inner(display_name, slug)",
        )
        .eq("status", "published")
        .eq("businesses.profile_status", "published")
        .eq("businesses.verification_status", "verified")
        .eq("businesses.public_profile_enabled", true)
        .order("published_at", { ascending: false })
        .limit(48);

      if (term.trim()) {
        const like = `%${term.trim()}%`;
        query = query.or(
          `title.ilike.${like},description.ilike.${like},property_type.ilike.${like}`,
        );
      }
      if (city.trim()) query = query.ilike("address_city", `%${city.trim()}%`);
      const max = Number(maxPrice.replace(/[^0-9]/g, ""));
      if (max > 0) query = query.lte("price_minor", max * 100);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const covers = useMediaUrls(
    PROPERTY_MEDIA_BUCKET,
    (listings.data ?? []).map((property) => property.cover_path),
  );

  return (
    <PageShell
      eyebrow="Marketplace"
      title="Real-estate marketplace"
      description="Published listings from accountable businesses. Drafts and suspended listings never appear here."
      phase="Phase 2"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          placeholder="Keyword or type"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search listings"
        />
        <Input
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label="Filter by city"
        />
        <Input
          placeholder="Max price (USD)"
          inputMode="numeric"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          aria-label="Maximum price"
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading listings…</p>
        ) : null}
        {listings.isError ? (
          <p className="text-sm text-destructive">
            Listings could not be loaded. Try again shortly.
          </p>
        ) : null}
        {listings.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No published listings match those filters yet.
          </p>
        ) : null}
        {listings.data?.map((p) => (
          <Link
            key={p.id}
            to="/properties/$slug"
            params={{ slug: p.slug }}
            className="surface-card group overflow-hidden transition-colors hover:border-accent"
          >
            <div className="aspect-[4/3] w-full bg-secondary">
              {p.cover_path && covers[p.cover_path] ? (
                <img
                  src={covers[p.cover_path]!}
                  alt={p.title}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  No photo provided
                </div>
              )}
            </div>
            <div className="p-5">
              <p className="text-xs uppercase tracking-wide text-accent">
                {p.property_type ?? "Property"}
              </p>
              <h2 className="mt-1 font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {locationLabel([p.address_city, p.address_state]) || "Location on request"}
              </p>
              <p className="mt-3 font-semibold">{formatMoney(p.price_minor, p.currency)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Listed by {p.businesses?.display_name ?? "an Accountabul business"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
