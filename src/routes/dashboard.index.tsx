import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CircleDashed,
  Eye,
  House,
  Inbox,
  Settings2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyBusinessProfile } from "@/lib/business/my-business";
import { isBusinessApproved } from "@/lib/business-review";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [
      { title: "Business workspace — Accountabul" },
      {
        name: "description",
        content: "Operate your Accountabul business, public page, services, listings, and leads.",
      },
    ],
  }),
  component: DashboardHome,
});

function DashboardHome() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const business = useQuery({
    queryKey: ["business-workspace", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data: memberships, error: membershipError } =
        await supabase.rpc("get_my_memberships");
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) return null;
      const data = await fetchMyBusinessProfile(supabase, membership.business_id);
      if (!data) return null;
      return { ...data, membership_role: membership.membership_role };
    },
  });
  const businessId = business.data?.id;
  const metrics = useQuery({
    queryKey: ["business-workspace-metrics", businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_business_workspace_metrics", {
        p_business_id: businessId!,
      });
      if (error) throw error;
      const counts = data?.[0];
      return {
        services: Number(counts?.service_count ?? 0),
        properties: Number(counts?.property_count ?? 0),
        leads: Number(counts?.lead_count ?? 0),
      };
    },
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading your workspace…</p>;
  if (!session) return <SignedOut />;
  if (business.isLoading)
    return <p className="text-sm text-muted-foreground">Loading your business…</p>;

  if (!business.data) {
    return (
      <section className="surface-card max-w-2xl p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Business workspace
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Build your business presence</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Create one business record that powers your workspace, services, listings, leads, and
          public Accountabul site.
        </p>
        <Button asChild className="mt-6">
          <Link to="/onboarding/business">Start business onboarding</Link>
        </Button>
      </section>
    );
  }

  const current = business.data;
  const profileFields = [
    current.display_name,
    current.headline,
    current.description,
    current.primary_industry,
    current.address_city,
    current.public_email || current.public_phone,
    current.logo_path,
    current.cover_path,
  ];
  const completedFields = profileFields.filter(Boolean).length;
  const completion = Math.round((completedFields / profileFields.length) * 100);
  const isPublished = isBusinessApproved(current);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-[var(--accountabul-deep)] p-6 text-white sm:p-8">
        <div className="absolute right-0 top-0 size-64 translate-x-1/3 -translate-y-1/3 rounded-full bg-[var(--accountabul-teal)]/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accountabul-mint)]">
                {current.membership_role} workspace
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs">
                {isPublished ? (
                  <BadgeCheck aria-hidden size={14} />
                ) : (
                  <CircleDashed aria-hidden size={14} />
                )}
                {isPublished ? "Public" : current.profile_status.replaceAll("_", " ")}
              </span>
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold">{current.display_name}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
              {current.headline ??
                "Complete your business page, publish services, and manage every Accountabul lead from one place."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-white text-[var(--accountabul-deep)] hover:bg-white/90">
              <Link to="/dashboard/business">
                <Settings2 aria-hidden size={16} /> Edit business page
              </Link>
            </Button>
            {isPublished ? (
              <Button
                asChild
                variant="outline"
                className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Link to="/businesses/$slug" params={{ slug: current.slug }}>
                  <Eye aria-hidden size={16} /> View public page
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Page readiness"
          value={`${completion}%`}
          detail={`${completedFields} of ${profileFields.length} essentials complete`}
          to="/dashboard/business"
        />
        <MetricCard
          icon={BriefcaseBusiness}
          label="Services"
          value={String(metrics.data?.services ?? 0)}
          detail="Offerings managed"
          to="/dashboard/services"
        />
        <MetricCard
          icon={House}
          label="Properties"
          value={String(metrics.data?.properties ?? 0)}
          detail="Listings managed"
          to="/dashboard/properties"
        />
        <MetricCard
          icon={Inbox}
          label="Leads"
          value={String(metrics.data?.leads ?? 0)}
          detail="Property and service inquiries"
          to="/dashboard/leads"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="surface-card p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Next best actions
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold">Keep your business moving</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <ActionCard
              complete={completedFields === profileFields.length}
              title="Complete the public page"
              description="Add brand images, contact details, company facts, and service areas."
              to="/dashboard/business"
            />
            <ActionCard
              complete={(metrics.data?.services ?? 0) > 0}
              title={
                (metrics.data?.services ?? 0) > 0
                  ? "Keep services current"
                  : "Publish your first service"
              }
              description={
                (metrics.data?.services ?? 0) > 0
                  ? "Review pricing, images, availability, and service areas as your offerings change."
                  : "Add an image, description, price guidance, and service areas."
              }
              to="/dashboard/services"
            />
            <ActionCard
              complete={current.profile_status === "pending_review" || isPublished}
              title={isPublished ? "Business is approved" : "Submit for Accountabul review"}
              description={
                isPublished
                  ? "Your verified business page is public and ready to share."
                  : "Publication is granted by the private Accountabul operations team."
              }
              to="/dashboard/business"
            />
            <ActionCard
              complete={(metrics.data?.leads ?? 0) === 0}
              title={
                (metrics.data?.leads ?? 0) > 0 ? "Respond to new leads" : "Lead inbox is clear"
              }
              description={
                (metrics.data?.leads ?? 0) > 0
                  ? "Keep property and service requests together in your lead inbox."
                  : "New property and service requests will appear here."
              }
              to="/dashboard/leads"
            />
          </div>
        </section>

        <section className="surface-card p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Public link
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold">Your hosted business site</h2>
          <p className="mt-3 break-all rounded-lg border border-border bg-secondary/30 p-3 text-sm font-medium">
            /businesses/{current.slug}
          </p>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            This stable Accountabul address is the page you can share with customers after approval.
            Custom domains and paid hosting can attach to this same business record later.
          </p>
          <Button asChild variant="outline" className="mt-5 w-full gap-2">
            <Link to="/dashboard/business">
              Manage public identity <ArrowUpRight aria-hidden size={16} />
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  to,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  detail: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="surface-card group block p-5 transition hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-accent">
          <Icon aria-hidden size={18} />
        </span>
        <ArrowUpRight
          aria-hidden
          size={16}
          className="text-muted-foreground transition group-hover:text-accent"
        />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </Link>
  );
}

function ActionCard({
  complete,
  title,
  description,
  to,
}: {
  complete: boolean;
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-border p-4 transition-colors hover:border-accent"
    >
      <div className="flex items-start gap-3">
        {complete ? (
          <CheckCircle2
            aria-hidden
            size={19}
            className="mt-0.5 shrink-0 text-[var(--accountabul-success)]"
          />
        ) : (
          <CircleDashed aria-hidden size={19} className="mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
  );
}
