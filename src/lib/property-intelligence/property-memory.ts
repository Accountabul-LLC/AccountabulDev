import type { PropertyProfile } from "./analysis-types.ts";
import type { DossierEvent, PropertyDossier } from "./dossier-types.ts";
import { verificationTierForRecord, type VerificationTier } from "./verification.ts";

export type MemoryRecordKind = "status" | "fee" | "condition" | "record" | "tax";

export type MemoryRecord = {
  id: string;
  kind: MemoryRecordKind;
  title: string;
  detail: string | null;
  status: string | null;
  amount: number | null;
  occurredAt: string | null;
  observedAt: string;
  sourceUrl: string;
  count: number;
  verification: VerificationTier;
};

export type MemoryCategory = {
  key: "vacancy" | "permits" | "inspections" | "demolition" | "tax" | "owner" | "other";
  label: string;
  description: string;
  sourceRecordCount: number;
  records: MemoryRecord[];
};

function vacancyKind(event: DossierEvent): MemoryRecordKind {
  if (event.amount !== null || /fee|penalty/i.test(event.eventType)) return "fee";
  if (
    event.eventType === "Vacant building status" ||
    /letter|pending|abated/i.test(event.status ?? "")
  )
    return "status";
  if (event.eventType === "Vacant building records") return "record";
  return "condition";
}

function eventRecord(event: DossierEvent, kind: MemoryRecordKind = "record"): MemoryRecord {
  return {
    id: event.id,
    kind,
    title: event.eventType,
    detail: event.summary,
    status: event.status,
    amount: event.amount,
    occurredAt: event.occurredAt,
    observedAt: event.recordedAt,
    sourceUrl: event.sourceUrl,
    count: 1,
    verification: verificationTierForRecord(event.verificationStatus),
  };
}

function groupUndatedConditions(events: DossierEvent[]) {
  const grouped = new Map<string, MemoryRecord>();
  for (const event of events) {
    const record = eventRecord(event, "condition");
    const key = `${record.title}|${record.detail ?? ""}|${record.status ?? ""}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, record);
  }
  return [...grouped.values()];
}

export function sortMemoryRecordsNewest(records: MemoryRecord[]) {
  return [...records].sort((left, right) => {
    const leftPublished = left.occurredAt ? Date.parse(left.occurredAt) : Number.NEGATIVE_INFINITY;
    const rightPublished = right.occurredAt
      ? Date.parse(right.occurredAt)
      : Number.NEGATIVE_INFINITY;
    const safeLeft = Number.isNaN(leftPublished) ? Number.NEGATIVE_INFINITY : leftPublished;
    const safeRight = Number.isNaN(rightPublished) ? Number.NEGATIVE_INFINITY : rightPublished;
    if (safeLeft !== safeRight) return safeRight - safeLeft;
    const observedDifference = Date.parse(right.observedAt) - Date.parse(left.observedAt);
    if (!Number.isNaN(observedDifference) && observedDifference !== 0) return observedDifference;
    return left.id.localeCompare(right.id);
  });
}

export function summarizeVacancy(events: DossierEvent[]) {
  const vacancy = events.filter((event) => event.sourceKey === "vacant_building");
  const conditions = vacancy.filter((event) => vacancyKind(event) === "condition");
  const fees = vacancy.filter((event) => vacancyKind(event) === "fee");
  const openFees = fees.filter((event) => /open|unpaid/i.test(event.status ?? ""));
  return {
    sourceRows: vacancy.length,
    conditionRows: conditions.length,
    uniqueConditions: groupUndatedConditions(conditions).length,
    statusRows: vacancy.filter((event) => vacancyKind(event) === "status").length,
    feeRows: fees.length,
    openFeeRows: openFees.length,
    openFeeAmount: openFees.reduce((total, event) => total + (event.amount ?? 0), 0),
  };
}

export function vacancySummaryText(summary: ReturnType<typeof summarizeVacancy>) {
  const conditionLabel = summary.uniqueConditions === 1 ? "unique condition" : "unique conditions";
  const openFeeText = summary.openFeeRows
    ? ` ${summary.openFeeRows} fee rows are marked open with published amounts totaling ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(summary.openFeeAmount)}; confirm the current payoff with the responsible agency.`
    : "";
  return `${summary.sourceRows} property records: ${summary.statusRows} status or letter records, ${summary.feeRows} fee records, and ${summary.conditionRows} condition entries grouped into ${summary.uniqueConditions} ${conditionLabel}.${openFeeText}`;
}

function standardCategory(
  key: MemoryCategory["key"],
  label: string,
  description: string,
  events: DossierEvent[],
): MemoryCategory {
  return {
    key,
    label,
    description,
    sourceRecordCount: events.length,
    records: sortMemoryRecordsNewest(events.map((event) => eventRecord(event))),
  };
}

export function buildPropertyMemory(
  dossier: PropertyDossier,
  profile: PropertyProfile | null,
): MemoryCategory[] {
  const vacancyEvents = dossier.events.filter((event) => event.sourceKey === "vacant_building");
  const conditionEvents = vacancyEvents.filter((event) => vacancyKind(event) === "condition");
  const vacancyRecords = sortMemoryRecordsNewest([
    ...vacancyEvents
      .filter((event) => vacancyKind(event) === "status")
      .map((event) => eventRecord(event, "status")),
    ...vacancyEvents
      .filter((event) => vacancyKind(event) === "fee")
      .map((event) => eventRecord(event, "fee")),
    ...groupUndatedConditions(conditionEvents),
    ...vacancyEvents
      .filter((event) => vacancyKind(event) === "record")
      .map((event) => eventRecord(event, "record")),
  ]);
  const vacancy = summarizeVacancy(dossier.events);
  const permits = dossier.events.filter(
    (event) => event.sourceKey.endsWith("_permit") && event.sourceKey !== "demolition_permit",
  );
  const inspections = dossier.events.filter((event) =>
    ["structure_inspection", "commercial_occupancy"].includes(event.sourceKey),
  );
  const demolition = dossier.events.filter((event) => event.sourceKey === "demolition_permit");
  const ownerRecords = dossier.events.filter(
    (event) => event.sourceKey === "accountabul_verified_record",
  );
  const assigned = new Set(
    [...vacancyEvents, ...permits, ...inspections, ...demolition, ...ownerRecords].map(
      (event) => event.id,
    ),
  );
  const other = dossier.events.filter((event) => !assigned.has(event.id));
  const taxRecords: MemoryRecord[] = [];
  if (profile?.priorTaxAmount !== null && profile?.priorTaxAmount !== undefined)
    taxRecords.push({
      id: "assessor-prior-tax-amount",
      kind: "tax",
      title: "Prior-year property tax",
      detail:
        "Published prior-year tax amount used as the initial annual operating-expense fact in Deal Analyst.",
      status: "Prior-year bill published",
      amount: profile.priorTaxAmount,
      occurredAt: null,
      observedAt: profile.observedAt,
      sourceUrl: profile.sourceUrl,
      count: 1,
      verification: "trusted-provider",
    });
  if (profile?.taxBalance !== null && profile?.taxBalance !== undefined)
    taxRecords.push({
      id: "assessor-tax-balance",
      kind: "tax",
      title: "Current Assessor parcel tax balance",
      detail:
        "Published balance owed. This is not treated as the annual operating expense; confirm the current payoff and other municipal charges.",
      status: profile.taxBalance > 0 ? "Balance reported" : "No balance reported",
      amount: profile.taxBalance,
      occurredAt: null,
      observedAt: profile.observedAt,
      sourceUrl: profile.sourceUrl,
      count: 1,
      verification: "trusted-provider",
    });

  return [
    {
      key: "vacancy",
      label: "Vacancy & code",
      description: vacancy.sourceRows
        ? vacancySummaryText(vacancy)
        : "No vacancy or code records were found.",
      sourceRecordCount: vacancy.sourceRows,
      records: vacancyRecords,
    },
    standardCategory(
      "permits",
      "Permits",
      "Electrical, mechanical, plumbing, sprinkler, and related permits connected to this parcel.",
      permits,
    ),
    standardCategory(
      "inspections",
      "Inspections & occupancy",
      "Structure inspection and commercial occupancy records connected to this parcel.",
      inspections,
    ),
    standardCategory(
      "demolition",
      "Demolition",
      "Demolition permit activity connected to this parcel.",
      demolition,
    ),
    {
      key: "tax",
      label: "Taxes & assessment",
      description:
        "Assessor balance and observation details. This is not a payoff statement or lien search.",
      sourceRecordCount: taxRecords.length,
      records: taxRecords,
    },
    standardCategory(
      "owner",
      "Verified owner records",
      "Receipts, permits, invoices, inspections, and improvement evidence submitted by the owner and verified by Accountabul. These records remain distinct from city-published facts.",
      ownerRecords,
    ),
    standardCategory(
      "other",
      "Other records",
      "Additional acquisition or public records retained in this property activity history.",
      other,
    ),
  ];
}
