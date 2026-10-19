// Adapted from Accountabul-LLC/property-insight-hub src/lib/product-navigation.ts.
// The page set originally differed from property-insight-hub's ("vault" there is a PDF
// report vault backed by report-vault.server.ts + pdf.server.ts, not ported in the
// UI-parity pass — see docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). "workspace" lists the
// saved parcel workspaces that property-workspace.functions.ts persists; "vault" is now
// Phase 4's own PDF report vault (report-vault.functions.ts), built against real data
// in this repo (deal scenario + parcel workspace + Phase 3 verified owner records) --
// not a port of the source's AI-chat/transcript-driven vault.

export const productPages = [
  { key: "home", label: "Home" },
  { key: "property-records", label: "Property records" },
  { key: "deal", label: "Deal analyst" },
  { key: "workspace", label: "Address lookup" },
  { key: "owner-records", label: "Your property records" },
  { key: "vault", label: "PDF vault" },
  { key: "api", label: "Property Intelligence API" },
] as const;

export type ProductPage = (typeof productPages)[number]["key"];

export const defaultProductPage: ProductPage = "home";

export function productPageHref(page: ProductPage): `#${ProductPage}` {
  return `#${page}`;
}

export function resolveProductPage(hash: string): ProductPage {
  const key = hash.replace(/^#/, "");
  return productPages.some((page) => page.key === key) ? (key as ProductPage) : defaultProductPage;
}
