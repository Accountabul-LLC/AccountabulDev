// Phase 3 of docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md ("Your Property Records"):
// adapted from Accountabul-LLC/property-intelligence-app's app/property-memory.tsx
// concept, rebuilt against this repo's own workspace flow (property-analysis.tsx)
// instead of that app's AI-chat-driven memory panel. Lets the signed-in user pick
// one of their open workspaces and upload/list their own supporting documents for
// it. Uploaded documents start `submitted` and are never shown as sourced facts —
// only a `verified` document (after admin/moderator review) is labeled distinctly
// as "Accountabul-verified owner record"; submitted/rejected ones are always
// visually flagged as unverified, never presented like Assessor data.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { listPropertyWorkspaces } from "@/lib/property-intelligence/property-workspace.functions";
import {
  createOwnerDocument,
  listOwnerDocuments,
} from "@/lib/property-intelligence/property-records-upload.functions";
import { OWNER_DOCUMENT_CATEGORIES } from "@/lib/property-intelligence/property-records-upload-validation";
import {
  removeOwnerDocumentFile,
  uploadOwnerDocumentFile,
  useOwnerDocumentUrl,
} from "@/lib/property-intelligence/property-owner-records-storage";

const CATEGORY_LABELS: Record<string, string> = {
  tax_receipt: "Tax receipt",
  repair_invoice: "Repair invoice",
  insurance: "Insurance",
  deed_or_title: "Deed / title",
  utility_bill: "Utility bill",
  inspection_report: "Inspection report",
  other: "Other",
};

const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? null
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

type OwnerDocument = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  occurred_at: string | null;
  amount: number | null;
  vendor_name: string | null;
  reference_number: string | null;
  storage_path: string;
  original_filename: string;
  status: "submitted" | "verified" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function StatusBadge({ status }: { status: OwnerDocument["status"] }) {
  if (status === "verified") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
        title="Reviewed and confirmed by an Accountabul admin/moderator — not an official Assessor record."
      >
        Accountabul-verified owner record
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      Submitted — not yet verified
    </span>
  );
}

function DocumentRow({ doc }: { doc: OwnerDocument }) {
  const url = useOwnerDocumentUrl(doc.storage_path);
  return (
    <li className="space-y-1 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{doc.title}</span>
        <StatusBadge status={doc.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {CATEGORY_LABELS[doc.category] ?? doc.category}
        {doc.occurred_at ? ` · ${doc.occurred_at}` : ""}
        {doc.amount !== null ? ` · ${money(doc.amount)}` : ""}
        {doc.vendor_name ? ` · ${doc.vendor_name}` : ""}
      </p>
      {doc.description ? <p className="text-sm">{doc.description}</p> : null}
      {doc.status !== "submitted" && doc.review_note ? (
        <p className="text-xs italic text-muted-foreground">Review note: {doc.review_note}</p>
      ) : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          {doc.original_filename}
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">{doc.original_filename}</span>
      )}
    </li>
  );
}

export default function PropertyOwnerDocuments() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const list = useServerFn(listPropertyWorkspaces);
  const listDocs = useServerFn(listOwnerDocuments);
  const create = useServerFn(createOwnerDocument);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(OWNER_DOCUMENT_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [amount, setAmount] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const workspaces = useQuery({
    queryKey: ["property-workspaces"],
    queryFn: () => list(),
  });

  const documents = useQuery({
    queryKey: ["property-owner-documents", threadId],
    queryFn: () => listDocs({ data: { threadId: threadId as string } }),
    enabled: Boolean(threadId),
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in first.");
      if (!threadId) throw new Error("Choose a property workspace first.");
      if (!file) throw new Error("Choose a file to upload.");
      if (!title.trim()) throw new Error("Give this record a title.");

      const uploaded = await uploadOwnerDocumentFile(userId, file);
      try {
        return await create({
          data: {
            threadId,
            category,
            title: title.trim(),
            description: description.trim() || null,
            occurredAt: occurredAt || null,
            amount: amount.trim() ? Number(amount) : null,
            vendorName: vendorName.trim() || null,
            referenceNumber: referenceNumber.trim() || null,
            storagePath: uploaded.storagePath,
            originalFilename: uploaded.originalFilename,
            contentType: uploaded.contentType,
            byteSize: uploaded.byteSize,
            fileHash: uploaded.fileHash,
          },
        });
      } catch (error) {
        await removeOwnerDocumentFile(uploaded.storagePath);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Record submitted for review.");
      setTitle("");
      setDescription("");
      setOccurredAt("");
      setAmount("");
      setVendorName("");
      setReferenceNumber("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["property-owner-documents", threadId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not submit that record."),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="surface-card space-y-4 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Your property records
          </p>
          <h1 className="mt-1 font-display text-xl font-semibold">Upload your own documentation</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Receipts, invoices, deeds, and other evidence you attach here are reviewed by an
            Accountabul admin/moderator before they count as verified. Until then they never appear
            as sourced facts anywhere else in Property Intelligence.
          </p>
        </div>

        <div>
          <Label htmlFor="owner-doc-workspace">Property workspace</Label>
          <select
            id="owner-doc-workspace"
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
              Open an address in "Address lookup" first, then come back here to attach records to
              it.
            </p>
          ) : null}
        </div>

        {threadId ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            <div>
              <Label htmlFor="owner-doc-category">Category</Label>
              <select
                id="owner-doc-category"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {OWNER_DOCUMENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="owner-doc-title">Title</Label>
              <Input
                id="owner-doc-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="owner-doc-description">Description</Label>
              <Textarea
                id="owner-doc-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="owner-doc-date">Date</Label>
                <Input
                  id="owner-doc-date"
                  type="date"
                  value={occurredAt}
                  onChange={(event) => setOccurredAt(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="owner-doc-amount">Amount</Label>
                <Input
                  id="owner-doc-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="owner-doc-vendor">Vendor</Label>
                <Input
                  id="owner-doc-vendor"
                  value={vendorName}
                  onChange={(event) => setVendorName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="owner-doc-reference">Reference #</Label>
                <Input
                  id="owner-doc-reference"
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="owner-doc-file">File (PDF, JPEG, PNG, or WebP)</Label>
              <input
                id="owner-doc-file"
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="mt-1 block w-full text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit for review"}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="surface-card p-5">
        <h2 className="font-display text-lg font-semibold">Submitted records</h2>
        {!threadId ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a property workspace to see and add your own records.
          </p>
        ) : documents.isLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {(documents.data ?? []).map((doc) => (
              <DocumentRow key={doc.id} doc={doc as OwnerDocument} />
            ))}
            {documents.data?.length === 0 ? (
              <li className="py-2 text-xs text-muted-foreground">
                No records submitted for this workspace yet.
              </li>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}
