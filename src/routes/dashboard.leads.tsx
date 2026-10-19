import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useMyBusiness } from "@/hooks/use-business";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/dashboard/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Accountabul dashboard" },
      {
        name: "description",
        content: "Property and service inquiries sent to your business, with status tracking.",
      },
      { property: "og:title", content: "Leads — Accountabul dashboard" },
      {
        property: "og:description",
        content: "Property and service inquiries sent to your business, with status tracking.",
      },
    ],
  }),
  component: LeadsDashboard,
});

type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost" | "spam";
const statuses: LeadStatus[] = ["new", "contacted", "qualified", "won", "lost", "spam"];

function LeadsDashboard() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const membership = useMyBusiness();
  const businessId = membership.data?.business_id ?? null;
  const queryClient = useQueryClient();

  const leads = useQuery({
    queryKey: ["leads", businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const [propertyLeads, serviceLeads, properties, services] = await Promise.all([
        supabase.rpc("list_property_inquiries", { p_business_id: businessId! }),
        supabase.rpc("list_service_inquiries", { p_business_id: businessId! }),
        supabase.from("properties").select("id, title").eq("business_id", businessId!),
        supabase.from("services").select("id, name").eq("business_id", businessId!),
      ]);
      if (propertyLeads.error) throw propertyLeads.error;
      if (serviceLeads.error) throw serviceLeads.error;
      if (properties.error) throw properties.error;
      if (services.error) throw services.error;
      const propertyTitles = new Map((properties.data ?? []).map((p) => [p.id, p.title]));
      const serviceNames = new Map((services.data ?? []).map((s) => [s.id, s.name]));
      return [
        ...(propertyLeads.data ?? []).map((l) => ({
          ...l,
          table: "property_inquiries" as const,
          subject: propertyTitles.get(l.property_id) ?? "Listing",
        })),
        ...(serviceLeads.data ?? []).map((l) => ({
          ...l,
          table: "service_inquiries" as const,
          subject: serviceNames.get(l.service_id) ?? "Service",
        })),
      ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({
      table,
      id,
      status,
    }: {
      table: "property_inquiries" | "service_inquiries";
      id: string;
      status: LeadStatus;
    }) => {
      const { error } = await supabase.rpc("update_inquiry_status", {
        p_table: table,
        p_id: id,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead updated.");
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Checking your session…</p>;
  if (!userId) return <SignedOut />;
  if (membership.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your lead inbox…</p>;
  }
  if (membership.isError) {
    return (
      <div className="surface-card p-6">
        <h1 className="text-xl font-semibold">We couldn’t load your lead inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Refresh the page to try again. Existing inquiries have not been changed.
        </p>
      </div>
    );
  }

  if (!businessId) {
    return (
      <div className="surface-card p-6">
        <h1 className="text-xl font-semibold">Leads need a business</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inquiries arrive once your business has published listings or services.
        </p>
        <Link to="/dashboard/business" className="mt-4 inline-block text-sm text-accent underline">
          Go to business setup
        </Link>
      </div>
    );
  }

  return (
    <section className="surface-card p-6">
      <h1 className="text-lg font-semibold">Leads</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every inquiry sent to your business. Only your team and Accountabul admins can read these.
      </p>

      <ul className="mt-5 space-y-3">
        {leads.isLoading ? <li className="text-sm text-muted-foreground">Loading leads…</li> : null}
        {leads.data?.length === 0 ? (
          <li className="text-sm text-muted-foreground">No inquiries yet.</li>
        ) : null}
        {leads.data?.map((lead) => (
          <li key={`${lead.table}-${lead.id}`} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {lead.contact_name} ·{" "}
                  <span className="text-muted-foreground">{lead.subject}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {lead.contact_email}
                  {lead.contact_phone ? ` · ${lead.contact_phone}` : ""} ·{" "}
                  {formatDateTime(lead.created_at)}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs capitalize">
                {lead.status}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-line text-sm">{lead.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {statuses.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={lead.status === s ? "secondary" : "ghost"}
                  onClick={() => setStatus.mutate({ table: lead.table, id: lead.id, status: s })}
                >
                  {s}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
