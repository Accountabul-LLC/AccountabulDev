export const BUSINESS_REVIEW_DECISIONS = [
  "approve",
  "request_changes",
  "reject",
  "suspend",
] as const;

export type BusinessReviewDecision = (typeof BUSINESS_REVIEW_DECISIONS)[number];

export type BusinessApprovalState = {
  profile_status: string;
  verification_status: string;
  public_profile_enabled: boolean;
  published_at?: string | null;
};

type BusinessReviewPatch = {
  profile_status: "draft" | "published" | "rejected" | "suspended";
  verification_status: "unverified" | "verified" | "rejected" | "expired";
  public_profile_enabled: boolean;
  published_at: string | null;
};

export function isBusinessReviewDecision(value: string): value is BusinessReviewDecision {
  return BUSINESS_REVIEW_DECISIONS.includes(value as BusinessReviewDecision);
}

export function businessReviewRequiresNote(decision: BusinessReviewDecision) {
  return decision !== "approve";
}

export function isBusinessApproved(business: BusinessApprovalState) {
  return (
    business.profile_status === "published" &&
    business.verification_status === "verified" &&
    business.public_profile_enabled
  );
}

export function needsBusinessReview(business: BusinessApprovalState) {
  return (
    business.profile_status === "pending_review" ||
    business.verification_status === "pending" ||
    business.verification_status === "in_review" ||
    (business.profile_status === "published" && !isBusinessApproved(business))
  );
}

export function isBusinessDecisionCurrent(
  business: BusinessApprovalState,
  decision: BusinessReviewDecision,
) {
  switch (decision) {
    case "approve":
      return isBusinessApproved(business);
    case "request_changes":
      return (
        business.profile_status === "draft" &&
        business.verification_status === "unverified" &&
        !business.public_profile_enabled
      );
    case "reject":
      return (
        business.profile_status === "rejected" &&
        business.verification_status === "rejected" &&
        !business.public_profile_enabled
      );
    case "suspend":
      return (
        business.profile_status === "suspended" &&
        business.verification_status === "expired" &&
        !business.public_profile_enabled
      );
  }
}

export function planBusinessReviewDecision(
  decision: BusinessReviewDecision,
  now: string,
): BusinessReviewPatch {
  switch (decision) {
    case "approve":
      return {
        profile_status: "published",
        verification_status: "verified",
        public_profile_enabled: true,
        published_at: now,
      };
    case "request_changes":
      return {
        profile_status: "draft",
        verification_status: "unverified",
        public_profile_enabled: false,
        published_at: null,
      };
    case "reject":
      return {
        profile_status: "rejected",
        verification_status: "rejected",
        public_profile_enabled: false,
        published_at: null,
      };
    case "suspend":
      return {
        profile_status: "suspended",
        verification_status: "expired",
        public_profile_enabled: false,
        published_at: null,
      };
  }
}
