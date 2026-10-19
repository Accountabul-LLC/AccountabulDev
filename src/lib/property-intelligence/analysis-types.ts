import type { PropertyDossier } from "./dossier-types.ts";
import type { VerificationTier } from "./verification.ts";

export type ParcelSearchResult = {
  parcelId: string;
  address: string;
  lotSquareFeet: number | null;
  ward: number | null;
  taxBalance: number | null;
  priorTaxAmount: number | null;
  propertyClassCode: number | null;
  isTaxAbated: boolean | null;
  abatementStartYear: number | null;
  abatementEndYear: number | null;
  webMercatorX: number | null;
  webMercatorY: number | null;
  cityBlock: number | null;
  parcelNumber: number | null;
  ownerName: string | null;
  ownerName2: string | null;
  legalDescription: string | null;
  assessorClassCode: string | null;
  landUseCode: string | null;
  vacantLot: boolean | null;
  numberOfUnits: number | null;
  numberOfApartments: number | null;
  frontageFeet: number | null;
  landArea: number | null;
  assessedLandValue: number | null;
  assessedImprovementValue: number | null;
  assessedTotalValue: number | null;
  appraisedLandValue: number | null;
  appraisedImprovementValue: number | null;
  zoning: string | null;
  residentialBuildingCount: number | null;
  commercialBuildingCount: number | null;
  firstYearBuilt: number | null;
  lastYearBuilt: number | null;
  lastResidentialSalePrice: number | null;
  lastResidentialSaleDate: string | null;
  vacantBuildingYear: number | null;
  neighborhoodCode: string | null;
  zipCode: string | null;
  ownerOccupied: boolean | null;
  assessorHandle: string | null;
  sourceUrl: string;
  observedAt: string;
};

export type PropertyProfile = Omit<ParcelSearchResult, "parcelId" | "address">;

export type PropertyIntakeClaims = {
  propertyUse:
    | "unknown"
    | "single-family"
    | "duplex"
    | "triplex"
    | "fourplex"
    | "multi-family"
    | "commercial"
    | "mixed-use"
    | "land"
    | "other";
  bedrooms: number | null;
  bathrooms: number | null;
  interiorSquareFeet: number | null;
  currentOccupancy: "unknown" | "owner-occupied" | "tenant-occupied" | "vacant";
  condition: "unknown" | "turnkey" | "light-rehab" | "moderate-rehab" | "full-rehab";
  notes: string;
  updatedAt: string | null;
};

export type PropertyIntake = {
  threadId: string;
  parcelId: string;
  address: string;
  profile: PropertyProfile | null;
  claims: PropertyIntakeClaims;
};

export type PropertyRecordCategory =
  "permit" | "receipt" | "invoice" | "inspection" | "repair" | "photo" | "other";
export type PropertyRecordReviewStatus = "submitted" | "verified" | "rejected";

export type PropertyRecordSubmission = {
  id: string;
  threadId: string;
  propertyId: string;
  parcelId: string;
  category: PropertyRecordCategory;
  title: string;
  description: string | null;
  occurredAt: string | null;
  amount: number | null;
  vendorName: string | null;
  referenceNumber: string | null;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  fileHash: string;
  reviewStatus: PropertyRecordReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type AnalysisEvidence = {
  label: string;
  sourceUrl: string;
  occurredAt: string | null;
};

export type PropertyReport = {
  generatedAt: string;
  overview: string;
  riskLevel: "attention" | "moderate" | "limited-evidence";
  facts: Array<{
    label: string;
    value: string;
    source: string;
    sourceUrl?: string;
    verification?: VerificationTier;
  }>;
  strengths: string[];
  risks: string[];
  nextChecks: string[];
  sourceCoverage: { reached: number; expected: number; recordsSeen: number };
  evidence: AnalysisEvidence[];
};

export type AnalysisMessage = {
  id: string;
  role: "user" | "assistant";
  messageType: "chat" | "report";
  content: string;
  evidence: AnalysisEvidence[];
  createdAt: string;
};

export type AnalysisThread = {
  id: string;
  propertyId: string;
  parcelId: string;
  title: string;
  status: "new" | "in_progress" | "analyzed" | "report_downloaded";
  updatedAt: string;
  profile: PropertyProfile | null;
  dossier: PropertyDossier;
  report: PropertyReport;
  messages: AnalysisMessage[];
};

export type AnalysisThreadSummary = {
  id: string;
  parcelId: string;
  title: string;
  status: AnalysisThread["status"];
  updatedAt: string;
};

export type AnalysisQuestionMetricCount = { key: string; count: number };

export type AnalysisQuestionMetrics = {
  totalQuestions: number;
  handlerCanAnswer: { yes: number; no: number };
  validation: { passed: number; failed: number };
  modelResearch: { eligible: number; notEligible: number };
  intents: AnalysisQuestionMetricCount[];
  routes: AnalysisQuestionMetricCount[];
  missingSources: AnalysisQuestionMetricCount[];
};
