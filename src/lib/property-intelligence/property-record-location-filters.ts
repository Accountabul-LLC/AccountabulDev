// Ported from Accountabul-LLC/property-insight-hub src/lib/property-record-location-filters.ts.
// Import path adjusted to accountabul-final's @/lib/property-intelligence/property-data.

import type { PropertyRecord } from "@/lib/property-intelligence/property-data";

export type PropertyStateFilterOption = {
  stateCode: string;
  stateName: string;
  recordCount: number;
};

export type PropertyCountyFilterOption = {
  countyFips: string;
  countyName: string;
  stateCode: string;
  stateName: string;
  recordCount: number;
};

function requireCanonicalLocation(property: PropertyRecord) {
  if (
    !/^[A-Z]{2}$/.test(property.stateCode) ||
    !property.stateName.trim() ||
    !/^\d{5}$/.test(property.countyFips) ||
    !property.countyName.trim()
  ) {
    throw new Error(`property record ${property.id} has invalid canonical location identity`);
  }
}

export function buildPropertyStateFilterOptions(properties: readonly PropertyRecord[]) {
  const states = new Map<string, PropertyStateFilterOption>();
  for (const property of properties) {
    requireCanonicalLocation(property);
    const current = states.get(property.stateCode);
    if (current && current.stateName !== property.stateName) {
      throw new Error(`property records disagree on state name for ${property.stateCode}`);
    }
    states.set(property.stateCode, {
      stateCode: property.stateCode,
      stateName: property.stateName,
      recordCount: (current?.recordCount ?? 0) + 1,
    });
  }
  return [...states.values()].sort(
    (left, right) =>
      left.stateName.localeCompare(right.stateName) ||
      left.stateCode.localeCompare(right.stateCode),
  );
}

export function buildPropertyCountyFilterOptions(
  properties: readonly PropertyRecord[],
  stateCode: string | null,
) {
  const counties = new Map<string, PropertyCountyFilterOption>();
  for (const property of properties) {
    requireCanonicalLocation(property);
    if (stateCode !== null && property.stateCode !== stateCode) continue;
    const current = counties.get(property.countyFips);
    if (
      current &&
      (current.countyName !== property.countyName ||
        current.stateCode !== property.stateCode ||
        current.stateName !== property.stateName)
    ) {
      throw new Error(`property records disagree on county identity for ${property.countyFips}`);
    }
    counties.set(property.countyFips, {
      countyFips: property.countyFips,
      countyName: property.countyName,
      stateCode: property.stateCode,
      stateName: property.stateName,
      recordCount: (current?.recordCount ?? 0) + 1,
    });
  }
  return [...counties.values()].sort(
    (left, right) =>
      left.countyName.localeCompare(right.countyName) ||
      left.stateCode.localeCompare(right.stateCode) ||
      left.countyFips.localeCompare(right.countyFips),
  );
}

export function filterPropertyRecordsByLocation(
  properties: readonly PropertyRecord[],
  stateCode: string | null,
  countyFips: string | null,
) {
  return properties.filter(
    (property) =>
      (stateCode === null || property.stateCode === stateCode) &&
      (countyFips === null || property.countyFips === countyFips),
  );
}

export function normalizePropertyLocationFilterSelection(
  properties: readonly PropertyRecord[],
  stateCode: string | null,
  countyFips: string | null,
) {
  const stateExists =
    stateCode === null || properties.some((property) => property.stateCode === stateCode);
  const normalizedStateCode = stateExists ? stateCode : null;
  const countyExists =
    countyFips === null ||
    properties.some(
      (property) =>
        property.countyFips === countyFips &&
        (normalizedStateCode === null || property.stateCode === normalizedStateCode),
    );
  return {
    stateCode: normalizedStateCode,
    countyFips: stateExists && countyExists ? countyFips : null,
  };
}
