import { Link } from "@tanstack/react-router";
import { Wrench } from "lucide-react";

import { formatMoney } from "@/lib/format";
import { BUSINESS_MEDIA_BUCKET, useMediaUrls } from "@/lib/media";

type ServiceCardData = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  category: string | null;
  price_minor: number | string | null;
  currency: string;
  price_note: string | null;
  image_path: string | null;
};

export function ServiceGrid({
  businessSlug,
  services,
}: {
  businessSlug: string;
  services: ServiceCardData[];
}) {
  const images = useMediaUrls(
    BUSINESS_MEDIA_BUCKET,
    services.map((service) => service.image_path),
  );

  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {services.map((service) => {
        const image = service.image_path ? images[service.image_path] : null;
        return (
          <li
            key={service.id}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow hover:shadow-md"
          >
            <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
              {image ? (
                <img
                  src={image}
                  alt={service.name}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center text-muted-foreground">
                  <Wrench aria-hidden size={24} />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-5">
              {service.category ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {service.category}
                </p>
              ) : null}
              <h3 className="mt-1 text-base font-semibold leading-6">{service.name}</h3>
              {service.summary ? (
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                  {service.summary}
                </p>
              ) : null}
              <p className="mt-3 text-sm font-medium">
                {service.price_minor != null
                  ? `Starting at ${formatMoney(Number(service.price_minor), service.currency)}`
                  : (service.price_note ?? "Contact for pricing")}
              </p>
              <Link
                to="/businesses/$slug/services/$serviceSlug"
                params={{ slug: businessSlug, serviceSlug: service.slug }}
                className="mt-4 inline-flex text-sm font-medium text-accent hover:underline"
              >
                View details →
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
