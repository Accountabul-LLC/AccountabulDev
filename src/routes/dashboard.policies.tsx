import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMyBusiness } from "@/hooks/use-business";
import { supabase } from "@/integrations/supabase/client";
import { POLICY_TYPES } from "@/lib/business-site";
import { slugify } from "@/lib/format";

export const Route = createFileRoute("/dashboard/policies")({
  component: DashboardPoliciesPage,
});

type PolicyDraft = {
  id?: string;
  title: string;
  policy_type: string;
  content: string;
  is_published: boolean;
};

const emptyDraft: PolicyDraft = {
  title: "",
  policy_type: "Custom",
  content: "",
  is_published: false,
};

function DashboardPoliciesPage() {
  const membership = useMyBusiness();
  const businessId = membership.data?.business_id;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PolicyDraft | null>(null);

  const policies = useQuery({
    queryKey: ["dashboard-policies", businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_policies")
        .select("id, title, slug, policy_type, content, is_published, updated_at")
        .eq("business_id", businessId!)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (value: PolicyDraft) => {
      if (!businessId) throw new Error("No business selected.");
      const title = value.title.trim();
      if (!title) throw new Error("A policy title is required.");
      const payload = {
        business_id: businessId,
        title,
        policy_type: value.policy_type,
        content: value.content,
        is_published: value.is_published,
        slug: slugify(title) || "policy",
      };
      if (value.id) {
        const { error } = await supabase
          .from("business_policies")
          .update(payload)
          .eq("id", value.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("business_policies").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["dashboard-policies", businessId] });
      toast.success("Policy saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("business_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard-policies", businessId] });
      toast.success("Policy deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase
        .from("business_policies")
        .update({ is_published: next })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard-policies", businessId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!membership.isLoading && !businessId) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a business profile before publishing policies.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Policies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish the policies shown on your public business website.
          </p>
        </div>
        <Button type="button" onClick={() => setDraft({ ...emptyDraft })}>
          Create policy
        </Button>
      </div>

      {draft ? (
        <form
          className="grid gap-4 rounded-lg border border-border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="grid gap-2">
            <label htmlFor="policy-title" className="text-sm font-medium">
              Policy title
            </label>
            <Input
              id="policy-title"
              value={draft.title}
              maxLength={120}
              required
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="policy-type" className="text-sm font-medium">
              Policy type
            </label>
            <select
              id="policy-type"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={draft.policy_type}
              onChange={(event) => setDraft({ ...draft, policy_type: event.target.value })}
            >
              {POLICY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <label htmlFor="policy-content" className="text-sm font-medium">
              Policy content
            </label>
            <Textarea
              id="policy-content"
              rows={12}
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder="Write or paste your policy text…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(event) => setDraft({ ...draft, is_published: event.target.checked })}
            />
            Published on the public business website
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save policy"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {policies.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading policies…</p>
      ) : policies.data?.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {policies.data.map((policy) => (
            <li key={policy.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{policy.title}</p>
                <p className="text-xs text-muted-foreground">
                  {policy.policy_type} · {policy.is_published ? "Published" : "Draft"} · Updated{" "}
                  {new Date(policy.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => togglePublish.mutate({ id: policy.id, next: !policy.is_published })}
              >
                {policy.is_published ? "Unpublish" : "Publish"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    id: policy.id,
                    title: policy.title,
                    policy_type: policy.policy_type,
                    content: policy.content,
                    is_published: policy.is_published,
                  })
                }
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => remove.mutate(policy.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="font-medium">No policies yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add policies such as refunds, cancellations, or privacy.
          </p>
        </div>
      )}
    </div>
  );
}
