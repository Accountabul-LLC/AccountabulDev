import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CheckCircle2, MailWarning } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { onboardingPathFor, peekSignupIntent } from "@/lib/account";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Confirming your email — Accountabul" },
      {
        name: "description",
        content: "Finish confirming your Accountabul email address and continue to setup.",
      },
      { property: "og:title", content: "Confirming your email — Accountabul" },
      {
        property: "og:description",
        content: "Finish confirming your Accountabul email address and continue to setup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    ...(typeof search["next"] === "string" ? { next: search["next"] as string } : {}),
  }),
  component: AuthCallbackPage,
});

function safePath(value: string | undefined, fallback: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function AuthCallbackPage() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth/callback" });
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");

  const intent = typeof window !== "undefined" ? peekSignupIntent() : null;
  const fallback = intent ? onboardingPathFor(intent.accountType) : "/dashboard";
  const next = safePath(search.next, fallback);

  useEffect(() => {
    if (session?.user.email) setEmail(session.user.email);
  }, [session]);

  async function resend() {
    if (!email) {
      toast.error("Enter the email you signed up with.");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setResending(false);
    if (error) toast.error(error.message);
    else toast.success("A new verification link is on the way.");
  }

  if (loading) {
    return (
      <PageShell
        eyebrow="Email confirmation"
        title="Confirming your email…"
        description="Give us a second while we finish verifying your link."
        align="center"
      >
        <div className="surface-card w-full p-6 text-sm text-muted-foreground">
          Checking your verification link…
        </div>
      </PageShell>
    );
  }

  if (session) {
    return (
      <PageShell
        eyebrow="Email confirmation"
        title="Your email is verified"
        description="You're all set. Continue to finish setting up your account."
        align="center"
      >
        <div className="surface-card grid w-full gap-4 p-6">
          <p className="flex items-start gap-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              Your email has been verified successfully
              {session.user.email ? ` (${session.user.email})` : ""}. You can now continue.
            </span>
          </p>
          <Button size="lg" onClick={() => void navigate({ to: next, replace: true })}>
            Continue to setup
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Email confirmation"
      title="This link is no longer valid"
      description="Verification links expire after a short time, and each one can only be used once."
      align="center"
    >
      <div className="surface-card grid w-full gap-4 p-6">
        <p className="flex items-start gap-3 text-sm text-muted-foreground">
          <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            We could not confirm your email from this link. Request a fresh one below, or log in if
            you already confirmed.
          </span>
        </p>
        <div className="grid gap-2">
          <label htmlFor="resend-email" className="text-sm font-medium">
            Your email
          </label>
          <input
            id="resend-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            placeholder="you@example.com"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={resend} disabled={resending}>
            {resending ? "Sending…" : "Resend verification email"}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/login">Go to login</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
