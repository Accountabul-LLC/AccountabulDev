// Ported verbatim from Accountabul-LLC/property-insight-hub src/lib/property-selection.ts.

export function selectVisibleRecord<T extends { id: string }>(
  visibleRecords: T[],
  selectedId: string,
) {
  return visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0];
}
