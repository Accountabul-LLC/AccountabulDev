import { Link } from "@tanstack/react-router";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type NavItem = { label: string; to: string; exact?: boolean };

/**
 * Business-specific navigation layer. Renders directly under the global
 * Accountabul header on business slug routes only. Every link is scoped to
 * the business currently being viewed.
 */
export function BusinessHeader({
  slug,
  name,
  logoUrl,
  handle,
  verified,
  showProperties,
  showPolicies,
}: {
  slug: string;
  name: string;
  logoUrl?: string | null;
  handle?: string | null;
  verified?: boolean;
  showProperties?: boolean;
  showPolicies?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { label: "Home", to: "/businesses/$slug", exact: true },
    { label: "About", to: "/businesses/$slug/about" },
    { label: "Services", to: "/businesses/$slug/services" },
    ...(showProperties ? [{ label: "Properties", to: "/businesses/$slug/properties" }] : []),
    ...(showPolicies ? [{ label: "Policies", to: "/businesses/$slug/policies" }] : []),
  ];

  const linkClass =
    "whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground";
  const activeClass = { className: "text-foreground font-medium" };

  return (
    <div className="sticky top-[82px] z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="container-page grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 lg:flex lg:justify-between">
        <Link to="/businesses/$slug" params={{ slug }} className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-sm font-bold">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="size-full object-cover" />
            ) : (
              name.charAt(0)
            )}
          </div>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold tracking-tight">
              <span className="truncate">{name}</span>
              {verified ? (
                <BadgeCheck aria-hidden size={15} className="shrink-0 text-accent" />
              ) : null}
            </p>
            {handle ? <p className="truncate text-xs text-muted-foreground">@{handle}</p> : null}
          </div>
        </Link>

        <nav aria-label={`${name} pages`} className="hidden items-center gap-6 lg:flex">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              params={{ slug }}
              activeOptions={{ exact: Boolean(item.exact) }}
              activeProps={activeClass}
              className={linkClass}
            >
              {item.label}
            </Link>
          ))}
          <Link to="/businesses/$slug" params={{ slug }} hash="contact" className={linkClass}>
            Contact
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Menu
            <ChevronDown aria-hidden size={15} className={open ? "rotate-180" : undefined} />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border lg:hidden">
          <nav aria-label={`${name} pages`} className="container-page grid gap-1 py-3">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ slug }}
                onClick={() => setOpen(false)}
                activeOptions={{ exact: Boolean(item.exact) }}
                activeProps={{ className: "bg-secondary text-foreground font-medium" }}
                className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/businesses/$slug"
              params={{ slug }}
              hash="contact"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              Contact
            </Link>
            <Link
              to="/businesses"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Back to directory
            </Link>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
