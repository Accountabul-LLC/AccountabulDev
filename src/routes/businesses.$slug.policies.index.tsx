import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { useBusinessPolicies, type Business } from "@/lib/business-site";

export const Route = createFileRoute("/businesses/$slug/policies/")({
  component: BusinessPoliciesPage,
});

function BusinessPoliciesPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  const policies = useBusinessPolicies(business?.id ?? "");
  if (!business) return null;

  return (
    <div className="container-page py-10 sm:py-14">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Policies
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          {business.display_name} policies
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          Published policies and agreements for working with this business.
        </p>
      </header>

      <div className="mt-8 max-w-3xl">
        {policies.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading policies…</p>
        ) : policies.data?.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {policies.data.map((policy) => (
              <li key={policy.id}>
                <Link
                  to="/businesses/$slug/policies/$policySlug"
                  params={{ slug: business.slug, policySlug: policy.slug }}
                  className="flex items-center gap-3 px-6 py-4 hover:bg-secondary/50"
                >
                  <FileText aria-hidden size={17} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{policy.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {policy.policy_type} · Updated{" "}
                      {new Date(policy.updated_at).toLocaleDateString()}
                    </span>
                  </span>
                  <span aria-hidden className="text-sm text-muted-foreground">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="font-medium">No policies published</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This business has not published any policies yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
