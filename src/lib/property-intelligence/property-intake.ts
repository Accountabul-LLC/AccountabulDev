// Ported from property-intelligence-app's app/lib/property-intake.ts.
// Owner-supplied intake claims are untrusted input: every enum falls back to
// "unknown" rather than rejecting the whole payload, but an out-of-range or
// non-integer number throws, so a bad figure can never be silently coerced
// into a deal calculation. Bathrooms are the one half-step field.
import type { PropertyIntakeClaims } from "./analysis-types.ts";

function boundedNumber(value: unknown, label: string, maximum: number, allowHalf = false) {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > maximum ||
    (!allowHalf && !Number.isInteger(number))
  ) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return number;
}

export function normalizePropertyIntakeClaims(
  input: unknown,
): Omit<PropertyIntakeClaims, "updatedAt"> {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const propertyUses = [
    "unknown",
    "single-family",
    "duplex",
    "triplex",
    "fourplex",
    "multi-family",
    "commercial",
    "mixed-use",
    "land",
    "other",
  ] as const;
  const occupancies = ["unknown", "owner-occupied", "tenant-occupied", "vacant"] as const;
  const conditions = ["unknown", "turnkey", "light-rehab", "moderate-rehab", "full-rehab"] as const;
  // Bracket access throughout: `value` is an index-signature record and this
  // repo enables noPropertyAccessFromIndexSignature.
  const rawNotes = value["notes"];
  const notes = typeof rawNotes === "string" ? rawNotes.replace(/\r\n/g, "\n").trim() : "";
  if (notes.length > 5000) throw new Error("Property notes must be 5,000 characters or fewer.");
  const propertyUse = value["propertyUse"] as (typeof propertyUses)[number];
  const currentOccupancy = value["currentOccupancy"] as (typeof occupancies)[number];
  const condition = value["condition"] as (typeof conditions)[number];
  return {
    propertyUse: propertyUses.includes(propertyUse) ? propertyUse : "unknown",
    bedrooms: boundedNumber(value["bedrooms"], "Bedrooms", 100),
    bathrooms: boundedNumber(value["bathrooms"], "Bathrooms", 100, true),
    interiorSquareFeet: boundedNumber(
      value["interiorSquareFeet"],
      "Interior square feet",
      10_000_000,
    ),
    currentOccupancy: occupancies.includes(currentOccupancy) ? currentOccupancy : "unknown",
    condition: conditions.includes(condition) ? condition : "unknown",
    notes,
  };
}
