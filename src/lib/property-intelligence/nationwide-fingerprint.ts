// Ported verbatim from property-intelligence-app's app/lib/nationwide-fingerprint.ts
// (Slice 1 of the nationwide geography catalog port,
// docs/PROPERTY_INTELLIGENCE_PORT_PLAN.md). Deterministic, key-sorted JSON
// serialization + SHA-256, used to fingerprint the geography catalog and
// each of its rows so an import is replay-safe and any drift is detectable.
// Uses only Web Crypto (`crypto.subtle`), available in both Node and this
// repo's server-function runtime, so no `node:crypto` import is required.
export function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("fingerprint input contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export async function stableSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableSerialize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
