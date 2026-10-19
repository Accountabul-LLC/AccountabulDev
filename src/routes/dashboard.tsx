import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Building2, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMyBusiness } from "@/hooks/use-business";
import { isBusinessApproved } from "@/lib/business-review";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

const links = [
  { to: "/dashboard", label: "Overview", exact: true },
  { to: "/dashboard/business", label: "Business page" },
  { to: "/dashboard/services", label: "Services" },
  { to: "/dashboard/properties", label: "Properties" },
  { to: "/dashboard/policies", label: "Policies" },
  { to: "/dashboard/leads", label: "Leads" },
  { to: "/dashboard/billing", label: "Billing" },
] as const;

function DashboardLayout() {
  const membership = useMyBusiness();
  const business = membership.data?.businesses;
  const publicSlug = business?.slug;
  const isPublic = business ? isBusinessApproved(business) : false;

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accountabul-deep)] text-white">
            <Building2 aria-hidden size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Business workspace
            </p>
            <p className="truncate font-display text-lg font-semibold">
              {business?.display_name ?? "Accountabul business"}
            </p>
          </div>
        </div>
        {business ? (
          isPublic && publicSlug ? (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link
                to="/businesses/$slug"
                params={{ slug: publicSlug }}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink aria-hidden size={14} />
                View Public Business Page
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className="gap-2">
              <ExternalLink aria-hidden size={14} />
              Public page not available
            </Button>
          )
        ) : null}
      </div>
      <nav aria-label="Business workspace" className="mb-6 flex gap-1 overflow-x-auto pb-2">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            activeOptions={{ exact: "exact" in link }}
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            activeProps={{ className: "bg-secondary text-foreground font-medium" }}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
