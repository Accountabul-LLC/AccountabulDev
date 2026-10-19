import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ImageUploader } from "@/components/image-uploader";
import { PageShell } from "@/components/page-shell";
import { VerifyEmailNotice } from "@/components/auth/verify-email-notice";
import { BUSINESS_MEDIA_BUCKET } from "@/lib/media";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isValidHandle, normalizeHandle, slugify, takeSignupIntent } from "@/lib/account";
import { fetchMyBusinessProfile } from "@/lib/business/my-business";

export const Route = createFileRoute("/onboarding/business")({
  head: () => ({
    meta: [
      { title: "Business onboarding — Accountabul" },
      {
        name: "description",
        content:
          "Build your Accountabul vendor page: company details, reach and contact, then credentials for verification.",
      },
      { property: "og:title", content: "Business onboarding — Accountabul" },
      {
        property: "og:description",
        content:
          "Build your Accountabul vendor page: company details, reach and contact, then credentials for verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessOnboarding,
});

type Form = {
  legal_name: string;
  display_name: string;
  handle: string;
  headline: string;
  description: string;
  primary_industry: string;
  year_founded: string;
  employee_count_range: string;
  public_email: string;
  public_phone: string;
  website_url: string;
  address_city: string;
  address_state: string;
  address_country: string;
  service_areas: string;
};

const EMPTY: Form = {
  legal_name: "",
  display_name: "",
  handle: "",
  headline: "",
  description: "",
  primary_industry: "",
  year_founded: "",
  employee_count_range: "",
  public_email: "",
  public_phone: "",
  website_url: "",
  address_city: "",
  address_state: "",
  address_country: "",
  service_areas: "",
};

const STEPS = ["Company", "Reach & contact", "Brand & review"];

const TEAM_SIZES = ["1-10", "10-50", "50-100", "100-500", "500-1,000", "1,000-5,000", "5,000+"];

function BusinessOnboarding() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [handleTouched, setHandleTouched] = useState(false);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [createdBusinessId, setCreatedBusinessId] = useState<string | null>(null);

  const membership = useQuery({
    queryKey: ["my-business", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data: memberships, error: membershipError } =
        await supabase.rpc("get_my_memberships");
      if (membershipError) throw membershipError;
      const membership = memberships?.[0];
      if (!membership) return null;
      const business = await fetchMyBusinessProfile(supabase, membership.business_id);
      if (!business) return null;
      return { membership_role: membership.membership_role, businesses: business };
    },
  });

  const business = membership.data?.businesses ?? null;
  const businessId = business?.id ?? createdBusinessId;

  useEffect(() => {
    if (business) {
      setCreatedBusinessId(business.id);
      if (business.handle) setHandleTouched(true);
      setLogoPath(business.logo_path ?? null);
      setCoverPath(business.cover_path ?? null);

      setForm({
        legal_name: business.legal_name ?? "",
        display_name: business.display_name ?? "",
        handle: business.handle ?? "",
        headline: business.headline ?? "",
        description: business.description ?? "",
        primary_industry: business.primary_industry ?? "",
        year_founded: business.year_founded ? String(business.year_founded) : "",
        employee_count_range: business.employee_count_range ?? "",
        public_email: business.public_email ?? "",
        public_phone: business.public_phone ?? "",
        website_url: business.website_url ?? "",
        address_city: business.address_city ?? "",
        address_state: business.address_state ?? "",
        address_country: business.address_country ?? "",
        service_areas: (business.service_areas ?? []).join(", "),
      });
      return;
    }
    const intent = takeSignupIntent();
    const metadataName =
      typeof session?.user.user_metadata?.["business_name"] === "string"
        ? (session.user.user_metadata["business_name"] as string)
        : "";
    const name = intent?.businessName || metadataName;
    if (name) {
      setForm((prev) =>
        prev.legal_name
          ? prev
          : {
              ...prev,
              legal_name: name,
              display_name: name,
              handle: prev.handle || normalizeHandle(name),
            },
      );
    }
  }, [business, session]);

  function payload() {
    const handle = normalizeHandle(form.handle);
    if (form.handle.trim() && !isValidHandle(handle)) {
      throw new Error("Handles use lowercase letters, numbers, and dashes (2-40 characters).");
    }
    return {
      legal_name: form.legal_name.trim(),
      display_name: form.display_name.trim() || form.legal_name.trim(),
      handle: handle || null,
      headline: form.headline.trim() || null,
      description: form.description.trim() || null,
      primary_industry: form.primary_industry.trim() || null,
      year_founded: form.year_founded ? Number(form.year_founded) : null,
      employee_count_range: form.employee_count_range.trim() || null,
      public_email: form.public_email.trim() || null,
      public_phone: form.public_phone.trim() || null,
      website_url: form.website_url.trim() || null,
      address_city: form.address_city.trim() || null,
      address_state: form.address_state.trim() || null,
      address_country: form.address_country.trim() || null,
      service_areas: form.service_areas
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    };
  }

  const saveBusiness = useMutation({
    mutationFn: async () => {
      if (!form.legal_name.trim()) throw new Error("Legal name is required.");
      if (businessId) {
        const { error } = await supabase.from("businesses").update(payload()).eq("id", businessId);
        if (error) throw error;
        await supabase
          .from("profiles")
          .update({ onboarding_status: "business_started" })
          .eq("id", userId!);
        return businessId;
      }
      const base = slugify(form.display_name || form.legal_name);
      const slug = `${base || "business"}-${Math.random().toString(36).slice(2, 7)}`;
      const { data, error } = await supabase
        .from("businesses")
        .insert({ ...payload(), slug, created_by: userId! })
        .select("id")
        .single();
      if (error) {
        // The database permits one owner-created business per account. If a
        // retry or another tab won the creation race, resume that record.
        if (error.code === "23505") {
          const { data: existing, error: existingError } = await supabase
            .from("businesses")
            .select("id")
            .eq("created_by", userId!)
            .maybeSingle();
          if (existingError) throw existingError;
          if (existing) {
            const { error: updateError } = await supabase
              .from("businesses")
              .update(payload())
              .eq("id", existing.id);
            if (updateError) throw updateError;
            setCreatedBusinessId(existing.id);
            await supabase
              .from("profiles")
              .update({ onboarding_status: "business_started" })
              .eq("id", userId!);
            return existing.id;
          }
        }
        throw error;
      }
      setCreatedBusinessId(data.id);
      await supabase
        .from("profiles")
        .update({ onboarding_status: "business_started" })
        .eq("id", userId!);
      return data.id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-business"] });
    },
    onError: (e: Error & { code?: string }) =>
      toast.error(e.code === "23505" ? "That @handle is taken. Try another." : e.message),
  });

  const persistMedia = async (patch: { logo_path?: string | null; cover_path?: string | null }) => {
    if (!businessId) return;
    const { error } = await supabase.from("businesses").update(patch).eq("id", businessId);
    if (error) toast.error(error.message);
    else void queryClient.invalidateQueries({ queryKey: ["my-business"] });
  };

  const submitForReview = useMutation({
    mutationFn: async () => {
      const savedBusinessId = businessId ?? (await saveBusiness.mutateAsync());
      const { error: statusError } = await supabase
        .from("businesses")
        .update({ profile_status: "pending_review", verification_status: "pending" })
        .eq("id", savedBusinessId);
      if (statusError) throw statusError;
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-business"] });
      toast.success(
        "Your business profile has been submitted successfully and is awaiting approval. We'll notify you once it's approved.",
      );
      void navigate({ to: "/dashboard/business", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading)
    return <p className="container-page py-16 text-sm text-muted-foreground">Loading…</p>;

  if (!session) {
    return (
      <PageShell
        eyebrow="Business onboarding"
        title="Create your business account first"
        description="Sign up as a business to start building your vendor page."
      >
        <Link to="/signup/business" className="accountabul-nav-primary">
          Create business account
        </Link>
      </PageShell>
    );
  }

  async function next() {
    await saveBusiness.mutateAsync();
    toast.success("Progress saved.");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function saveProgress() {
    await saveBusiness.mutateAsync();
    toast.success("Progress saved. You can continue anytime.");
  }

  async function finishLater() {
    if (!form.legal_name.trim()) {
      void navigate({ to: "/dashboard/business" });
      return;
    }
    try {
      await saveBusiness.mutateAsync();
      toast.success("Progress saved. Resume anytime from your business page.");
      void navigate({ to: "/dashboard/business" });
    } catch {
      // Mutation already surfaces the error toast; stay on the form.
    }
  }

  return (
    <PageShell
      eyebrow={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
      title="Build your vendor page"
      description="These details become your public business profile once our team verifies you."
      contentWidth="wide"
    >
      <VerifyEmailNotice next="/onboarding/business" />

      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full border px-3 py-1 ${
              index <= step ? "border-accent text-accent" : "border-border text-muted-foreground"
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="surface-card w-full p-6 sm:p-8">
        {step === 0 ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Legal name"
                required
                value={form.legal_name}
                onChange={(v) => setForm({ ...form, legal_name: v })}
              />
              <Field
                label="Public display name"
                value={form.display_name}
                onChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    display_name: v,
                    handle: handleTouched ? prev.handle : normalizeHandle(v),
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="handle">Public handle</Label>
              <div className="flex items-center">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-sm text-muted-foreground">
                  @
                </span>
                <Input
                  id="handle"
                  className="rounded-l-none"
                  placeholder="acme-properties"
                  value={form.handle}
                  onChange={(e) => {
                    setHandleTouched(true);
                    setForm({ ...form, handle: normalizeHandle(e.target.value) });
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This is how people tag your business, e.g. @{form.handle || "acme-properties"}.
              </p>
            </div>
            <Field
              label="Tagline"
              value={form.headline}
              onChange={(v) => setForm({ ...form, headline: v })}
            />
            <div className="grid gap-2">
              <Label htmlFor="description">About your company</Label>
              <Textarea
                id="description"
                rows={5}
                placeholder="Describe the company, services, and what the marketplace should know."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Industry"
                value={form.primary_industry}
                onChange={(v) => setForm({ ...form, primary_industry: v })}
              />
              <Field
                label="Year founded"
                value={form.year_founded}
                onChange={(v) => setForm({ ...form, year_founded: v.replace(/\D/g, "") })}
              />
              <div className="grid gap-2">
                <Label htmlFor="team-size">Team size</Label>
                <Select
                  value={form.employee_count_range}
                  onValueChange={(v) => setForm({ ...form, employee_count_range: v })}
                >
                  <SelectTrigger id="team-size">
                    <SelectValue placeholder="Select team size" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_SIZES.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Public email"
                value={form.public_email}
                onChange={(v) => setForm({ ...form, public_email: v })}
              />
              <Field
                label="Public phone"
                value={form.public_phone}
                onChange={(v) => setForm({ ...form, public_phone: v })}
              />
              <Field
                label="Website"
                value={form.website_url}
                onChange={(v) => setForm({ ...form, website_url: v })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="City"
                value={form.address_city}
                onChange={(v) => setForm({ ...form, address_city: v })}
              />
              <Field
                label="State"
                value={form.address_state}
                onChange={(v) => setForm({ ...form, address_state: v })}
              />
              <Field
                label="Country"
                value={form.address_country}
                onChange={(v) => setForm({ ...form, address_country: v })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="areas">Service areas</Label>
              <Input
                id="areas"
                placeholder="City, state, region, or neighborhoods served (comma separated)"
                value={form.service_areas}
                onChange={(e) => setForm({ ...form, service_areas: e.target.value })}
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-6">
            <p className="text-sm text-muted-foreground">
              Add your brand images. These appear on your public business page at{" "}
              <span className="font-medium text-foreground">
                /businesses/{business?.slug ?? "your-company"}
              </span>
              .
            </p>
            <ImageUploader
              label="Company logo"
              hint="Square works best. JPG, PNG, or WebP up to 5 MB."
              bucket={BUSINESS_MEDIA_BUCKET}
              businessId={businessId ?? null}
              folder="logo"
              shape="square"
              value={logoPath}
              onChange={(path) => {
                setLogoPath(path);
                void persistMedia({ logo_path: path });
              }}
            />
            <ImageUploader
              label="Cover image"
              hint="A wide banner shown at the top of your public page."
              bucket={BUSINESS_MEDIA_BUCKET}
              businessId={businessId ?? null}
              folder="cover"
              value={coverPath}
              onChange={(path) => {
                setCoverPath(path);
                void persistMedia({ cover_path: path });
              }}
            />
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">
                {form.display_name || form.legal_name || "Your company"}
              </p>
              {form.handle ? <p className="text-xs text-accent">@{form.handle}</p> : null}
              {form.headline ? <p className="mt-1 text-muted-foreground">{form.headline}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Submitting sends your page to the Accountabul review team. You can keep editing from
                your dashboard.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => void next()} disabled={saveBusiness.isPending}>
              {saveBusiness.isPending ? "Saving…" : "Continue"}
            </Button>
          ) : (
            <Button onClick={() => submitForReview.mutate()} disabled={submitForReview.isPending}>
              {submitForReview.isPending ? "Submitting…" : "Submit for verification"}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void saveProgress()}
            disabled={saveBusiness.isPending}
          >
            {saveBusiness.isPending ? "Saving…" : "Save progress"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void finishLater()}
            disabled={saveBusiness.isPending}
          >
            Finish later
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
