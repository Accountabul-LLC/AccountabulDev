import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { getPropertyIntelligenceAccess } from "@/lib/property-intelligence/property-intelligence.functions";
import PropertyExplorer from "@/components/property-intelligence/property-explorer";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/property-intelligence")({
  head: () => ({
    meta: [
      { title: "Property Intelligence — Accountabul" },
      {
        name: "description",
        content:
          "Search official St. Louis property records and analyze a deal before you make an offer.",
      },
    ],
  }),
  component: PropertyIntelligencePage,
});

// This page's UI shell is PropertyExplorer, ported from
// Accountabul-LLC/property-insight-hub's flagship src/components/property-explorer.tsx (see
// src/components/property-intelligence/property-explorer.tsx for what changed in the port).
// This route keeps ownership of session/access gating exactly as the previous bespoke
// implementation did (ACC-20260923-004's members-only switch, access.ts / access.server.ts) —
// PropertyExplorer itself has no opinion on who may reach it.
function PropertyIntelligencePage() {
  const { session, loading } = useSession();
  const getAccess = useServerFn(getPropertyIntelligenceAccess);
  const access = useQuery({
    queryKey: ["property-intelligence-access"],
    queryFn: () => getAccess(),
    enabled: Boolean(session),
    staleTime: 60_000,
  });

  if (loading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (!session) {
    return (
      <div className="px-4 py-16">
        <SignedOut />
      </div>
    );
  }
  if (access.isLoading) {
    return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  }
  if (access.data && !access.data.allowed) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Property Intelligence
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Members only, for now</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Property Intelligence is currently available to active Accountabul members. If you believe
          you should have access, reach out and we can grant it directly.
        </p>
        <Button className="mt-5" asChild>
          <a href="/dashboard/billing">See membership options</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Property Intelligence
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold">
        Know the property before the offer
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Official St. Louis City inventory and tax-sale records, with a deal analyst that keeps every
        assumption visible. Nothing here is appraisal, title or lending advice.
      </p>

      <div className="mt-6">
        <PropertyExplorer />
      </div>
    </div>
  );
}
