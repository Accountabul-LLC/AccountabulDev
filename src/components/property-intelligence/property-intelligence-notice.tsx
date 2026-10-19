// Ported from Accountabul-LLC/property-intelligence-app's
// property-intelligence-notice.tsx.
//
// The notice is the boundary statement shown before anyone relies on
// Property Intelligence for a decision. Its behaviour is deliberately
// awkward: it cannot be permanently dismissed until the third separate
// acknowledgment, so a user cannot click past it once and never see the
// limitations again.
//
// That rule is NOT enforced here. It lives in the server module and is
// repeated as a table check constraint; this component only reflects the
// state the server reports and sends an action back. A component-side gate
// would be trivially bypassed, so the UI treats `canDismiss` as something it
// is told, never something it decides.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import {
  defaultPropertyIntelligenceNoticePreference,
  propertyIntelligenceNoticeReviewNumber,
  type PropertyIntelligenceNoticeAction,
  type PropertyIntelligenceNoticePreference,
} from "@/lib/property-intelligence/property-intelligence-notice";
import {
  acknowledgePropertyIntelligenceNotice,
  getPropertyIntelligenceNotice,
} from "@/lib/property-intelligence/property-intake-notice.functions";

const NEXT_CHECKS = [
  "Confirm title and any liens with a title company or attorney.",
  "Inspect the property, or have it inspected, before committing funds.",
  "Verify payoff, redemption and auction amounts with the issuing agency.",
  "Check zoning, occupancy and code compliance with the municipality.",
];

export function PropertyIntelligenceNotice() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const getNotice = useServerFn(getPropertyIntelligenceNotice);
  const acknowledge = useServerFn(acknowledgePropertyIntelligenceNotice);

  const { data: preference } = useQuery<PropertyIntelligenceNoticePreference>({
    queryKey: ["property-intelligence-notice"],
    queryFn: () => getNotice(),
  });

  const mutation = useMutation({
    mutationFn: (action: PropertyIntelligenceNoticeAction) => acknowledge({ data: { action } }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["property-intelligence-notice"] });
    },
    onError: (mutationError: unknown) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "That acknowledgment could not be saved.",
      );
    },
  });

  const current = preference ?? defaultPropertyIntelligenceNoticePreference();
  if (current.dismissed) return null;

  const reviewNumber = propertyIntelligenceNoticeReviewNumber(current);
  const requiredReviewsComplete = current.acknowledgmentCount >= current.requiredAcknowledgments;
  // Reported by the server, never decided here.
  const canDismissNow = current.canDismiss;
  const progress = Math.min(100, (reviewNumber / current.requiredAcknowledgments) * 100);

  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/30"
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="property-intelligence-notice-title"
      aria-describedby="property-intelligence-notice-description"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Before an offer
      </p>
      <h2 id="property-intelligence-notice-title" className="mt-1 text-base font-semibold">
        Read this before relying on Property Intelligence
      </h2>
      <p id="property-intelligence-notice-description" className="mt-2 text-muted-foreground">
        Property Intelligence organizes provider-published records and Accountabul-reviewed
        evidence. It does not establish clear title, market value, physical condition, legal
        compliance, final payoff amounts, or whether you should purchase the property.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
        {NEXT_CHECKS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3 font-semibold">
        This is decision-support information — not an appraisal, inspection, title opinion, legal
        opinion, or recommendation to buy.
      </p>

      <div className="mt-4">
        <div
          className="h-1.5 w-full overflow-hidden rounded bg-amber-200 dark:bg-amber-900"
          role="progressbar"
          aria-valuenow={reviewNumber}
          aria-valuemin={0}
          aria-valuemax={current.requiredAcknowledgments}
        >
          <div className="h-full bg-amber-600" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1 font-medium">
          {requiredReviewsComplete
            ? "Three required reviews complete"
            : `Required review ${reviewNumber} of ${current.requiredAcknowledgments}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {canDismissNow
            ? "You may now turn off future reminders for this Accountabul account."
            : "The permanent dismissal option appears on your third review."}
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => mutation.mutate("acknowledge")}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? "Saving acknowledgment…"
            : requiredReviewsComplete
              ? "Okay, close"
              : `Okay, I understand (${reviewNumber} of ${current.requiredAcknowledgments})`}
        </Button>
        {canDismissNow ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => mutation.mutate("acknowledge-and-dismiss")}
            disabled={mutation.isPending}
          >
            I understand — don&apos;t show this again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default PropertyIntelligenceNotice;
