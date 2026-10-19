// Ported from Accountabul-LLC/property-insight-hub src/lib/address-display.ts (verbatim; no
// accountabul-final-specific dependencies).

const directions = new Map([
  ["N", "North"],
  ["S", "South"],
  ["E", "East"],
  ["W", "West"],
  ["NE", "Northeast"],
  ["NW", "Northwest"],
  ["SE", "Southeast"],
  ["SW", "Southwest"],
]);

const suffixes = new Map([
  ["ALY", "Alley"],
  ["ALLEY", "Alley"],
  ["AV", "Avenue"],
  ["AVE", "Avenue"],
  ["AVENUE", "Avenue"],
  ["BLVD", "Boulevard"],
  ["BOULEVARD", "Boulevard"],
  ["CIR", "Circle"],
  ["CIRCLE", "Circle"],
  ["CT", "Court"],
  ["COURT", "Court"],
  ["DR", "Drive"],
  ["DRIVE", "Drive"],
  ["HWY", "Highway"],
  ["HIGHWAY", "Highway"],
  ["LN", "Lane"],
  ["LANE", "Lane"],
  ["PKWY", "Parkway"],
  ["PARKWAY", "Parkway"],
  ["PL", "Place"],
  ["PLACE", "Place"],
  ["RD", "Road"],
  ["ROAD", "Road"],
  ["ST", "Street"],
  ["STREET", "Street"],
  ["TER", "Terrace"],
  ["TERRACE", "Terrace"],
  ["WAY", "Way"],
]);

const unitWords = new Map([
  ["APT", "Apt"],
  ["APARTMENT", "Apt"],
  ["BLDG", "Building"],
  ["BUILDING", "Building"],
  ["FL", "Floor"],
  ["FLOOR", "Floor"],
  ["STE", "Suite"],
  ["SUITE", "Suite"],
  ["UNIT", "Unit"],
]);

function wordCase(value: string) {
  if (/^\d+(ST|ND|RD|TH)$/i.test(value))
    return value.toLowerCase().replace(/^\d+/, (digits) => digits);
  if (/^\d+[A-Z]$/i.test(value)) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Title-cases a raw record address ("123 MAFFITT AV" -> "123 Maffitt Avenue"). */
export function formatAddress(value: string | null | undefined) {
  if (!value?.trim()) return "Address not published";
  const [street, ...locality] = value.replace(/\s+/g, " ").trim().split(",");
  const tokens = (street ?? "").match(/[A-Za-z0-9'-]+|#/g) ?? [];
  const formatted = tokens
    .map((token, index) => {
      const upper = token.toUpperCase();
      if (directions.has(upper) && index > 0) return directions.get(upper)!;
      if (suffixes.has(upper)) return suffixes.get(upper)!;
      if (unitWords.has(upper)) return unitWords.get(upper)!;
      return wordCase(token);
    })
    .join(" ");
  const tail = locality
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/).map(wordCase).join(" "))
    .join(", ");
  return tail ? `${formatted}, ${tail}` : formatted;
}
