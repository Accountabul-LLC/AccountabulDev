import { useNavigate } from "@tanstack/react-router";
import { Building2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthCard } from "@/components/auth/auth-card";
import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { onboardingPathFor, rememberSignupIntent, type AccountType } from "@/lib/account";

export function SignupForm({
  variant,
  title,
  subtitle,
  footer,
}: {
  variant: AccountType;
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { session } = useSession();
  const isBusiness = variant === "business";
  const next = onboardingPathFor(variant);

  const [businessName, setBusinessName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) void navigate({ to: next, replace: true });
  }, [session, navigate, next]);

  function storeIntent() {
    rememberSignupIntent({
      accountType: variant,
      ...(isBusiness && businessName.trim() ? { businessName: businessName.trim() } : {}),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isBusiness && !businessName.trim()) {
      toast.error("Add your business name to continue.");
      return;
    }
    setBusy(true);
    storeIntent();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        data: {
          first_name: firstName,
          last_name: lastName,
          display_name: [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0],
          account_type: variant,
          ...(isBusiness ? { business_name: businessName.trim() } : {}),
        },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Account created. Check your email for the verification link.");
    void navigate({ to: next });
  }

  async function handleGoogle() {
    setBusy(true);
    storeIntent();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      toast.error("Google sign-up failed. Try again.");
      return;
    }
  }

  return (
    <AuthCard
      icon={isBusiness ? Building2 : User}
      title={title}
      subtitle={subtitle}
      {...(footer ? { footer } : {})}
    >
      <form onSubmit={handleSubmit} className="grid gap-4">
        {isBusiness ? (
          <div className="grid gap-2">
            <Label htmlFor="business">Business name</Label>
            <Input
              id="business"
              required
              placeholder="Acme Properties LLC"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="first">First name</Label>
            <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="last">Last name</Label>
            <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" size="lg" disabled={busy}>
          {busy
            ? "Creating account…"
            : isBusiness
              ? "Create business account"
              : "Create my account"}
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
    </AuthCard>
  );
}
