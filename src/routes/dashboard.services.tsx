import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ImageUploader } from "@/components/image-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMyBusiness } from "@/hooks/use-business";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { canManageBusinessWorkspace } from "@/lib/business-capabilities";
import { isBusinessApproved } from "@/lib/business-review";
import { formatMoney, parseMoneyToMinor, uniqueSlug } from "@/lib/format";
import { BUSINESS_MEDIA_BUCKET } from "@/lib/media";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/dashboard/services")({
  head: () => ({
    meta: [
      { title: "Your services — Accountabul dashboard" },
      {
        name: "description",
        content: "Publish the services your business offers and manage their availability.",
      },
      { property: "og:title", content: "Your services — Accountabul dashboard" },
      {
        property: "og:description",
        content: "Publish the services your business offers and manage their availability.",
      },
    ],
  }),
  component: ServicesDashboard,
});

const emptyDraft = {
  name: "",
  category: "",
  price: "",
  price_note: "",
  summary: "",
  description: "",
  service_areas: "",
};

function ServicesDashboard() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const membership = useMyBusiness();
  const businessId = membership.data?.business_id ?? null;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const canManage = canManageBusinessWorkspace(membership.data?.membership_role);
  const business = membership.data?.businesses;
  const isApproved = business ? isBusinessApproved(business) : false;

  const services = useQuery({
    queryKey: ["dashboard-services", businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select(
          "id, name, category, status, price_minor, currency, price_note, summary, description, service_areas, image_path, created_at",
        )
        .eq("business_id", businessId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  function serviceValues() {
    return {
      name: draft.name.trim(),
      category: draft.category.trim() || null,
      price_minor: parseMoneyToMinor(draft.price),
      price_note: draft.price_note.trim() || null,
      summary: draft.summary.trim() || null,
      description: draft.description.trim() || null,
      service_areas: draft.service_areas
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  const saveService = useMutation({
    mutationFn: async () => {
      if (!businessId || !userId) throw new Error("Create your business profile first.");
      if (!canManage) throw new Error("Only business owners and managers can edit services.");
      if (!draft.name.trim()) throw new Error("A service name is required.");
      const values = serviceValues();
      const { error } = editingId
        ? await supabase.from("services").update(values).eq("id", editingId)
        : await supabase.from("services").insert({
            ...values,
            business_id: businessId,
            created_by: userId,
            slug: uniqueSlug(draft.name),
            status: "draft",
          });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft(emptyDraft);
      toast.success(editingId ? "Service saved." : "Service draft created.");
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["dashboard-services"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "draft" | "published" | "archived";
    }) => {
      if (!canManage) throw new Error("Only business owners and managers can edit services.");
      if (status === "published" && !isApproved) {
        throw new Error("Your business must be approved before a service can be published.");
      }
      const { error } = await supabase
        .from("services")
        .update({ status, published_at: status === "published" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Service updated.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard-services"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setImage = useMutation({
    mutationFn: async ({ id, imagePath }: { id: string; imagePath: string | null }) => {
      if (!canManage) throw new Error("Only business owners and managers can edit services.");
      const { error } = await supabase
        .from("services")
        .update({ image_path: imagePath })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Service image saved.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard-services"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Checking your session…</p>;
  if (!userId) return <SignedOut />;

  if (!businessId) {
    return (
      <div className="surface-card p-6">
        <h1 className="text-xl font-semibold">Services need a business</h1>
        <p className="mt-2 text-sm text-muted-foreground">Create your business profile first.</p>
        <Link to="/dashboard/business" className="mt-4 inline-block text-sm text-accent underline">
          Go to business setup
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <form
        className="surface-card space-y-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          saveService.mutate();
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Offerings</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">
            {editingId ? "Edit service" : "Add a service"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create service drafts at any time. Publishing unlocks after Accountabul approves your
            business.
          </p>
        </div>
        <div>
          <Label htmlFor="name">Service name</Label>
          <Input
            id="name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Input
            id="category"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="price">Price (USD)</Label>
            <Input
              id="price"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="price_note">Price note</Label>
            <Input
              id="price_note"
              value={draft.price_note}
              onChange={(e) => setDraft({ ...draft, price_note: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="summary">Summary</Label>
          <Input
            id="summary"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={4}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="service_areas">Service areas (comma separated)</Label>
          <Input
            id="service_areas"
            value={draft.service_areas}
            onChange={(e) => setDraft({ ...draft, service_areas: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saveService.isPending || !canManage}>
            {saveService.isPending ? "Saving…" : editingId ? "Save changes" : "Create service"}
          </Button>
          {editingId ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditingId(null);
                setDraft(emptyDraft);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Your business role has read-only access to services.
          </p>
        ) : null}
      </form>

      <section className="surface-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Public catalog
            </p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Your services</h2>
          </div>
          <span className="text-sm text-muted-foreground">{services.data?.length ?? 0} total</span>
        </div>
        <ul className="mt-4 space-y-3">
          {services.isLoading ? <li className="text-sm text-muted-foreground">Loading…</li> : null}
          {services.data?.length === 0 ? (
            <li className="text-sm text-muted-foreground">No services yet.</li>
          ) : null}
          {services.data?.map((s) => (
            <li key={s.id} className="rounded-xl border border-border p-4">
              <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <ImageUploader
                  label={`${s.name} image`}
                  hint="Displayed with this service on your public page."
                  bucket={BUSINESS_MEDIA_BUCKET}
                  businessId={businessId}
                  folder={`services/${s.id}`}
                  value={s.image_path}
                  onChange={(path) => setImage.mutateAsync({ id: s.id, imagePath: path })}
                  disabled={!canManage}
                />
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.category ?? "Uncategorised"} ·{" "}
                        {s.price_note ?? formatMoney(s.price_minor, s.currency)} · {s.status}
                      </p>
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
                      {s.status}
                    </span>
                  </div>
                  {s.summary ? <p className="mt-3 text-sm leading-relaxed">{s.summary}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => {
                        setEditingId(s.id);
                        setDraft({
                          name: s.name,
                          category: s.category ?? "",
                          price:
                            s.price_minor == null ? "" : (Number(s.price_minor) / 100).toFixed(2),
                          price_note: s.price_note ?? "",
                          summary: s.summary ?? "",
                          description: s.description ?? "",
                          service_areas: (s.service_areas ?? []).join(", "),
                        });
                      }}
                    >
                      Edit
                    </Button>
                    {s.status !== "published" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canManage || !isApproved}
                        onClick={() => setStatus.mutate({ id: s.id, status: "published" })}
                        title={
                          isApproved
                            ? "Publish this service"
                            : "Business approval is required before publishing"
                        }
                      >
                        Publish
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => setStatus.mutate({ id: s.id, status: "draft" })}
                      >
                        Unpublish
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canManage}
                      onClick={() => setStatus.mutate({ id: s.id, status: "archived" })}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
