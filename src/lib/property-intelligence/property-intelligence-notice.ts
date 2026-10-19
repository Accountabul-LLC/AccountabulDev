// Ported from property-intelligence-app's app/lib/property-intelligence-notice.ts.
// The "BEFORE AN OFFER" warning is account-level and must be reviewed three
// separate times before a user may turn it off; the count is server-persisted
// in the source app, never browser storage, so this module holds only the
// pure shape and the review-number derivation.
export const REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS = 3;

export type PropertyIntelligenceNoticePreference = {
  acknowledgmentCount: number;
  requiredAcknowledgments: number;
  canDismiss: boolean;
  dismissed: boolean;
};

export type PropertyIntelligenceNoticeAction = "acknowledge" | "acknowledge-and-dismiss";

export function defaultPropertyIntelligenceNoticePreference(): PropertyIntelligenceNoticePreference {
  return {
    acknowledgmentCount: 0,
    requiredAcknowledgments: REQUIRED_PROPERTY_INTELLIGENCE_ACKNOWLEDGMENTS,
    canDismiss: false,
    dismissed: false,
  };
}

export function propertyIntelligenceNoticeReviewNumber(
  preference: PropertyIntelligenceNoticePreference,
) {
  return Math.min(preference.acknowledgmentCount + 1, preference.requiredAcknowledgments);
}
