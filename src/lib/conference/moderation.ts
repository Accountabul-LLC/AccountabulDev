export const PAID_COMMENT_PRICE_MINOR = 100;
export const PAID_COMMENT_CURRENCY = "USD";
export const PAID_COMMENT_MAX_LENGTH = 500;

export type DeterministicScreeningResult = {
  allowed: boolean;
  reasons: string[];
};

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /https?:\/\/\S+/gi, reason: "links" },
  { pattern: /\b(?:buy now|free money|guaranteed returns?)\b/gi, reason: "spam" },
  { pattern: /\b(?:kill yourself|kys)\b/gi, reason: "self-harm encouragement" },
  { pattern: /\b(?:i will kill|i'm going to kill)\b/gi, reason: "threat" },
];

export function screenDeterministically(body: string): DeterministicScreeningResult {
  const normalized = body.normalize("NFKC").replace(/\s+/g, " ").trim();
  const reasons: string[] = [];

  if (!normalized) reasons.push("empty");
  if (normalized.length > PAID_COMMENT_MAX_LENGTH) reasons.push("too_long");
  for (const rule of BLOCKED_PATTERNS) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(normalized)) reasons.push(rule.reason);
  }

  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export async function sha256Text(body: string) {
  const normalized = body.normalize("NFKC");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canCreatePaidCommentCheckout(input: {
  status: string;
  bodySha256: string;
  approvedBodySha256: string | null;
  expiresAt: string | null;
  now?: Date;
}) {
  const hashesMatch = input.approvedBodySha256 === input.bodySha256;
  if (!hashesMatch) return false;
  if (input.status !== "approved" && input.status !== "payment_failed") return false;
  return !input.expiresAt || new Date(input.expiresAt) > (input.now ?? new Date());
}

export function isApprovedPaidCommentPrice(amountMinor: number, currency: string) {
  return (
    amountMinor === PAID_COMMENT_PRICE_MINOR &&
    currency.trim().toUpperCase() === PAID_COMMENT_CURRENCY
  );
}
