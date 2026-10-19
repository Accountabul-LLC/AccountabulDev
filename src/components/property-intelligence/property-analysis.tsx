// Adapted from Accountabul-LLC/property-insight-hub src/components/property-analysis.tsx.
// property-insight-hub's version is a full address-workspace shell with AI chat
// (property-chat.server.ts), live nationwide property sourcing (live-property-source.server.ts)
// and owner/entity research (owner-research.ts) — all of which depend on the nationwide
// ingestion pipeline or brand-new chat/report tables this pass explicitly does not port (see
// docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). accountabul-final already has a working,
// St. Louis-Assessor-backed parcel workspace flow (property-workspace.functions.ts /
// workspace.server.ts, backed by supabase/migrations/20260923160000_property_intelligence_workspaces.sql).
// This component keeps that existing flow (search → open → list → get → close) and restyles it
// to match property-insight-hub's detail-panel layout, including its VerificationBadge use.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  closePropertyWorkspace,
  getPropertyWorkspace,
  listPropertyWorkspaces,
  openPropertyWorkspace,
  searchParcels,
} from "@/lib/property-intelligence/property-workspace.functions";
import {
  verificationTierForRecord,
  verificationTiers,
} from "@/lib/property-intelligence/verification";
import { VerificationBadge } from "@/components/property-intelligence/verification-badge";
import { PropertyAnalysisQa } from "@/components/property-intelligence/property-analysis-qa";
import PropertyIntake from "@/components/property-intelligence/property-intake";

const money = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

type ParcelMatch = { parcelId: string; address: string; [key: string]: unknown };

type WorkspaceData = {
  id: string;
  title: string;
  status: string;
  property_intel_parcels: {
    asr_parcel_id: string;
    current_address: string | null;
    last_intelligence_sync_at: string | null;
    property_intel_profiles: Record<string, unknown> | null;
  } | null;
};

const DOSSIER_FIELDS: Array<[string, string]> = [
  ["owner_name", "Owner of record"],
  ["owner_name_2", "Additional owner of record"],
  ["legal_description", "Legal description"],
  ["zoning", "Zoning"],
  ["land_use_code", "Land use"],
  ["assessor_class_code", "Assessor class"],
  ["lot_square_feet", "Lot size (sq ft)"],
  ["assessed_total_value", "Assessed total value"],
  ["last_residential_sale_price", "Last residential sale price"],
  ["last_residential_sale_date", "Last residential sale date"],
  ["neighborhood_code", "Neighborhood code"],
  ["zip_code", "ZIP"],
];

export default function PropertyAnalysis() {
  const search = useServerFn(searchParcels);
  const open = useServerFn(openPropertyWorkspace);
  const list = useServerFn(listPropertyWorkspaces);
  const get = useServerFn(getPropertyWorkspace);
  const close = useServerFn(closePropertyWorkspace);
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const matches = useQuery({
    queryKey: ["parcel-search", submittedQuery],
    queryFn: () => search({ data: { query: submittedQuery } }),
    enabled: submittedQuery.length > 0,
  });

  const workspaces = useQuery({
    queryKey: ["property-workspaces"],
    queryFn: () => list(),
  });

  const openMutation = useMutation({
    mutationFn: (parcel: ParcelMatch) => open({ data: { parcel } }),
    onSuccess: (result) => {
      setActiveThreadId(result.threadId);
      void queryClient.invalidateQueries({ queryKey: ["property-workspaces"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not open that parcel."),
  });

  const closeMutation = useMutation({
    mutationFn: (threadId: string) => close({ data: { threadId } }),
    onSuccess: (_, threadId) => {
      if (threadId === activeThreadId) setActiveThreadId(null);
      void queryClient.invalidateQueries({ queryKey: ["property-workspaces"] });
    },
  });

  const activeWorkspace = useQuery({
    queryKey: ["property-workspace", activeThreadId],
    queryFn: () => get({ data: { threadId: activeThreadId as string } }),
    enabled: Boolean(activeThreadId),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="surface-card space-y-4 p-4">
        <div>
          <Label htmlFor="parcel-query">Address or 11-digit parcel ID</Label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSubmittedQuery(query);
            }}
            className="mt-1 flex gap-2"
          >
            <Input
              id="parcel-query"
              value={query}
              placeholder="5253 Maffitt Av, or an 11-digit parcel ID"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit">Look up</Button>
          </form>
          {matches.isFetching ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Searching the official Assessor index…
            </p>
          ) : matches.data?.error ? (
            <p className="mt-2 text-xs text-destructive">{matches.data.error}</p>
          ) : matches.data && matches.data.results.length === 0 && submittedQuery ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No official Assessor match. Try the house number and street name only.
            </p>
          ) : null}
        </div>

        {matches.data && matches.data.results.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {matches.data.results.map((match) => (
              <li key={match.parcelId} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-medium">{match.address}</span>
                  <span className="text-xs text-muted-foreground">Parcel {match.parcelId}</span>
                </span>
                <Button
                  size="sm"
                  disabled={openMutation.isPending}
                  onClick={() => openMutation.mutate(match)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your property workspaces
          </h3>
          <ul className="mt-2 divide-y divide-border text-sm">
            {(workspaces.data ?? []).map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between gap-2 py-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setActiveThreadId(workspace.id)}
                >
                  <span className="block font-medium">{workspace.title}</span>
                  <span className="text-xs text-muted-foreground">
                    Parcel {workspace.property_intel_parcels?.asr_parcel_id ?? "—"} ·{" "}
                    {workspace.status}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Close ${workspace.title}`}
                  onClick={() => closeMutation.mutate(workspace.id)}
                >
                  Close
                </Button>
              </li>
            ))}
            {workspaces.data?.length === 0 ? (
              <li className="py-2 text-xs text-muted-foreground">
                No workspaces yet. Look up an address to open one.
              </li>
            ) : null}
          </ul>
        </div>
      </section>

      <section className="surface-card p-5">
        {!activeThreadId ? (
          <p className="text-sm text-muted-foreground">
            Look up an address or open a saved workspace to see its sourced Assessor dossier.
          </p>
        ) : activeWorkspace.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        ) : activeWorkspace.data ? (
          <WorkspaceDossier workspace={activeWorkspace.data as WorkspaceData} />
        ) : (
          <p className="text-sm text-muted-foreground">That workspace could not be loaded.</p>
        )}
      </section>

      {/* Q&A is scoped to one workspace: the server rebuilds that parcel's
          dossier per question, so there is nothing to ask until one is open. */}
      {activeThreadId ? (
        <section className="surface-card p-5">
          {/* Intake is what the user claims about this property, kept beside
              the sourced dossier rather than mixed into it. */}
          <PropertyIntake threadId={activeThreadId} />
        </section>
      ) : null}

      {activeThreadId ? (
        <section className="surface-card p-5">
          <PropertyAnalysisQa threadId={activeThreadId} />
        </section>
      ) : null}
    </div>
  );
}

function WorkspaceDossier({ workspace }: { workspace: WorkspaceData }) {
  const parcel = workspace.property_intel_parcels;
  const profile = parcel?.property_intel_profiles;
  const tier = verificationTierForRecord("trusted-provider");
  const badge = verificationTiers[tier];

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Property analysis
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{workspace.title}</h2>
          <p className="text-sm text-muted-foreground">
            Parcel {parcel?.asr_parcel_id ?? "—"} · Status: {workspace.status}
          </p>
        </div>
        <VerificationBadge tier={tier} />
      </div>

      {profile ? (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {DOSSIER_FIELDS.map(([key, label]) => {
            const value = profile[key];
            const display =
              value === null || value === undefined || value === ""
                ? "Not published"
                : typeof value === "number"
                  ? key.includes("value") || key.includes("price")
                    ? money(value)
                    : value.toLocaleString()
                  : String(value);
            return (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium">{display}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          No Assessor dossier is attached to this parcel yet.
        </p>
      )}

      <p className="mt-5 text-xs text-muted-foreground" title={badge.description}>
        This is a sourced Assessor record, not an appraisal, title report or purchase
        recommendation. Confirm current facts with the official parcel record before an offer.
      </p>
    </div>
  );
}
