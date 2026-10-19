// Adapted from Accountabul-LLC/property-insight-hub src/components/api-access.tsx and
// api-documentation.tsx, and Accountabul-LLC/property-intelligence-app's api-access.tsx /
// api-access-repository.ts. Phase 5 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md: an actual,
// low-priority internal-ops request queue backed by property_api_access_requests
// (supabase/migrations/20260924120000_property_api_access_requests.sql). Submitting a request
// never itself grants API credentials — status starts 'pending' and only an admin review
// (reviewApiAccessRequest) can change it; this component only ever shows the caller's own
// request and cannot set its own status.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getOwnApiAccessRequest,
  submitApiAccessRequest,
} from "@/lib/property-intelligence/api-access-requests.functions";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};

function RequestStatus() {
  const get = useServerFn(getOwnApiAccessRequest);
  const submit = useServerFn(submitApiAccessRequest);
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [useCase, setUseCase] = useState("");
  const [monthlyVolume, setMonthlyVolume] = useState("");

  const request = useQuery({
    queryKey: ["api-access-request"],
    queryFn: () => get(),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          email: email.trim(),
          organization: organization.trim(),
          useCase: useCase.trim(),
          monthlyVolume: monthlyVolume.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Request submitted for review.");
      void queryClient.invalidateQueries({ queryKey: ["api-access-request"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not submit that request."),
  });

  if (request.isLoading) {
    return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>;
  }

  if (request.data) {
    return (
      <div className="rounded-md bg-secondary p-4 text-sm">
        <p className="font-medium">
          Your request: {STATUS_LABEL[request.data.status] ?? request.data.status}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Submitted {new Date(request.data.created_at).toLocaleDateString()} for{" "}
          {request.data.organization}. Approval never happens automatically — an Accountabul admin
          reviews every request by hand.
        </p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submitMutation.mutate();
      }}
    >
      <div>
        <Label htmlFor="api-access-email">Email</Label>
        <Input
          id="api-access-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="api-access-org">Organization</Label>
        <Input
          id="api-access-org"
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="api-access-use-case">Intended use case</Label>
        <Textarea
          id="api-access-use-case"
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="api-access-volume">Estimated monthly volume</Label>
        <Input
          id="api-access-volume"
          value={monthlyVolume}
          onChange={(event) => setMonthlyVolume(event.target.value)}
          placeholder="e.g. 5,000 requests / month"
          required
        />
      </div>
      <Button type="submit" disabled={submitMutation.isPending}>
        {submitMutation.isPending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}

const endpoints = [
  {
    method: "POST",
    path: "searchPropertyRecords",
    description:
      "Paginated, filtered search over official City-owned, tax-sale and Assessor property records.",
  },
  {
    method: "POST",
    path: "searchParcels",
    description: "Address or 11-digit parcel ID lookup against the official Assessor index.",
  },
  {
    method: "POST",
    path: "openPropertyWorkspace",
    description: "Opens (or reopens) a permanent, per-account workspace for a verified parcel.",
  },
  {
    method: "GET",
    path: "getPropertyWorkspace",
    description: "Returns a workspace's Assessor dossier, refreshing it when it has gone stale.",
  },
] as const;

export default function ApiAccess() {
  return (
    <div className="surface-card space-y-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Property Intelligence API
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">Connect your software</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Accountabul&apos;s property intelligence currently ships as an in-app member workspace,
          not a public, self-serve API. If your product needs structured access to this data, reach
          out and we&apos;ll review the request directly.
        </p>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">
          What the internal read surface looks like today
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the server functions this workspace already calls; a public API would be a
          reviewed, authenticated wrapper around the same reads.
        </p>
        <ul className="mt-3 divide-y divide-border text-sm">
          {endpoints.map((endpoint) => (
            <li key={endpoint.path} className="py-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {endpoint.method}
                </span>
                <code className="text-sm font-medium">{endpoint.path}</code>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{endpoint.description}</p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold">Requesting access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Structured API access requests are reviewed by hand. Submitting a request below never
          grants credentials on its own — it starts as pending review, and only an Accountabul admin
          can approve or deny it. Questions? Reach the team at{" "}
          <a className="underline" href="mailto:support@accountabul.com">
            support@accountabul.com
          </a>
          .
        </p>
        <div className="mt-3">
          <RequestStatus />
        </div>
      </div>
    </div>
  );
}
