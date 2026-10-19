import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { BusinessHeader } from "@/components/business-header";
import { PageShell } from "@/components/page-shell";
import { getPublicBusiness } from "@/lib/business.functions";
import {
  businessLocation,
  useBusinessPolicies,
  useBusinessProperties,
  type Business,
} from "@/lib/business-site";
import { serializeJsonLd } from "@/lib/json-ld";
import { BUSINESS_MEDIA_BUCKET, useMediaUrl } from "@/lib/media";

export const Route = createFileRoute("/businesses/$slug")({
  loader: ({ params }) => getPublicBusiness({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    const name = loaderData?.display_name ?? "Business profile";
    const title = `${name} — Accountabul`;
    const description =
      loaderData?.headline ??
      loaderData?.description?.slice(0, 155) ??
      "Business profile with services, listings, and contact details on Accountabul.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: () => <BusinessUnavailable />,
  notFoundComponent: () => <BusinessUnavailable />,
  component: BusinessSiteLayout,
});

export function BusinessUnavailable() {
  return (
    <PageShell
      eyebrow="Directory"
      title="Business not available"
      description="This business profile is not published, or the link is no longer valid."
    >
      <Link
        to="/businesses"
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        Back to the directory
      </Link>
    </PageShell>
  );
}

function BusinessSiteLayout() {
  const business = Route.useLoaderData();
  if (!business) return <BusinessUnavailable />;
  return <BusinessChrome business={business} />;
}

function BusinessChrome({ business }: { business: Business }) {
  const logo = useMediaUrl(BUSINESS_MEDIA_BUCKET, business.logo_path);
  const properties = useBusinessProperties(business.id);
  const policies = useBusinessPolicies(business.id);
  const location = businessLocation(business);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: business.display_name,
    ...(business.description ? { description: business.description } : {}),
    ...(business.website_url ? { url: business.website_url } : {}),
    ...(business.public_email ? { email: business.public_email } : {}),
    ...(business.public_phone ? { telephone: business.public_phone } : {}),
    ...(location
      ? {
          address: {
            "@type": "PostalAddress",
            ...(business.address_city ? { addressLocality: business.address_city } : {}),
            ...(business.address_state ? { addressRegion: business.address_state } : {}),
            ...(business.address_country ? { addressCountry: business.address_country } : {}),
          },
        }
      : {}),
  };

  return (
    <main className="bg-background pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <BusinessHeader
        slug={business.slug}
        name={business.display_name}
        logoUrl={logo}
        handle={business.handle}
        verified={business.verification_status === "verified"}
        showProperties={Boolean(properties.data?.length)}
        showPolicies={Boolean(policies.data?.length)}
      />
      <Outlet />
    </main>
  );
}
