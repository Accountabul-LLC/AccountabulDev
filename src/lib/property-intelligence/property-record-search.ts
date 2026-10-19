import type { PropertyRecord, PropertyRecordCategory } from "./property-data.ts";

export type { PropertyRecordCategory } from "./property-data.ts";

export type PropertyRecordClassification =
  `agency:${string}` | `category:${PropertyRecordCategory}`;

export function propertyRecordCategory(property: PropertyRecord): PropertyRecordCategory {
  return property.recordCategory ?? (property.source === "Tax auction" ? "Tax sale" : "City-owned");
}

export function propertyRecordAgency(property: Pick<PropertyRecord, "agency" | "source">) {
  const publishedAgency = property.agency?.replace(/\s+/g, " ").trim();
  if (publishedAgency) return publishedAgency;
  if (property.source === "LRA" || property.source === "LCRA") return property.source;
  return null;
}

export function categoryClassification(
  category: PropertyRecordCategory,
): PropertyRecordClassification {
  return `category:${category}`;
}

export function propertyRecordClassification(
  property: PropertyRecord,
): PropertyRecordClassification {
  const agency = propertyRecordAgency(property);
  return propertyRecordCategory(property) === "City-owned" && agency
    ? `agency:${agency}`
    : categoryClassification(propertyRecordCategory(property));
}

export function propertyRecordClassificationLabel(classification: PropertyRecordClassification) {
  return classification.replace(/^(agency|category):/, "");
}

export function propertyRecordClassificationDetail(property: PropertyRecord) {
  return propertyRecordClassification(property).startsWith("agency:")
    ? "City-owned inventory"
    : null;
}

export function propertyHasRecordClassification(
  property: PropertyRecord,
  classification: PropertyRecordClassification,
) {
  if (propertyRecordClassification(property) === classification) return true;
  if (!classification.startsWith("category:")) return false;
  const category = propertyRecordClassificationLabel(classification) as PropertyRecordCategory;
  return (property.relatedRecords ?? []).some((record) => record.category === category);
}

export function classificationRecordCategory(classification: PropertyRecordClassification) {
  return classification.startsWith("category:")
    ? (propertyRecordClassificationLabel(classification) as PropertyRecordCategory)
    : null;
}

export function propertyHasRecordCategory(
  property: PropertyRecord,
  category: PropertyRecordCategory,
) {
  return (
    propertyRecordCategory(property) === category ||
    (property.relatedRecords ?? []).some((record) => record.category === category)
  );
}

export function propertyRecordSearchText(property: PropertyRecord) {
  return [
    property.address,
    propertyRecordCategory(property),
    propertyRecordAgency(property),
    property.recordNumber,
    property.parcelId,
    property.owner,
    property.propertyType,
    property.usage,
    property.city,
    property.stateCode,
    property.stateName,
    property.countyName,
    property.countyFips,
    property.zipCode,
    ...(property.searchableAttributes ?? []).flatMap((attribute) => [
      attribute.key,
      attribute.label,
      attribute.value,
      attribute.unit,
    ]),
    ...(property.relatedRecords ?? []).flatMap((record) => [
      record.category,
      record.status,
      record.recordNumber,
      record.owner,
      record.description,
      ...record.notices,
      ...(record.searchableAttributes ?? []).flatMap((attribute) => [
        attribute.key,
        attribute.label,
        attribute.value,
        attribute.unit,
      ]),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function propertyMatchesQuery(property: PropertyRecord, query: string) {
  return propertyRecordSearchText(property).includes(query.trim().toLowerCase());
}
