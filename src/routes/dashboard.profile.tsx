import { LiveAlertSettings } from "@/components/live/live-alert-settings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfile, useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard/profile")({
  head: () => ({
    meta: [
      { title: "Personal account — Accountabul" },
      {
        name: "description",
        content: "Update the private person attached to your Accountabul login.",
      },
      { property: "og:title", content: "Personal account — Accountabul" },
      {
        property: "og:description",
        content: "Update the private person attached to your Accountabul login.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { session, loading } = useSession();
  const { data: profile, isLoading } = useProfile();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    display_name: "",
    phone: "",
    city: "",
    state: "",
    country: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name ?? "",
        last_name: profile.last_name ?? "",
        display_name: profile.display_name ?? "",
        phone: profile.phone ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        country: profile.country ?? "",
      });
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ ...form, onboarding_status: "profile_complete" })
        .eq("id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile saved.");
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) return <SignedOut />;

  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        Account holder
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Personal account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This private record identifies the person who signs in. It does not populate your public
        business page.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Company name, public contact information, location, and brand details belong in{" "}
        <Link
          to="/dashboard/business"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Business page settings
        </Link>
        .
      </p>

      <form
        className="surface-card mt-6 grid gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            value={form.first_name}
            onChange={(v) => setForm({ ...form, first_name: v })}
          />
          <Field
            label="Last name"
            value={form.last_name}
            onChange={(v) => setForm({ ...form, last_name: v })}
          />
        </div>
        <Field
          label="Display name"
          value={form.display_name}
          onChange={(v) => setForm({ ...form, display_name: v })}
        />
        <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
          <Field
            label="State"
            value={form.state}
            onChange={(v) => setForm({ ...form, state: v })}
          />
          <Field
            label="Country"
            value={form.country}
            onChange={(v) => setForm({ ...form, country: v })}
          />
        </div>
        <div>
          <Button type="submit" disabled={save.isPending || isLoading}>
            {save.isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>

      <LiveAlertSettings />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SignedOut() {
  return (
    <div className="surface-card max-w-md p-6">
      <h2 className="text-lg font-semibold">Sign in required</h2>
      <p className="mt-2 text-sm text-muted-foreground">This area is private to your account.</p>
      <Link
        to="/login"
        className="mt-4 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
      >
        Log in
      </Link>
    </div>
  );
}
