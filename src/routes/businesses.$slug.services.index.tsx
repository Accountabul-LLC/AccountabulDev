import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { ServiceGrid } from "@/components/business/service-grid";
import { Button } from "@/components/ui/button";
import { useBusinessServices, type Business } from "@/lib/business-site";

export const Route = createFileRoute("/businesses/$slug/services/")({
  component: BusinessServicesPage,
});

function BusinessServicesPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  const services = useBusinessServices(business?.id ?? "");
  if (!business) return null;

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Services
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Services from {business.display_name}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          The complete service catalog published by this business.
        </p>
      </header>

      <div className="mt-8">
        {services.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading services…</p>
        ) : services.isError ? (
          <div>
            <p className="font-medium">Services could not be loaded</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => services.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : services.data?.length ? (
          <ServiceGrid businessSlug={business.slug} services={services.data} />
        ) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="font-medium">No services listed yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This business has not published its offerings yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
