export type FundingProduct = {
  id: string;
  issuer: string;
  name: string;
  introRatePercent: number;
  introMonths: number;
  standardAprMinPercent: number;
  standardAprMaxPercent: number;
  annualFee: number;
  reviewedAt: string;
  sourceUrl: string;
};

export const FUNDING_PRODUCT_CATALOG: FundingProduct[] = [
  {
    id: "chase-ink-business-unlimited",
    issuer: "Chase",
    name: "Ink Business Unlimited",
    introRatePercent: 0,
    introMonths: 12,
    standardAprMinPercent: 16.74,
    standardAprMaxPercent: 24.74,
    annualFee: 0,
    reviewedAt: "2026-08-19",
    sourceUrl: "https://creditcards.chase.com/business-credit-cards/ink/unlimited",
  },
  {
    id: "chase-ink-business-cash",
    issuer: "Chase",
    name: "Ink Business Cash",
    introRatePercent: 0,
    introMonths: 12,
    standardAprMinPercent: 16.74,
    standardAprMaxPercent: 24.74,
    annualFee: 0,
    reviewedAt: "2026-08-19",
    sourceUrl: "https://creditcards.chase.com/business-credit-cards",
  },
  {
    id: "amex-blue-business-cash",
    issuer: "American Express",
    name: "Blue Business Cash",
    introRatePercent: 0,
    introMonths: 12,
    standardAprMinPercent: 18.49,
    standardAprMaxPercent: 26.49,
    annualFee: 0,
    reviewedAt: "2026-08-19",
    sourceUrl:
      "https://www.americanexpress.com/en-us/campaigns/small-business/credit-cards/blue-business-cash/bonus-offer/",
  },
  {
    id: "capital-one-spark-cash-select",
    issuer: "Capital One",
    name: "Spark 1.5% Cash Select",
    introRatePercent: 0,
    introMonths: 0,
    standardAprMinPercent: 16.74,
    standardAprMaxPercent: 22.74,
    annualFee: 0,
    reviewedAt: "2026-08-19",
    sourceUrl: "https://www.capitalone.com/small-business/credit-cards/spark-cash-select/",
  },
  {
    id: "wells-fargo-signify-business-cash",
    issuer: "Wells Fargo",
    name: "Signify Business Cash",
    introRatePercent: 0,
    introMonths: 12,
    standardAprMinPercent: 16.74,
    standardAprMaxPercent: 24.74,
    annualFee: 0,
    reviewedAt: "2026-08-19",
    sourceUrl:
      "https://www.wellsfargo.com/biz/business-credit/credit-cards/signify-business-cash-credit-card-terms-conditions/",
  },
];

export function fundingProductById(id: string) {
  return FUNDING_PRODUCT_CATALOG.find((product) => product.id === id) ?? null;
}
