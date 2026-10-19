// Sandbox API key management, the UI half of property-api-keys.functions.ts.
//
// Those server functions predate this session and were complete and tested,
// but no component consumed them, so the whole key surface was unreachable
// from the application. This is that missing half.
//
// The one behaviour that shapes the whole component: a newly minted key's
// raw secret is returned EXACTLY once and is never stored, so it can never
// be shown again. That makes this different from an ordinary list view --
// the secret has to be surfaced prominently at the moment of creation and
// then deliberately discarded from component state, because a stale copy
// sitting in memory is a secret in a place nobody expects one.
//
// The quota (3 active keys) and the approved-access-request precondition are
// enforced by the server module and repeated by a database trigger. Neither
// is re-decided here; the component just shows what the server refused.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PropertyApiKeyMetadata } from "@/lib/property-intelligence/property-api-keys.server";
import {
  createSandboxApiKey,
  listSandboxApiKeys,
  revokeSandboxApiKey,
} from "@/lib/property-intelligence/property-api-keys.functions";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function ApiKeys() {
  const queryClient = useQueryClient();
  const list = useServerFn(listSandboxApiKeys);
  const create = useServerFn(createSandboxApiKey);
  const revoke = useServerFn(revokeSandboxApiKey);

  const [label, setLabel] = useState("");
  // Held only until the user dismisses it. Never persisted, never refetched:
  // the server does not keep it either.
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const { data: keys = [], isPending } = useQuery<PropertyApiKeyMetadata[]>({
    queryKey: ["property-api-keys"],
    queryFn: () => list(),
  });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { label: label.trim() } }),
    onSuccess: async (result: { rawKey: string }) => {
      setFreshSecret(result.rawKey);
      setLabel("");
      await queryClient.invalidateQueries({ queryKey: ["property-api-keys"] });
      toast.success("Sandbox key created. Copy it now — it is shown once.");
    },
    onError: (error: unknown) => {
      // Surfaced verbatim: the server's refusals are the useful part here
      // (no approved access request, or the 3-key quota).
      toast.error(error instanceof Error ? error.message : "That key could not be created.");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revoke({ data: { keyId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["property-api-keys"] });
      toast.success("Key revoked.");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "That key could not be revoked.");
    },
  });

  const activeKeys = keys.filter((key) => key.status === "active");

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Sandbox API keys</h3>
        <p className="text-sm text-muted-foreground">
          Keys for the Property Intelligence sandbox API. An approved API access request is
          required, and each account may hold up to three active keys.
        </p>
      </div>

      {freshSecret ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-4 dark:bg-amber-950/30">
          <p className="text-sm font-semibold">Copy this key now — it will not be shown again.</p>
          <code className="mt-2 block break-all rounded bg-background p-2 font-mono text-xs">
            {freshSecret}
          </code>
          <Button
            className="mt-3"
            type="button"
            variant="outline"
            onClick={() => setFreshSecret(null)}
          >
            I have copied it
          </Button>
        </div>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="api-key-label">Key label</Label>
          <Input
            id="api-key-label"
            value={label}
            maxLength={60}
            placeholder="e.g. local development"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={createMutation.isPending || !label.trim()}>
          {createMutation.isPending ? "Creating…" : "Create sandbox key"}
        </Button>
        <span className="text-xs text-muted-foreground">{activeKeys.length} of 3 active</span>
      </form>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading keys…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sandbox keys yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{key.label}</p>
                <p className="text-xs text-muted-foreground">
                  <code className="font-mono">{key.keyPrefix}…</code> · created{" "}
                  {formatDate(key.createdAt)} · last used {formatDate(key.lastUsedAt)}
                </p>
              </div>
              <span
                className={
                  key.status === "active"
                    ? "text-xs font-medium text-emerald-600"
                    : "text-xs font-medium text-muted-foreground"
                }
              >
                {key.status === "active" ? "Active" : `Revoked ${formatDate(key.revokedAt)}`}
              </span>
              {key.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(key.id)}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ApiKeys;
