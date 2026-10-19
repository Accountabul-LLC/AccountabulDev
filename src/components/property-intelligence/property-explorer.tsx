// Adapted from Accountabul-LLC/property-insight-hub src/components/property-explorer.tsx — the
// orchestrator/shell that composes the rest of the Property Intelligence UI. property-insight-hub's
// version drives a single full-payload /api/properties fetch (Next.js API route) and its own
// AI-chat/dossier/owner-research state; accountabul-final's port instead composes the sibling
// components in this directory, each of which calls accountabul-final's own existing,
// already-working server functions directly. This shell only owns page navigation (mirroring
// property-insight-hub's hash-based product switcher, see product-navigation.ts) and the
// "analyze this record" hand-off from Property records to the Deal analyst, which the previous
// bespoke src/routes/property-intelligence.tsx implementation also had.
//
// Not ported here (see docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md for the full list and why):
// the property-intelligence-notice acknowledgment modal, owner/entity research chat, and
// anything depending on the nationwide ingestion pipeline (explicitly out of scope). Phase 3
// (property-memory -> "Your property records", owner document uploads), Phase 4
// (report-actions/records-portal -> "PDF vault", built against this repo's own real
// deal-scenario/workspace/owner-record data, not the source's AI-chat transcript packet),
// and Phase 5 (api-access-repository -> a real submit/status flow on ApiAccess) are now built.

import { useCallback, useEffect, useState } from "react";

import {
  defaultProductPage,
  productPageHref,
  productPages,
  resolveProductPage,
  type ProductPage,
} from "@/lib/property-intelligence/product-navigation";
import {
  createDefaultDealInputs,
  type DealInputs,
} from "@/lib/property-intelligence/deal-analysis";
import type { PropertyRecord } from "@/lib/property-intelligence/property-data";

import PortalHome from "@/components/property-intelligence/portal-home";
import PropertyRecords from "@/components/property-intelligence/property-records";
import DealAnalyst, { type DealTarget } from "@/components/property-intelligence/deal-analyst";
import PropertyAnalysis from "@/components/property-intelligence/property-analysis";
import PropertyOwnerDocuments from "@/components/property-intelligence/property-owner-documents";
import PdfVault from "@/components/property-intelligence/pdf-vault";
import ApiAccess from "@/components/property-intelligence/api-access";
import ApiKeys from "@/components/property-intelligence/api-keys";
import PropertyIntelligenceNotice from "@/components/property-intelligence/property-intelligence-notice";

function ProductNavIcon() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />;
}

export default function PropertyExplorer({ propertyCount = 0 }: { propertyCount?: number }) {
  const [activePage, setActivePage] = useState<ProductPage>(defaultProductPage);
  const [dealTarget, setDealTarget] = useState<DealTarget | null>(null);
  const [dealSeed, setDealSeed] = useState<DealInputs>(createDefaultDealInputs);

  useEffect(() => {
    const syncPage = () => setActivePage(resolveProductPage(window.location.hash));
    syncPage();
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  const goToDeal = useCallback((page: ProductPage) => {
    setActivePage(page);
    window.location.hash = productPageHref(page);
  }, []);

  const handleAnalyze = useCallback(
    (record: PropertyRecord) => {
      setDealTarget({
        address: record.address,
        parcelId: record.parcelId,
        recordId: record.id,
        priceMissing: record.price === null,
      });
      setDealSeed({
        ...createDefaultDealInputs(),
        purchasePrice: record.price ?? 0,
        assessorValue: record.assessorValue ?? 0,
        strategy: record.propertyType?.toLowerCase().includes("vacant")
          ? "vacant_land"
          : "buy_hold",
      });
      goToDeal("deal");
    },
    [goToDeal],
  );

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <nav
          aria-label="Accountabul property intelligence products"
          className="flex gap-1 overflow-x-auto rounded-lg border border-border p-1 lg:flex-col lg:overflow-visible"
        >
          {productPages.map((page) => (
            <a
              key={page.key}
              href={productPageHref(page.key)}
              aria-current={activePage === page.key ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
                activePage === page.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              <ProductNavIcon />
              {page.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* The pre-offer boundary notice sits above every page, not on one of
            them: it has to be seen before the product is relied on, and it
            removes itself once the account has acknowledged it three times. */}
        <PropertyIntelligenceNotice />
        {activePage === "home" && <PortalHome propertyCount={propertyCount} />}
        {activePage === "property-records" && <PropertyRecords onAnalyze={handleAnalyze} />}
        {activePage === "deal" && (
          <DealAnalyst key={dealTarget?.recordId ?? "blank"} target={dealTarget} seed={dealSeed} />
        )}
        {activePage === "workspace" && <PropertyAnalysis />}
        {activePage === "owner-records" && <PropertyOwnerDocuments />}
        {activePage === "vault" && <PdfVault />}
        {activePage === "api" && (
          <div className="space-y-8">
            <ApiAccess />
            {/* Keys live beside the access request that gates them: a key
                cannot be minted until that request is approved. */}
            <ApiKeys />
          </div>
        )}
      </div>
    </div>
  );
}
