export type DossierEvent = {
  id: string;
  sourceKey: string;
  eventType: string;
  occurredAt: string | null;
  recordedAt: string;
  title: string;
  summary: string | null;
  actorName: string | null;
  status: string | null;
  amount: number | null;
  sourceUrl: string;
  verificationStatus: string;
};

export type DossierSourceStatus = {
  sourceKey: string;
  status: string;
  recordsSeen: number;
  unmatchedCount: number;
  completedAt: string | null;
  error: string | null;
};

export type PropertyDossier = {
  property: null | {
    id: string;
    asrParcelId: string;
    handle: string | null;
    currentAddress: string | null;
    matchStatus: string;
    lastIntelligenceSyncAt: string | null;
    updatedAt: string;
    intelligenceSchemaVersion: number;
  };
  events: DossierEvent[];
  sources: DossierSourceStatus[];
  unresolvedRecordCount: number;
  freshness: {
    mode: "automatic";
    state: "not-ingested" | "fresh" | "stale";
    lastSyncedAt: string | null;
    nextRefreshAt: string | null;
  };
  titleEvidence: Array<{
    key: string;
    label: string;
    status: "available" | "missing" | "review";
    detail: string;
  }>;
  disclaimer: string;
};
