/** Read one object field. Missing values and non-strings become an empty string. */
export function trimmedString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}
