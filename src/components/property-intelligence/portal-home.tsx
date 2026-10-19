// Ported/adapted from Accountabul-LLC/property-insight-hub src/components/portal-home.tsx.
// Rewritten with accountabul-final's Tailwind + shadcn conventions (the original used a
// bespoke global stylesheet this repo does not have) and re-pointed at the product pages
// this pass actually ported: "vault" here is the saved-workspace list (property-analysis.tsx
// ported as the address-lookup / workspace page), not a PDF report vault.

import { productPageHref } from "@/lib/property-intelligence/product-navigation";

const portalProducts = [
  {
    number: "01",
    title: "Look up an address",
    description:
      "Search an official Assessor parcel by address or parcel ID and open a permanent workspace for it.",
    result: "A saved parcel workspace",
    href: productPageHref("workspace"),
    action: "Start a lookup",
  },
  {
    number: "02",
    title: "Search property records",
    description:
      "Explore available property records, compare published amounts, and open the intelligence attached to a parcel.",
    result: "A searchable property record",
    href: productPageHref("property-records"),
    action: "Browse records",
  },
  {
    number: "03",
    title: "Run a deal analysis",
    description:
      "Model purchase price, financing, rent and expenses, and save the scenario for later.",
    result: "A saved deal scenario",
    href: productPageHref("deal"),
    action: "Open the deal analyst",
  },
  {
    number: "04",
    title: "Connect your software",
    description:
      "Learn what a structured API integration with Accountabul property intelligence looks like.",
    result: "API access overview",
    href: productPageHref("api"),
    action: "Explore the API",
  },
] as const;

export default function PortalHome({ propertyCount }: { propertyCount: number }) {
  return (
    <div className="space-y-10">
      <section className="surface-card grid gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Welcome to Accountabul
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Understand the property. Then understand the deal.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Search an address, review the property&apos;s sourced record, test your investment
            assumptions, and leave with numbers you can trust.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              href={productPageHref("workspace")}
            >
              Look up an address
            </a>
            <a
              className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium"
              href={productPageHref("property-records")}
            >
              Browse property records
            </a>
          </div>
        </div>

        <div
          className="rounded-lg border border-border bg-secondary/40 p-4"
          aria-label="How Accountabul works"
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Property workspace</span>
            <span>Ready</span>
          </div>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <span className="font-display font-semibold">01</span>
              <p>
                <strong className="block">Property record</strong>
                <span className="text-xs text-muted-foreground">Verified parcel facts</span>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-display font-semibold">02</span>
              <p>
                <strong className="block">Property intelligence</strong>
                <span className="text-xs text-muted-foreground">Sourced Assessor dossier</span>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-display font-semibold">03</span>
              <p>
                <strong className="block">Deal analysis</strong>
                <span className="text-xs text-muted-foreground">Deterministic investment math</span>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-display font-semibold">04</span>
              <p>
                <strong className="block">Saved scenario</strong>
                <span className="text-xs text-muted-foreground">Kept when you choose</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="portal-products-heading">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Your property intelligence portal
          </p>
          <h2 id="portal-products-heading" className="mt-1 font-display text-xl font-semibold">
            What would you like to do?
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {portalProducts.map((product) => (
            <a
              key={product.number}
              className="surface-card flex flex-col gap-2 p-4 transition hover:border-primary/40"
              href={product.href}
            >
              <span className="font-display text-lg text-muted-foreground">{product.number}</span>
              <h3 className="font-display text-base font-semibold">{product.title}</h3>
              <p className="text-xs text-muted-foreground">{product.description}</p>
              <div className="mt-auto pt-2 text-xs">
                <span className="block text-muted-foreground">You get</span>
                <strong>{product.result}</strong>
              </div>
              <b className="mt-2 inline-flex items-center gap-1 text-sm text-primary">
                {product.action}
                <span aria-hidden="true">→</span>
              </b>
            </a>
          ))}
        </div>
      </section>

      <section
        className="grid gap-4 text-sm sm:grid-cols-4"
        aria-label="Accountabul portal commitments"
      >
        <div>
          <strong className="block font-display text-lg">
            {propertyCount.toLocaleString("en-US")}
          </strong>
          <span className="text-xs text-muted-foreground">property records ready to search</span>
        </div>
        <div>
          <strong className="block font-display text-lg">One address</strong>
          <span className="text-xs text-muted-foreground">one living property workspace</span>
        </div>
        <div>
          <strong className="block font-display text-lg">Deterministic math</strong>
          <span className="text-xs text-muted-foreground">
            the same inputs produce the same result
          </span>
        </div>
        <div>
          <strong className="block font-display text-lg">Evidence first</strong>
          <span className="text-xs text-muted-foreground">
            facts stay separate from projections
          </span>
        </div>
      </section>
    </div>
  );
}
