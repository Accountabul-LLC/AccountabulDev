import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { UUID_V1_TO_V8 as UUID } from "@/lib/validation/patterns";

export const Route = createFileRoute("/speakers/join")({
  head: () => ({
    meta: [
      { title: "Join as speaker — Accountabul" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { request?: string } => ({
    ...(typeof search["request"] === "string" ? { request: search["request"] as string } : {}),
  }),
  component: SpeakerJoinPage,
});

function SpeakerJoinPage() {
  const { request: requestId } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, "");
    if (!requestId || !UUID.test(requestId) || !token) {
      setError("This speaker link is missing or incomplete.");
      return;
    }

    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/public/speakers/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: requestId, token }),
      });
      const payload = (await response.json().catch(() => null)) as {
        destination?: string;
        error?: string;
      } | null;
      if (cancelled) return;
      if (!response.ok || typeof payload?.destination !== "string") {
        setError(payload?.error ?? "Speaker link is invalid or expired.");
        return;
      }
      window.location.replace(payload.destination);
    })();

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  return (
    <PageShell
      align="center"
      eyebrow="Conference"
      title={error ? "Unable to join" : "Joining the speaker room"}
      description={
        error ?? "Open this page from your speaker invite. We will send you to the guest room."
      }
    />
  );
}
