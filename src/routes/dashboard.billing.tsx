import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { createCustomerPortalSession, getBillingSummary } from "@/lib/billing/billing.functions";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/dashboard/billing")({
  head: () => ({
    meta: [
      { title: "Billing — Accountabul" },
      {
        name: "description",
        content: "Tip receipts, payment status, and reconciled payout history.",
      },
      { property: "og:title", content: "Billing — Accountabul" },
      {
        property: "og:description",
        content: "Tip receipts, payment status, and reconciled payout history.",
      },
    ],
  }),
  component: DashboardBilling,
});

function DashboardBilling() {
  const { session, loading } = useSession();
  const loadBillingSummary = useServerFn(getBillingSummary);
  const createPortal = useServerFn(createCustomerPortalSession);

  const billing = useQuery({
    queryKey: ["billing-summary", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: () => loadBillingSummary(),
  });

  const portal = useMutation({
    mutationFn: () => createPortal(),
    onSuccess: (result) => {
      window.location.href = result.portalUrl;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sent = useQuery({
    queryKey: ["tips-sent", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tips")
        .select(
          "id, amount_minor, currency, status, message, created_at, paid_at, events(title, slug)",
        )
        .eq("from_user_id", session!.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const received = useQuery({
    queryKey: ["tips-received", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: async () => {
      const { data: memberships, error: membershipError } =
        await supabase.rpc("get_my_memberships");
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) return [];
      const { data, error } = await supabase
        .from("tips")
        .select("id, amount_minor, currency, status, message, created_at, paid_at")
        .eq("to_business_id", membership.business_id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) return <SignedOut />;

  const paidReceived = (received.data ?? []).filter((t) => t.status === "paid");
  const receivedTotal = paidReceived.reduce((sum, t) => sum + Number(t.amount_minor), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Memberships, passes, comments, and tips are reconciled from signed payment-provider
        webhooks. Browser redirects never grant access.
      </p>
      {billing.data && !billing.data.checkoutReady ? (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Checkout is locked until the server has {billing.data.missingCheckoutSecrets.join(", ")}.
          Prices cannot be changed from this page.
        </p>
      ) : null}

      <section className="surface-card mt-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Accountabul membership
          </h2>
          {billing.data?.subscription && billing.data.checkoutReady ? (
            <Button variant="secondary" disabled={portal.isPending} onClick={() => portal.mutate()}>
              {portal.isPending ? "Opening…" : "Manage in Stripe"}
            </Button>
          ) : null}
        </div>
        <div className="mt-4">
          {billing.data?.subscription ? (
            <p className="text-sm">
              <strong className="capitalize">
                {billing.data.subscription.tier_key.replaceAll("_", " ")}
              </strong>
              {" · "}
              {billing.data.subscription.status.replaceAll("_", " ")}
              {billing.data.subscription.current_period_end
                ? ` · through ${formatDateTime(billing.data.subscription.current_period_end)}`
                : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No membership</p>
          )}
          {billing.data?.subscription?.grace_expires_at ? (
            <p className="mt-2 text-xs text-amber-700">
              Renewal grace ends {formatDateTime(billing.data.subscription.grace_expires_at)}.
            </p>
          ) : null}
        </div>
      </section>

      <section className="surface-card mt-6 p-6">
        <h2 className="border-b border-border pb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent payments
        </h2>
        <ul className="mt-4 space-y-2">
          {billing.data?.payments.length === 0 ? (
            <li className="text-sm text-muted-foreground">No payment records yet.</li>
          ) : null}
          {billing.data?.payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <span className="capitalize">
                {payment.kind.replaceAll("_", " ")} ·{" "}
                {formatMoney(payment.amount_minor, payment.currency)}
              </span>
              <span className="text-xs text-muted-foreground">
                {payment.status.replaceAll("_", " ")} ·{" "}
                {formatDateTime(payment.paid_at ?? payment.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card mt-6 p-6">
        <h2 className="border-b border-border pb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tips you sent
        </h2>
        <ul className="mt-4 space-y-2">
          {sent.data?.length === 0 ? (
            <li className="text-sm text-muted-foreground">No tips yet.</li>
          ) : null}
          {sent.data?.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <span>
                {formatMoney(Number(t.amount_minor), t.currency)}
                {t.events?.title ? ` · ${t.events.title}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.status} · {formatDateTime(t.paid_at ?? t.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card mt-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Tips your business received
          </h2>
          <Button
            variant="secondary"
            onClick={() => toast.message("Tipping setup is coming soon.")}
          >
            Set up tipping
          </Button>
        </div>
        <p className="mt-4 text-sm">
          Confirmed total: <strong>{formatMoney(receivedTotal)}</strong> across{" "}
          {paidReceived.length} tips.
        </p>
        <ul className="mt-4 space-y-2">
          {received.data?.length === 0 ? (
            <li className="text-sm text-muted-foreground">No tips received yet.</li>
          ) : null}
          {received.data?.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
            >
              <span>
                {formatMoney(Number(t.amount_minor), t.currency)}
                {t.message ? ` · “${t.message}”` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.status} · {formatDateTime(t.paid_at ?? t.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
