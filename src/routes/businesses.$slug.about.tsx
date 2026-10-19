import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Building2, CalendarDays, MapPin, Users } from "lucide-react";

import { businessLocation, type Business } from "@/lib/business-site";

export const Route = createFileRoute("/businesses/$slug/about")({
  component: BusinessAboutPage,
});

function BusinessAboutPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  if (!business) return null;
  const location = businessLocation(business);

  const facts = [
    { icon: Building2, label: "Industry", value: business.primary_industry },
    { icon: CalendarDays, label: "Founded", value: business.year_founded?.toString() ?? null },
    { icon: Users, label: "Team size", value: business.employee_count_range },
    { icon: MapPin, label: "Headquarters", value: location || null },
  ].filter((fact) => fact.value);

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">About</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          About {business.display_name}
        </h1>
        {business.headline ? (
          <p className="mt-3 text-base leading-7 text-muted-foreground">{business.headline}</p>
        ) : null}
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <p className="whitespace-pre-line text-base leading-8 text-muted-foreground">
            {business.description ??
              "This business has not published a detailed company description yet."}
          </p>

          {business.service_areas?.length ? (
            <div className="mt-10">
              <h2 className="text-lg font-semibold tracking-tight">Service areas</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {business.service_areas.map((area: string) => (
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

        {facts.length ? (
          <aside className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-lg font-semibold tracking-tight">Business details</h2>
            <dl className="mt-5 space-y-4">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-start gap-3">
                  <Icon aria-hidden size={17} className="mt-0.5 shrink-0 text-accent" />
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-1 text-sm font-medium">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
