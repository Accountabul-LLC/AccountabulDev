// Shared record contract for Property Intelligence (ported from property-intelligence-app).

export type SourceKey = "LRA" | "LCRA" | "Tax auction" | "Public record" | "Canonical property";

export type PropertyRecordCategory =
  "City-owned" | "Public inventory" | "Tax sale" | "Assessor record" | "Property record";

export type SearchablePropertyAttribute = {
  key: string;
  label: string;
  value: string | number | boolean;
  unit: string | null;
};

export type RelatedPropertyRecord = {
  id: string;
  agency?: string | null;
  category: PropertyRecordCategory;
  status: string;
  recordNumber: string;
  owner: string | null;
  price: number | null;
  priceLabel: string;
  description: string | null;
  notices: string[];
  searchableAttributes?: SearchablePropertyAttribute[];
  sourceUrl: string;
  sourceUpdated: string;
};

export type PropertyRecord = {
  id: string;
  canonicalPropertyId: string | null;
  source: SourceKey;
  agency?: string | null;
  recordCategory: PropertyRecordCategory;
  relatedRecords: RelatedPropertyRecord[];
  address: string;
  city: string;
  stateCode: string;
  stateName: string;
  countyName: string;
  countyFips: string;
  status: string;
  price: number | null;
  priceLabel: string;
  recordNumber: string;
  parcelId: string | null;
  owner: string | null;
  ward: number | null;
  neighborhood: number | null;
  zipCode: string | null;
  squareFeet: number | null;
  buildingSquareFeet: number | null;
  acres: number | null;
  frontage: number | null;
  units: number | null;
  propertyType: string | null;
  usage: string | null;
  description: string | null;
  assessorValue: number | null;
  marketValue: number | null;
  featured: boolean;
  notices: string[];
  searchableAttributes?: SearchablePropertyAttribute[];
  sourceUrl: string;
  sourceUpdated: string;
};

export type SourceState = {
  key: SourceKey;
  label: string;
  mode: "live" | "snapshot" | "unavailable";
  total: number | null;
  loaded: number;
  detail: string;
  url: string;
};

export type PropertySearchAmountFilter =
  "all" | "under_5000" | "5000_15000" | "over_15000" | "offer_required";

export type PropertySearchSort = "record_order" | "amount_asc" | "amount_desc" | "address";

export type PropertySearchRequest = {
  query: string | null;
  stateCode: string | null;
  countyFips: string | null;
  recordCategory: PropertyRecordCategory | null;
  amountFilter: PropertySearchAmountFilter;
  sort: PropertySearchSort;
  cursor: string | null;
  pageSize: number;
};

export type PropertySearchMetadata = {
  mode: "server";
  total: number;
  nextCursor: string | null;
  pageSize: number;
  states: Array<{
    stateCode: string;
    stateName: string;
    recordCount: number;
  }>;
  counties: Array<{
    stateCode: string;
    stateName: string;
    countyFips: string;
    countyName: string;
    recordCount: number;
  }>;
  categories: Array<{
    category: PropertyRecordCategory;
    recordCount: number;
  }>;
  summary: {
    resultTotal: number;
    pricedResultCount: number;
    offerRequiredCount: number;
    taxSaleResultCount: number;
  };
  request: Omit<PropertySearchRequest, "cursor">;
};

export type PropertyPayload = {
  properties: PropertyRecord[];
  sources: SourceState[];
  fetchedAt: string;
  search?: PropertySearchMetadata;
};
