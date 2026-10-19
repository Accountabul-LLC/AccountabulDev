import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { createMembershipCheckout, getCheckoutReadiness } from "@/lib/billing/billing.functions";
import { formatMoney } from "@/lib/format";
import {
  tierPriceMinor,
  useMembershipTiers,
  type BillingInterval,
  type MembershipTier,
} from "@/lib/membership/tiers";

const DESCRIPTION =
  "Accountabul memberships unlock the live conference rooms, and business plans turn your vendor page into a verified public website.";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Membership pricing — Accountabul" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Membership pricing — Accountabul" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const { session } = useSession();
  const tiers = useMembershipTiers();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [audience, setAudience] = useState<"individual" | "business">("individual");
  const startCheckout = useServerFn(createMembershipCheckout);
  const loadCheckoutReadiness = useServerFn(getCheckoutReadiness);
  const readiness = useQuery({
    queryKey: ["checkout-readiness", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: () => loadCheckoutReadiness(),
  });
  const checkoutReady = readiness.data?.ready === true;

  const checkout = useMutation({
    mutationFn: (tierKey: string) => {
      if (readiness.data && !readiness.data.ready) {
        throw new Error("Checkout is not configured on the server yet.");
      }
      return startCheckout({
        data: { tierKey, billingInterval: interval, attemptId: crypto.randomUUID() },
      });
    },
    onSuccess: (result) => {
      if (!result.checkoutUrl) {
        toast.error("Checkout is not available for this plan yet.");
        return;
      }
      window.location.href = result.checkoutUrl;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const visible = (tiers.data ?? []).filter(
    (tier) => tier.audience === "both" || tier.audience === audience,
  );

  return (
    <PageShell eyebrow="Membership" title="Pick your plan" description={DESCRIPTION}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Toggle
          value={audience}
          onChange={(next) => setAudience(next as "individual" | "business")}
          options={[
            { value: "individual", label: "For members" },
            { value: "business", label: "For businesses" },
          ]}
        />
        <Toggle
          value={interval}
          onChange={(next) => setInterval(next as BillingInterval)}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annual", label: "Annual · 2 months free" },
          ]}
        />
      </div>

      {tiers.isLoading ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Loading plans…</p>
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {visible.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            interval={interval}
            audience={audience}
            signedIn={Boolean(session)}
            checkoutReady={checkoutReady}
            pending={checkout.isPending && checkout.variables === tier.slug}
            onSelect={() => checkout.mutate(tier.slug)}
          />
        ))}
      </div>

      <section className="surface-card mt-10 p-6">
        <h2 className="font-semibold">Verified Vendor vs the Verified Vendor Network</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Verified Vendor</strong> means we checked and approved
          the business: an active business plan plus a passed entity check on the legal name and
          EIN. It unlocks the public business page and the verified badge.{" "}
          <strong className="text-foreground">The Verified Vendor Network</strong> is our partner
          program — invitation only, never granted by payment alone.
        </p>
      </section>
    </PageShell>
  );
}

function Toggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TierCard({
  tier,
  interval,
  audience,
  signedIn,
  checkoutReady,
  pending,
  onSelect,
}: {
  tier: MembershipTier;
  interval: BillingInterval;
  audience: "individual" | "business";
  signedIn: boolean;
  checkoutReady: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const amount = tierPriceMinor(tier, interval);
  const features =
    audience === "business" && tier.business_features.length > 0
      ? tier.business_features
      : tier.features;

  return (
    <div
      className={`surface-card flex flex-col p-6 ${
        tier.is_popular ? "border-primary shadow-md" : ""
      }`}
    >
      {tier.is_popular ? <Badge className="mb-3 self-start">Most popular</Badge> : null}
      <h2 className="text-lg font-semibold">{tier.name}</h2>
      <p className="mt-3">
        <span className="text-3xl font-bold">{formatMoney(amount, tier.currency)}</span>
        <span className="text-sm text-muted-foreground">
          {interval === "annual" ? "/year" : "/month"}
        </span>
      </p>
      {tier.highlight_feature ? (
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-primary">
          {tier.highlight_feature}
        </p>
      ) : null}
      <p className="mt-3 min-h-12 text-sm text-muted-foreground">{tier.description}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {signedIn ? (
        <Button className="mt-6" disabled={pending || !checkoutReady} onClick={onSelect}>
          {pending ? "Opening checkout…" : checkoutReady ? tier.cta_label : "Checkout unavailable"}
        </Button>
      ) : (
        <Button asChild className="mt-6">
          <Link to={audience === "business" ? "/signup/business" : "/signup/individual"}>
            {tier.cta_label}
          </Link>
        </Button>
      )}
    </div>
  );
}
