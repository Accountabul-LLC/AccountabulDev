import { createFileRoute, Link, useLoaderData, useParams } from "@tanstack/react-router";
import { Wrench } from "lucide-react";

import { ServiceInquiryForm } from "@/components/business/service-inquiry-form";
import { useBusinessService, type Business } from "@/lib/business-site";
import { formatMoney } from "@/lib/format";
import { BUSINESS_MEDIA_BUCKET, useMediaUrl } from "@/lib/media";

export const Route = createFileRoute("/businesses/$slug/services/$serviceSlug")({
  component: BusinessServiceDetailPage,
});

function BusinessServiceDetailPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  const { serviceSlug } = useParams({ from: "/businesses/$slug/services/$serviceSlug" });
  const service = useBusinessService(business?.id ?? "", serviceSlug);
  const image = useMediaUrl(BUSINESS_MEDIA_BUCKET, service.data?.image_path ?? null);

  if (!business) return null;

  if (service.isLoading) {
    return (
      <div className="container-page py-14">
        <p className="text-sm text-muted-foreground">Loading service…</p>
      </div>
    );
  }

  if (!service.data) {
    return (
      <div className="container-page py-14">
        <h1 className="text-2xl font-semibold tracking-tight">Service not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This service is not published, or the link is no longer valid.
        </p>
        <Link
          to="/businesses/$slug/services"
          params={{ slug: business.slug }}
          className="mt-4 inline-flex text-sm font-medium text-accent hover:underline"
        >
          Back to all services
        </Link>
      </div>
    );
  }

  const data = service.data;

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        to="/businesses/$slug/services"
        params={{ slug: business.slug }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All services
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <div className="aspect-[16/9] w-full overflow-hidden rounded-lg border border-border bg-muted">
            {image ? (
              <img src={image} alt={data.name} className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <Wrench aria-hidden size={32} />
              </div>
            )}
          </div>

          {data.category ? (
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {data.category}
            </p>
          ) : null}
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{data.name}</h1>
          <p className="mt-3 text-lg font-medium">
            {data.price_minor != null
              ? `Starting at ${formatMoney(Number(data.price_minor), data.currency)}`
              : (data.price_note ?? "Contact for pricing")}
          </p>

          {data.summary ? (
            <p className="mt-6 text-base leading-7 text-muted-foreground">{data.summary}</p>
          ) : null}
          {data.description ? (
            <p className="mt-4 whitespace-pre-line text-base leading-8 text-muted-foreground">
              {data.description}
            </p>
          ) : null}

          {data.service_areas?.length ? (
            <div className="mt-8">
              <h2 className="text-sm font-semibold">Service areas</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.service_areas.map((area: string) => (
                  <span
                    key={area}
                    className="rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs"
                  >
                    {area}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold tracking-tight">Request this service</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send your details to {business.display_name}.
          </p>
          <div className="mt-5">
            <ServiceInquiryForm businessId={business.id} serviceId={data.id} />
          </div>
        </aside>
      </div>
    </div>
  );
}
