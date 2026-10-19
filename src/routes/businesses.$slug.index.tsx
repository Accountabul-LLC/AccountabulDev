import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { BadgeCheck, Globe2, Mail, MapPin, MessageCircle, Phone, Share2 } from "lucide-react";
import { toast } from "sonner";

import { ServiceGrid } from "@/components/business/service-grid";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import {
  businessLocation,
  externalHref,
  useBusinessServices,
  type Business,
} from "@/lib/business-site";
import { BUSINESS_MEDIA_BUCKET, useMediaUrl } from "@/lib/media";

export const Route = createFileRoute("/businesses/$slug/")({
  component: BusinessHomePage,
});

function BusinessHomePage() {
  const business = useLoaderData({ from: "/businesses/$slug" }) as Business | null;
  if (!business) return null;
  const location = businessLocation(business);

  return (
    <>
      <BusinessHero business={business} />
      <ContactStrip business={business} location={location} />
      <HomeServices business={business} />
    </>
  );
}

function BusinessHero({ business }: { business: Business }) {
  const cover = useMediaUrl(BUSINESS_MEDIA_BUCKET, business.cover_path);
  const logo = useMediaUrl(BUSINESS_MEDIA_BUCKET, business.logo_path);
  const [coverFit, setCoverFit] = useState<"cover" | "contain">("cover");

  return (
    <section className="bg-background">
      {/*
        Cover band — a wide, visible banner.
        4:1 desktop aspect keeps the cover from cropping/zooming too aggressively
        while still reading as a banner. object-cover + object-center is used by
        default, but if the uploaded image is much taller than a banner we fall
        back to object-contain so the full image is preserved instead of being
        enlarged and cropped.
      */}
      <div className="relative aspect-[3/1] w-full overflow-hidden bg-muted sm:aspect-[4/1] max-h-96">
        {cover ? (
          <img
            src={cover}
            alt={`${business.display_name} cover`}
            className={`h-full w-full object-center ${
              coverFit === "cover" ? "object-cover" : "object-contain"
            }`}
            onLoad={(event) => {
              const img = event.currentTarget;
              const parent = img.parentElement;
              if (!parent) return;
              const imageRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
              const containerRatio = parent.clientWidth / Math.max(1, parent.clientHeight);
              // Only letterbox when cover would crop away more than ~30% of the
              // image height. Mild crops are fine for a banner; shrinking the
              // whole image to fit (contain) makes the banner look broken.
              if (imageRatio < containerRatio * 0.7) setCoverFit("contain");
            }}
          />
        ) : (
          <div aria-hidden className="h-full w-full bg-gradient-to-br from-secondary to-muted" />
        )}
      </div>

      {/* Identity layer — compact bar directly below the cover. */}
      <div className="border-b border-border">
        <div className="container-page">
          <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:gap-6 lg:gap-8">
            {/* Logo overlaps the bottom edge of the cover (≈50% overlap). */}
            <div className="relative z-10 -mt-12 grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card text-3xl font-bold shadow-xl sm:-mt-16 sm:size-32 lg:-mt-20 lg:size-40">
              {logo ? (
                <img
                  src={logo}
                  alt={`${business.display_name} logo`}
                  className="h-full w-full object-contain p-1.5"
                />
              ) : (
                business.display_name.charAt(0)
              )}
            </div>

            <div className="min-w-0 max-w-3xl flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                {business.verification_status === "verified" ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                    <BadgeCheck aria-hidden size={16} /> Verified Business
                  </span>
                ) : null}
                {business.handle ? (
                  <span className="text-sm text-muted-foreground">@{business.handle}</span>
                ) : null}
              </div>
              <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
                {business.display_name}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {business.headline ?? "A published business in the Accountabul network."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild className="gap-2">
                  <a href="#contact">
                    <MessageCircle aria-hidden size={16} /> Contact business
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    void navigator.clipboard.writeText(window.location.href);
                    toast.success("Business page link copied.");
                  }}
                >
                  <Share2 aria-hidden size={16} /> Share
                </Button>
                <FollowButton businessId={business.id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactStrip({ business, location }: { business: Business; location: string }) {
  const items = [
    business.service_areas?.length || location
      ? {
          icon: MapPin,
          label: "Service area",
          value: business.service_areas?.length ? business.service_areas.join(", ") : location,
        }
      : null,
    location ? { icon: MapPin, label: "Location", value: location } : null,
    business.public_email
      ? {
          icon: Mail,
          label: "Email",
          value: business.public_email,
          href: `mailto:${business.public_email}`,
        }
      : null,
    business.public_phone
      ? {
          icon: Phone,
          label: "Phone",
          value: business.public_phone,
          href: `tel:${business.public_phone.replace(/[^+\d]/g, "")}`,
        }
      : null,
    business.website_url
      ? {
          icon: Globe2,
          label: "Website",
          value: business.website_url.replace(/^https?:\/\//, ""),
          href: externalHref(business.website_url),
          external: true,
        }
      : null,
  ].filter(Boolean) as {
    icon: typeof MapPin;
    label: string;
    value: string;
    href?: string;
    external?: boolean;
  }[];

  if (!items.length) return null;

  return (
    <section id="contact" className="scroll-mt-40 border-b border-border bg-card/40">
      <dl className="container-page grid gap-6 py-6 sm:grid-cols-2 lg:flex lg:items-start lg:gap-0 lg:divide-x lg:divide-border">
        {items.map(({ icon: Icon, label, value, href, external }, index) => (
          <div
            key={label}
            className={`flex min-w-0 flex-1 items-start gap-3 ${index > 0 ? "lg:pl-8" : ""}`}
          >
            <Icon aria-hidden size={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                {href ? (
                  <a
                    href={href}
                    className="hover:text-accent hover:underline"
                    target={external ? "_blank" : undefined}
                    rel={external ? "noreferrer" : undefined}
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HomeServices({ business }: { business: Business }) {
  const services = useBusinessServices(business.id);
  const visible = (services.data ?? []).slice(0, 8);

  return (
    <section className="container-page py-10 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Our services</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What {business.display_name} offers to clients.
          </p>
        </div>
        {(services.data?.length ?? 0) > visible.length ? (
          <Link
            to="/businesses/$slug/services"
            params={{ slug: business.slug }}
            className="text-sm font-medium text-accent hover:underline"
          >
            View all services →
          </Link>
        ) : null}
      </div>

      <div className="mt-6">
        {services.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading services…</p>
        ) : services.isError ? (
          <div>
            <p className="font-medium">Services could not be loaded</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => services.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : visible.length ? (
          <ServiceGrid businessSlug={business.slug} services={visible} />
        ) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="font-medium">No services listed yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This business has not published its offerings yet.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function FollowButton({ businessId }: { businessId: string }) {
  const { session } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const follow = useQuery({
    queryKey: ["business-follow", businessId, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_follows")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const toggle = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in to follow businesses.");
      if (follow.data) {
        const { error } = await supabase.from("business_follows").delete().eq("id", follow.data.id);
        if (error) throw error;
        return false;
      }
      const { error } = await supabase
        .from("business_follows")
        .insert({ business_id: businessId, user_id: userId });
      if (error) throw error;
      return true;
    },
    onSuccess: (following) => {
      void queryClient.invalidateQueries({ queryKey: ["business-follow", businessId] });
      toast.success(following ? "Following this business." : "Unfollowed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!session) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
    >
      {follow.data ? "Following" : "Follow"}
    </Button>
  );
}
