export const CONTENT_REVIEW_DECISIONS = [
  "approve",
  "request_changes",
  "reject",
  "suspend",
] as const;

export type ContentReviewDecision = (typeof CONTENT_REVIEW_DECISIONS)[number];

export const CREDENTIAL_REVIEW_DECISIONS = ["approve", "reject"] as const;

export type CredentialReviewDecision = (typeof CREDENTIAL_REVIEW_DECISIONS)[number];

export function isContentReviewDecision(value: string): value is ContentReviewDecision {
  return CONTENT_REVIEW_DECISIONS.some((decision) => decision === value);
}

export function isCredentialReviewDecision(value: string): value is CredentialReviewDecision {
  return CREDENTIAL_REVIEW_DECISIONS.some((decision) => decision === value);
}

export function contentReviewRequiresNote(decision: ContentReviewDecision) {
  return decision !== "approve";
}

export function credentialReviewRequiresNote(decision: CredentialReviewDecision) {
  return decision === "reject";
}
