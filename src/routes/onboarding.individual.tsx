import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/page-shell";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfile, useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { isValidHandle, normalizeHandle, takeReturnTo, takeSignupIntent } from "@/lib/account";

export const Route = createFileRoute("/onboarding/individual")({
  head: () => ({
    meta: [
      { title: "Set up your profile — Accountabul" },
      {
        name: "description",
        content: "Finish setting up your Accountabul member profile and choose what to follow.",
      },
      { property: "og:title", content: "Set up your profile — Accountabul" },
      {
        property: "og:description",
        content: "Finish setting up your Accountabul member profile and choose what to follow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IndividualOnboarding,
});

const INTERESTS = [
  "Single family homes",
  "Multi-family",
  "Land",
  "Commercial",
  "Contractors",
  "Legal & title",
  "Insurance",
  "Property management",
];

function IndividualOnboarding() {
  const { session, loading } = useSession();
  const profile = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  useEffect(() => {
    takeSignupIntent();
  }, []);

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setDisplayName((v) => v || (p.display_name ?? ""));
    setHandle((v) => v || (p.handle ?? ""));
    if (p.handle) setHandleTouched(true);
    setCity((v) => v || (p.city ?? ""));
    setState((v) => v || (p.state ?? ""));
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      const normalized = normalizeHandle(handle);
      if (handle.trim() && !isValidHandle(normalized)) {
        throw new Error("Handles use lowercase letters, numbers, and dashes (2-40 characters).");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() || null,
          handle: normalized || null,
          city: city.trim() || null,
          state: state.trim() || null,
          onboarding_status: "profile_complete",
        })
        .eq("id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile saved. Welcome to Accountabul.");
      void navigate({ to: takeReturnTo() ?? "/dashboard", replace: true });
    },
    onError: (e: Error & { code?: string }) =>
      toast.error(e.code === "23505" ? "That @handle is taken. Try another." : e.message),
  });

  if (loading)
    return <p className="container-page py-16 text-sm text-muted-foreground">Loading…</p>;

  if (!session) {
    return (
      <PageShell
        eyebrow="Onboarding"
        title="Create your account first"
        description="Sign up to set up your member profile."
      >
        <Link to="/signup/individual" className="accountabul-nav-primary">
          Sign up
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell
      eyebrow={`Step ${step} of 2`}
      title="Set up your profile"
      description="Two quick steps. You can skip and finish this later from your dashboard."
      align="center"
    >
      <div className="w-full">
        <VerifyEmailNotice next="/onboarding/individual" />
      </div>
      <div className="surface-card w-full p-6">
        {step === 1 ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDisplayName(v);
                  if (!handleTouched) setHandle(normalizeHandle(v));
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="handle">Your handle</Label>
              <div className="flex items-center">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-sm text-muted-foreground">
                  @
                </span>
                <Input
                  id="handle"
                  className="rounded-l-none"
                  placeholder="your-name"
                  value={handle}
                  onChange={(e) => {
                    setHandleTouched(true);
                    setHandle(normalizeHandle(e.target.value));
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This is how people tag you, e.g. @{handle || "your-name"}.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button onClick={() => setStep(2)}>Continue</Button>
              <Button
                variant="ghost"
                onClick={() => navigate({ to: takeReturnTo() ?? "/dashboard" })}
              >
                Skip for now
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              What should we show you first? Pick anything that applies.
            </p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((item) => {
                const active = interests.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setInterests((prev) =>
                        prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item],
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border hover:border-accent/50"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Finish setup"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
