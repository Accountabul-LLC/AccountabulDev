import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { fetchMyBusinessProfile } from "@/lib/business/my-business";
import { submitBusinessVerification } from "@/lib/business/verification.functions";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ImageUploader } from "@/components/image-uploader";
import { Button } from "@/components/ui/button";
import { BUSINESS_MEDIA_BUCKET } from "@/lib/media";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { isValidHandle, normalizeHandle } from "@/lib/account";
import { canManageBusinessWorkspace } from "@/lib/business-capabilities";
import { isBusinessApproved } from "@/lib/business-review";
import { SignedOut } from "./dashboard.profile";

export const Route = createFileRoute("/dashboard/business")({
  head: () => ({
    meta: [
      { title: "Your business — Accountabul dashboard" },
      {
        name: "description",
        content: "Create, edit, and submit your Accountabul business profile for verification.",
      },
      { property: "og:title", content: "Your business — Accountabul dashboard" },
      {
        property: "og:description",
        content: "Create, edit, and submit your Accountabul business profile for verification.",
      },
    ],
  }),
  component: BusinessPage,
});

const TEAM_SIZES = ["1-10", "10-50", "50-100", "100-500", "500-1,000", "1,000-5,000", "5,000+"];

function BusinessPage() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

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
  const canManage = canManageBusinessWorkspace(membership.data?.membership_role);

  const [form, setForm] = useState({
    legal_name: "",
    display_name: "",
    handle: "",
    headline: "",
    description: "",
    website_url: "",
    public_email: "",
    public_phone: "",
    primary_industry: "",
    year_founded: "",
    employee_count_range: "",
    address_city: "",
    address_state: "",
    address_country: "",
    service_areas: "",
  });

  useEffect(() => {
    if (business) {
      setForm({
        legal_name: business.legal_name ?? "",
        display_name: business.display_name ?? "",
        handle: business.handle ?? "",
        headline: business.headline ?? "",
        description: business.description ?? "",
        website_url: business.website_url ?? "",
        public_email: business.public_email ?? "",
        public_phone: business.public_phone ?? "",
        primary_industry: business.primary_industry ?? "",
        year_founded: business.year_founded ? String(business.year_founded) : "",
        employee_count_range: business.employee_count_range ?? "",
        address_city: business.address_city ?? "",
        address_state: business.address_state ?? "",
        address_country: business.address_country ?? "",
        service_areas: (business.service_areas ?? []).join(", "),
      });
      return;
    }

    // Prefill from the business name captured during signup, if any.
    let pending = "";
    try {
      pending = window.sessionStorage.getItem("accountabul:business_name") ?? "";
      if (pending) window.sessionStorage.removeItem("accountabul:business_name");
    } catch {
      pending = "";
    }
    if (pending) {
      setForm((prev) =>
        prev.legal_name || prev.display_name
          ? prev
          : { ...prev, legal_name: pending, display_name: pending },
      );
    }
  }, [business]);

  const update = useMutation({
    mutationFn: async (patch: TablesUpdate<"businesses">) => {
      if (!canManage) throw new Error("Only business owners and managers can edit this page.");
      const { error } = await supabase.from("businesses").update(patch).eq("id", business!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Business updated.");
      void queryClient.invalidateQueries({ queryKey: ["my-business"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) return <SignedOut />;

  if (membership.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your business…</p>;
  }

  if (membership.isError) {
    return (
      <div className="surface-card max-w-xl p-6">
        <h1 className="text-2xl font-bold">We couldn’t load your business</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Refresh the page to try again. Your existing business information has not been changed.
        </p>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="surface-card w-full p-6 sm:p-8">
        <h1 className="text-2xl font-bold">Create your business</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use guided onboarding to build your public vendor page and submit it for verification.
          Progress is saved when you continue, save, or finish later.
        </p>
        <Button asChild className="mt-4">
          <Link to="/onboarding/business">Start business onboarding</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        Public identity
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Business page settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This is the authoritative company record used by onboarding, your workspace, the directory,
        and your public website.
      </p>

      {business ? (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border px-3 py-1.5 font-semibold uppercase tracking-wide">
            Status: {business.profile_status.replaceAll("_", " ")}
          </span>
          <span className="rounded-full border border-border px-3 py-1.5 font-semibold uppercase tracking-wide">
            Verification: {business.verification_status.replaceAll("_", " ")}
          </span>
        </div>
      ) : null}

      {business ? (
        <PublicPageLink slug={business.slug} isPublished={isBusinessApproved(business)} />
      ) : null}

      {business ? (
        <section className="surface-card mt-6 grid gap-6 p-6 sm:grid-cols-2">
          <ImageUploader
            label="Company logo"
            hint="Shown on your public page and in the directory."
            bucket={BUSINESS_MEDIA_BUCKET}
            businessId={business.id}
            folder="logo"
            shape="square"
            value={business.logo_path ?? null}
            onChange={(path) => update.mutateAsync({ logo_path: path })}
            disabled={!canManage}
          />
          <ImageUploader
            label="Cover image"
            hint="Wide banner at the top of your public page."
            bucket={BUSINESS_MEDIA_BUCKET}
            businessId={business.id}
            folder="cover"
            value={business.cover_path ?? null}
            onChange={(path) => update.mutateAsync({ cover_path: path })}
            disabled={!canManage}
          />
        </section>
      ) : null}

      <form
        className="surface-card mt-6 grid gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            update.mutate(businessPayload(form));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Business details are invalid.");
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Legal name"
            required
            value={form.legal_name}
            onChange={(v) => setForm({ ...form, legal_name: v })}
          />
          <Field
            label="Display name"
            required
            value={form.display_name}
            onChange={(v) => setForm({ ...form, display_name: v })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="business-handle">Public handle</Label>
          <div className="flex items-center">
            <span className="flex h-9 items-center rounded-l-md border border-r-0 border-input bg-secondary px-3 text-sm text-muted-foreground">
              @
            </span>
            <Input
              id="business-handle"
              className="rounded-l-none"
              value={form.handle}
              onChange={(event) =>
                setForm({ ...form, handle: normalizeHandle(event.target.value) })
              }
            />
          </div>
        </div>
        <Field
          label="Headline"
          value={form.headline}
          onChange={(v) => setForm({ ...form, headline: v })}
        />
        <div className="grid gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Website"
            value={form.website_url}
            onChange={(v) => setForm({ ...form, website_url: v })}
          />
          <Field
            label="Public email"
            type="email"
            autoComplete="email"
            value={form.public_email}
            onChange={(v) => setForm({ ...form, public_email: v })}
          />
          <Field
            label="Public phone"
            type="tel"
            autoComplete="tel"
            value={form.public_phone}
            onChange={(v) => setForm({ ...form, public_phone: v })}
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
              onValueChange={(value) => {
                if (value) setForm({ ...form, employee_count_range: value });
              }}
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
        <Field
          label="Service areas"
          value={form.service_areas}
          onChange={(v) => setForm({ ...form, service_areas: v })}
        />
        <p className="-mt-2 text-xs text-muted-foreground">
          Separate cities, neighborhoods, or regions with commas.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={update.isPending || !canManage}>
            Save business
          </Button>
          {business && ["draft", "rejected"].includes(business.profile_status) ? (
            <>
              <Button type="button" variant="secondary" asChild>
                <Link to="/onboarding/business">Continue onboarding</Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canManage}
                onClick={() =>
                  update.mutate({
                    profile_status: "pending_review",
                    verification_status: "pending",
                  })
                }
              >
                Submit for review
              </Button>
            </>
          ) : null}
        </div>
        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Your business role has read-only access to this page.
          </p>
        ) : null}
      </form>

      {business && canManage ? (
        <VendorVerificationPanel
          businessId={business.id}
          verificationStatus={business.verification_status}
        />
      ) : null}
    </div>
  );
}

function VendorVerificationPanel({
  businessId,
  verificationStatus,
}: {
  businessId: string;
  verificationStatus: string;
}) {
  const queryClient = useQueryClient();
  const submit = useServerFn(submitBusinessVerification);
  const [form, setForm] = useState({
    legalName: "",
    entityType: "llc",
    formationState: "",
    taxId: "",
    representativeName: "",
    representativeEmail: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          businessId,
          legalName: form.legalName,
          entityType: form.entityType as "llc",
          formationState: form.formationState,
          taxId: form.taxId,
          representativeName: form.representativeName,
          representativeEmail: form.representativeEmail,
        },
      }),
    onSuccess: (result) => {
      toast.success(result.message);
      setForm({ ...form, taxId: "" });
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (verificationStatus === "verified") {
    return (
      <section className="surface-card mt-8 p-6">
        <h2 className="text-lg font-semibold">Verified Vendor</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your entity is verified. The Verified Vendor Network partner program is separate and
          invitation-only — Accountabul staff reach out when your account qualifies.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-card mt-8 p-6">
      <h2 className="text-lg font-semibold">Become a Verified Vendor</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Verification needs an active business membership plus a successful entity check. We never
        store your full EIN — only the last four digits and the check result.
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="v-legal">Legal entity name</Label>
          <Input
            id="v-legal"
            value={form.legalName}
            onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="v-entity">Entity type</Label>
          <Select
            value={form.entityType}
            onValueChange={(value) => setForm({ ...form, entityType: value })}
          >
            <SelectTrigger id="v-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="llc">LLC</SelectItem>
              <SelectItem value="c_corp">C corporation</SelectItem>
              <SelectItem value="s_corp">S corporation</SelectItem>
              <SelectItem value="partnership">Partnership</SelectItem>
              <SelectItem value="sole_proprietor">Sole proprietor</SelectItem>
              <SelectItem value="nonprofit">Nonprofit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="v-state">State or region of formation</Label>
          <Input
            id="v-state"
            value={form.formationState}
            onChange={(e) => setForm({ ...form, formationState: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="v-ein">EIN</Label>
          <Input
            id="v-ein"
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-3456789"
            value={form.taxId}
            onChange={(e) => setForm({ ...form, taxId: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="v-rep">Authorized representative</Label>
          <Input
            id="v-rep"
            value={form.representativeName}
            onChange={(e) => setForm({ ...form, representativeName: e.target.value })}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="v-rep-email">Representative email</Label>
          <Input
            id="v-rep-email"
            type="email"
            value={form.representativeEmail}
            onChange={(e) => setForm({ ...form, representativeEmail: e.target.value })}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting…" : "Submit for verification"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function businessPayload(form: {
  legal_name: string;
  display_name: string;
  handle: string;
  headline: string;
  description: string;
  website_url: string;
  public_email: string;
  public_phone: string;
  primary_industry: string;
  year_founded: string;
  employee_count_range: string;
  address_city: string;
  address_state: string;
  address_country: string;
  service_areas: string;
}) {
  const legalName = form.legal_name.trim();
  const displayName = form.display_name.trim();
  if (!legalName || !displayName) {
    throw new Error("Legal name and display name are required.");
  }
  const handle = normalizeHandle(form.handle);
  if (form.handle.trim() && !isValidHandle(handle)) {
    throw new Error("Handles use lowercase letters, numbers, and dashes (2-40 characters).");
  }
  const foundedYear = form.year_founded ? Number(form.year_founded) : null;
  if (
    foundedYear !== null &&
    (!Number.isInteger(foundedYear) || foundedYear < 1800 || foundedYear > new Date().getFullYear())
  ) {
    throw new Error(`Year founded must be between 1800 and ${new Date().getFullYear()}.`);
  }
  return {
    legal_name: legalName,
    display_name: displayName,
    handle: handle || null,
    headline: form.headline.trim() || null,
    description: form.description.trim() || null,
    website_url: form.website_url.trim() || null,
    public_email: form.public_email.trim() || null,
    public_phone: form.public_phone.trim() || null,
    primary_industry: form.primary_industry.trim() || null,
    year_founded: foundedYear,
    employee_count_range: form.employee_count_range || null,
    address_city: form.address_city.trim() || null,
    address_state: form.address_state.trim() || null,
    address_country: form.address_country.trim() || null,
    service_areas: form.service_areas
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function PublicPageLink({ slug, isPublished }: { slug: string; isPublished: boolean }) {
  const url =
    typeof window === "undefined"
      ? `/businesses/${slug}`
      : `${window.location.origin}/businesses/${slug}`;
  return (
    <div className="surface-card mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {isPublished ? "Your public page" : "Reserved public address"}
        </p>
        {isPublished ? (
          <Link
            to="/businesses/$slug"
            params={{ slug }}
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            /businesses/{slug}
          </Link>
        ) : (
          <p className="text-sm font-medium">/businesses/{slug}</p>
        )}
        {!isPublished ? (
          <p className="mt-1 text-xs text-muted-foreground">
            This address becomes public only after approval.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          toast.success("Public page link copied.");
        }}
      >
        Copy link
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
