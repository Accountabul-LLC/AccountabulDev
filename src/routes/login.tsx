import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { GoogleIcon } from "@/components/google-icon";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Accountabul" },
      { name: "description", content: "Sign in to Accountabul or recover access to your account." },
      { property: "og:title", content: "Log in — Accountabul" },
      {
        property: "og:description",
        content: "Sign in to Accountabul or recover access to your account.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string; mode?: "recovery" } => ({
    ...(typeof search["redirect"] === "string" ? { redirect: search["redirect"] as string } : {}),
    ...(search["mode"] === "recovery" ? { mode: "recovery" as const } : {}),
  }),

  component: LoginPage,
});

function safePath(value: string | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function LoginPage() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  const search = useSearch({ from: "/login" });
  const next = safePath(search.redirect);
  const isRecovery = search.mode === "recovery";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session && !isRecovery) void navigate({ to: next, replace: true });
  }, [session, isRecovery, navigate, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Welcome back.");
    void navigate({ to: next, replace: true });
  }

  async function handleGoogle() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      toast.error("Google sign-in failed. Try again.");
    }
  }

  async function handleRecovery() {
    if (!email) {
      toast.error("Enter your email first, then request a reset link.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login?mode=recovery`,
    });
    if (error) toast.error(error.message);
    else toast.success("If that account exists, a reset link is on the way.");
  }

  async function handlePasswordUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Use at least 8 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) await supabase.auth.signOut();
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated. Log in with your new password.");
    void navigate({ to: "/login", search: {}, replace: true });
  }

  if (isRecovery) {
    return (
      <PageShell
        eyebrow="Account recovery"
        title="Choose a new password"
        description="Finish recovering your account with a new password."
        align="center"
      >
        <div className="surface-card w-full p-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
          ) : session ? (
            <form onSubmit={handlePasswordUpdate} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Updating password…" : "Update password"}
              </Button>
            </form>
          ) : (
            <div className="grid gap-4 text-sm">
              <p className="text-muted-foreground">
                This reset link is invalid or expired. Request a new link from the login page.
              </p>
              <Button asChild>
                <Link to="/login">Return to login</Link>
              </Button>
            </div>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow="Account"
      title="Log in"
      description="Authentication and account recovery backed by platform identity only."
      align="center"
    >
      <div className="surface-card w-full p-6">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full gap-2" onClick={handleGoogle} disabled={busy}>
          <GoogleIcon />
          Continue with Google
        </Button>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            onClick={handleRecovery}
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
          <Link to="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
