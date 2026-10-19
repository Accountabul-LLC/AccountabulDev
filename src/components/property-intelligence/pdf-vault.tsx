// Phase 4 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md ("PDF Vault"): adapted
// in concept from Accountabul-LLC/property-intelligence-app's
// app/report-actions.tsx + app/records-portal.tsx, rebuilt against this
// repo's own workspace/deal-scenario/owner-document data instead of that
// app's AI-chat-driven report packet (see report-pdf.server.ts's header for
// why the PDF's contents differ). Lets the signed-in user pick one of their
// open workspaces, generate a report PDF for it (content-hash deduped --
// generating again with unchanged data returns the same report instead of a
// duplicate), and download/print/share previously generated reports.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { listPropertyWorkspaces } from "@/lib/property-intelligence/property-workspace.functions";
import {
  generateReportSnapshot,
  getReportDownloadUrl,
  listReportVault,
  recordReportDelivery,
} from "@/lib/property-intelligence/report-vault.functions";
import type { DeliveryAction } from "@/lib/property-intelligence/report-vault-validation";

type VaultReport = {
  id: string;
  thread_id: string;
  pdf_size: number;
  created_at: string;
  property_analysis_threads: {
    title: string;
    property_intel_parcels: { asr_parcel_id: string } | null;
  } | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReportRow({
  report,
  onDeliver,
}: {
  report: VaultReport;
  onDeliver: (reportId: string, action: DeliveryAction) => void;
}) {
  const getUrl = useServerFn(getReportDownloadUrl);
  const [opening, setOpening] = useState<DeliveryAction | null>(null);

  const open = async (action: DeliveryAction) => {
    setOpening(action);
    try {
      const { url } = await getUrl({ data: { reportId: report.id } });
      if (!url) throw new Error("That report's PDF is unavailable.");
      onDeliver(report.id, action);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that report.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <li className="space-y-1 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {report.property_analysis_threads?.title ?? "Property report"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {report.property_analysis_threads?.property_intel_parcels?.asr_parcel_id ??
          "Parcel unknown"}
        {" · "}
        {formatBytes(report.pdf_size)}
        {" · generated "}
        {new Date(report.created_at).toLocaleDateString()}
      </p>
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={opening !== null}
          onClick={() => open("download")}
        >
          {opening === "download" ? "Opening…" : "Download"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={opening !== null}
          onClick={() => open("print")}
        >
          {opening === "print" ? "Opening…" : "Print"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={opening !== null}
          onClick={() => open("share")}
        >
          {opening === "share" ? "Opening…" : "Share"}
        </Button>
      </div>
    </li>
  );
}

export default function PdfVault() {
  const listWorkspaces = useServerFn(listPropertyWorkspaces);
  const listVault = useServerFn(listReportVault);
  const generate = useServerFn(generateReportSnapshot);
  const deliver = useServerFn(recordReportDelivery);
  const queryClient = useQueryClient();

  const [threadId, setThreadId] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ["property-workspaces"],
    queryFn: () => listWorkspaces(),
  });

  const reports = useQuery({
    queryKey: ["property-report-vault"],
    queryFn: () => listVault(),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!threadId) throw new Error("Choose a property workspace first.");
      return generate({ data: { threadId } });
    },
    onSuccess: (result) => {
      toast.success(
        result.reused
          ? "Nothing changed since the last report — reused the existing PDF."
          : "Report generated.",
      );
      void queryClient.invalidateQueries({ queryKey: ["property-report-vault"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not generate that report."),
  });

  const handleDeliver = (reportId: string, action: DeliveryAction) => {
    void deliver({ data: { reportId, action } }).catch(() => {
      // Best-effort action history; the download/print/share itself already succeeded.
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="surface-card space-y-4 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            PDF vault
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold">Generate a property report</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Combines the official Assessor facts, your saved Deal Analyst scenario, and your
            Accountabul-verified owner records for one workspace into a single PDF. Generating again
            with nothing changed reuses the same PDF instead of creating a duplicate.
          </p>
        </div>

        <div>
          <Label htmlFor="vault-workspace">Property workspace</Label>
          <select
            id="vault-workspace"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={threadId ?? ""}
            onChange={(event) => setThreadId(event.target.value || null)}
          >
            <option value="">Choose a workspace…</option>
            {(workspaces.data ?? []).map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.title}
              </option>
            ))}
          </select>
          {workspaces.data?.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Open an address in "Address lookup" first, then come back here to generate its report.
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          disabled={!threadId || generateMutation.isPending}
          onClick={() => generateMutation.mutate()}
        >
          {generateMutation.isPending ? "Generating…" : "Generate report"}
        </Button>
      </section>

      <section className="surface-card p-5">
        <h2 className="font-display text-lg font-semibold">Your reports</h2>
        {reports.isLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {(reports.data ?? []).map((report) => (
              <ReportRow key={report.id} report={report as VaultReport} onDeliver={handleDeliver} />
            ))}
            {reports.data?.length === 0 ? (
              <li className="py-2 text-xs text-muted-foreground">
                No reports generated yet. Choose a workspace and generate your first one.
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}
