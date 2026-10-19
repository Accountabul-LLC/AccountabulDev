export type CitySourceKey =
  | "electrical_permit"
  | "mechanical_permit"
  | "plumbing_permit"
  | "sprinkler_permit"
  | "demolition_permit"
  | "commercial_occupancy"
  | "structure_inspection"
  | "vacant_building";

export type CitySource = {
  key: CitySourceKey;
  label: string;
  endpoint: string;
  datasetUrl: string;
};

export type NormalizedCityRecord = {
  sourceKey: CitySourceKey;
  sourceLabel: string;
  sourceRecordId: string;
  recordType: string;
  occurredAt: string | null;
  status: string | null;
  actorName: string | null;
  contractorName: string | null;
  description: string | null;
  amount: number | null;
  address: string | null;
  asrParcelId: string;
  handle: string | null;
  sourceUrl: string;
  rawJson: string;
};

export type SourceSyncResult = {
  source: CitySource;
  status: "success" | "failed";
  records: NormalizedCityRecord[];
  unmatched: Array<{
    sourceRecordId: string;
    suppliedParcelId: string | null;
    address: string | null;
    rawJson: string;
  }>;
  error: string | null;
};

const API_ROOT = "https://www.stlcitypermits.com";

export const CITY_SOURCES: CitySource[] = [
  {
    key: "electrical_permit",
    label: "Electrical permits",
    endpoint: "/API/Permits/GetElectricalPermits",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=51",
  },
  {
    key: "mechanical_permit",
    label: "Mechanical permits",
    endpoint: "/API/Permits/GetMechanicalPermits",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=52",
  },
  {
    key: "plumbing_permit",
    label: "Plumbing permits",
    endpoint: "/API/Permits/GetPlumbingPermits",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/distribution.cfm?id=164",
  },
  {
    key: "sprinkler_permit",
    label: "Sprinkler permits",
    endpoint: "/API/Permits/GetSprinklerPermits",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/",
  },
  {
    key: "demolition_permit",
    label: "Demolition permits",
    endpoint: "/API/Demolition/GetDemolitionPermits",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=24",
  },
  {
    key: "commercial_occupancy",
    label: "Commercial occupancy",
    endpoint: "/API/Occupancy/GetCommercialOccupancyInspections",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=6",
  },
  {
    key: "structure_inspection",
    label: "Structure inspections",
    endpoint: "/API/Occupancy/GetAllInspections",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/distribution.cfm?id=172",
  },
  {
    key: "vacant_building",
    label: "Vacant building records",
    endpoint: "/API/VacantBuilding/GetAllVacantBuildings",
    datasetUrl: "https://www.stlouis-mo.gov/data/datasets/dataset.cfm?id=108",
  },
];

const nestedCollections = [
  "Violations",
  "Inspections",
  "Invoices",
  "Notes",
  "Results",
  "FeesAndPenalties",
] as const;

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
};

const first = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const result = clean(record[key]);
    if (result) return result;
  }
  return null;
};

const numeric = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).replace(/[$,]/g, "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function expandRecord(record: Record<string, unknown>) {
  const base = { ...record };
  const children: Array<{ suffix: string; value: Record<string, unknown> }> = [];
  for (const collection of nestedCollections) {
    const items = record[collection];
    delete base[collection];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (item && typeof item === "object")
        children.push({
          suffix: `${collection.toLowerCase()}-${index}`,
          value: { ...base, ...(item as Record<string, unknown>) },
        });
    });
  }
  return [{ suffix: "record", value: base }, ...children];
}

export function normalizeCityRecord(
  source: CitySource,
  record: Record<string, unknown>,
  requestedParcelId: string,
  suffix = "record",
): NormalizedCityRecord {
  const rawJson = JSON.stringify(record);
  const externalId =
    first(record, [
      "ViolationID",
      "InspectionID",
      "InvoiceID",
      "PermitID",
      "DemolitionPermitID",
      "OccupancyInspectionID",
      "VacantBuildingID",
      "PermitNumber",
      "ProjectNumber",
      "Id",
      "ID",
    ]) ?? stableHash(rawJson);
  const recordType =
    first(record, [
      "PermitType",
      "InspectionType",
      "ViolationType",
      "FeeDescription",
      "RecordType",
    ]) ?? (first(record, ["CurrentResult"]) ? "Vacant building status" : source.label);
  const status = first(record, [
    "CurrentStatus",
    "PermitStatus",
    "CurrentResult",
    "Result",
    "ViolationResolution",
    "InvoiceStatus",
    "Status",
    "ViolationSeverity",
  ]);
  const violationDetail = [
    first(record, ["ViolationLocation"]),
    first(record, ["ViolationItem"]),
    first(record, ["ViolationAnswer"]),
    first(record, ["ViolationText"]),
  ]
    .filter(Boolean)
    .join(" · ");
  const description =
    violationDetail ||
    first(record, [
      "ProjectDescription",
      "WorkDescription",
      "FeeDescription",
      "BusinessType",
      "InspectionNotes",
      "Notes",
      "CurrentResult",
    ]);

  return {
    sourceKey: source.key,
    sourceLabel: source.label,
    sourceRecordId: `${externalId}:${suffix}`,
    recordType,
    occurredAt: first(record, [
      "CompletionDate",
      "FinalInspectionDate",
      "InspectionDate",
      "CurrentResultDate",
      "FeeLetterDate",
      "IssueDate",
      "ApprovalDate",
      "ApplicationDate",
      "CreatedDate",
      "ViolationDate",
      "ModifiedDate",
    ]),
    status,
    actorName: first(record, [
      "ProjectOwnerName",
      "OwnerName",
      "OwnerCompanyName",
      "PropertyOwner",
      "ApplicantName",
    ]),
    contractorName: first(record, ["ContractorCompanyName", "ContractorName", "CompanyName"]),
    description,
    amount: numeric(
      record["ProjectCost"] ??
        record["EstimatedCost"] ??
        record["PermitCost"] ??
        record["InvoiceAmount"] ??
        record["FeeDollarAmount"],
    ),
    address: first(record, ["ProjectAddress", "Address", "PropertyAddress"]),
    asrParcelId:
      first(record, ["ProjectASRParcelID", "ASRParcelID", "AsrParcelId"]) ?? requestedParcelId,
    handle: first(record, ["ProjectHandle", "Handle"]),
    sourceUrl: source.datasetUrl,
    rawJson,
  };
}

export async function fetchCitySource(
  source: CitySource,
  requestedParcelId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<SourceSyncResult> {
  const url = new URL(source.endpoint, API_ROOT);
  url.searchParams.set("ASRParcelID", requestedParcelId);
  try {
    const response = await fetchImplementation(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`City API returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("City API returned a non-list response");

    const records: NormalizedCityRecord[] = [];
    const unmatched: SourceSyncResult["unmatched"] = [];
    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const suppliedParcelId = first(raw, ["ProjectASRParcelID", "ASRParcelID", "AsrParcelId"]);
      const expanded = expandRecord(raw);
      if (suppliedParcelId !== requestedParcelId) {
        expanded.forEach(({ suffix, value }) => {
          const normalized = normalizeCityRecord(source, value, requestedParcelId, suffix);
          unmatched.push({
            sourceRecordId: normalized.sourceRecordId,
            suppliedParcelId,
            address: normalized.address,
            rawJson: normalized.rawJson,
          });
        });
        continue;
      }
      expanded.forEach(({ suffix, value }) =>
        records.push(normalizeCityRecord(source, value, requestedParcelId, suffix)),
      );
    }
    return { source, status: "success", records, unmatched, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown city API failure";
    return { source, status: "failed", records: [], unmatched: [], error: message };
  }
}

export async function fetchParcelIntelligence(
  parcelId: string,
  sources: CitySource[] = CITY_SOURCES,
  fetchImplementation: typeof fetch = fetch,
) {
  return Promise.all(
    sources.map((source) => fetchCitySource(source, parcelId, fetchImplementation)),
  );
}
