import { createFileRoute, Link, useLoaderData, useParams } from "@tanstack/react-router";

import { useBusinessPolicy, type Business } from "@/lib/business-site";

export const Route = createFileRoute("/businesses/$slug/policies/$policySlug")({
  component: BusinessPolicyPage,
});

function BusinessPolicyPage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  const { policySlug } = useParams({ from: "/businesses/$slug/policies/$policySlug" });
  const policy = useBusinessPolicy(business?.id ?? "", policySlug);

  if (!business) return null;

  return (
    <div className="container-page py-10 sm:py-14">
      <Link
        to="/businesses/$slug/policies"
        params={{ slug: business.slug }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All policies
      </Link>

      {policy.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading policy…</p>
      ) : policy.data ? (
        <article className="mt-6 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            {policy.data.policy_type}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{policy.data.title}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Last updated {new Date(policy.data.updated_at).toLocaleDateString()}
          </p>
          <div className="mt-8 whitespace-pre-line text-base leading-8 text-muted-foreground">
            {policy.data.content || "This policy has no content yet."}
          </div>
        </article>
      ) : (
        <div className="mt-6">
          <h1 className="text-2xl font-semibold tracking-tight">Policy not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This policy is not published, or the link is no longer valid.
          </p>
        </div>
      )}
    </div>
  );
}
