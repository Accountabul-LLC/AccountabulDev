import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import { useBusinessProperties, type Business } from "@/lib/business-site";
import { formatMoney } from "@/lib/format";
import { PROPERTY_MEDIA_BUCKET, useMediaUrls } from "@/lib/media";

export const Route = createFileRoute("/businesses/$slug/properties")({
  component: BusinessPropertiesPage,
});

function BusinessPropertiesPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  const listings = useBusinessProperties(business?.id ?? "");
  const covers = useMediaUrls(
    PROPERTY_MEDIA_BUCKET,
    (listings.data ?? []).map((property) => property.cover_path),
  );

  if (!business) return null;

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Properties
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Properties from {business.display_name}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Published listings represented by this business.
        </p>
      </header>

      <div className="mt-8">
        {listings.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading properties…</p>
        ) : listings.data?.length ? (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.data.map((property) => (
              <li
                key={property.id}
                className="overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
              >
                <div className="aspect-[16/10] bg-muted">
                  {property.cover_path && covers[property.cover_path] ? (
                    <img
                      src={covers[property.cover_path]!}
                      alt={property.title}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-5">
                  <Link
                    to="/properties/$slug"
                    params={{ slug: property.slug }}
                    className="text-base font-semibold underline-offset-4 hover:underline"
                  >
                    {property.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[property.address_city, property.address_state].filter(Boolean).join(", ") ||
                      "Location on request"}
                  </p>
                  <p className="mt-3 text-sm font-semibold">
                    {property.price_minor != null
                      ? formatMoney(Number(property.price_minor), property.currency)
                      : "Price on request"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="font-medium">No properties published</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This business has not listed any properties yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
