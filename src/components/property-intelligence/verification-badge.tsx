// Ported from Accountabul-LLC/property-insight-hub src/components/verification-badge.tsx.
// Import path adjusted; accountabul-final's verification.ts already has the same
// VerificationTier/verificationTiers shape, so no logic changed.

import { verificationTiers, type VerificationTier } from "@/lib/property-intelligence/verification";

export function VerificationBadge({ tier }: { tier: VerificationTier }) {
  const presentation = verificationTiers[tier];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      aria-label={`${presentation.label}. ${presentation.description}`}
      title={presentation.description}
    >
      <span aria-hidden="true">✓</span>
      {presentation.label}
    </span>
  );
}

export function VerificationLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      aria-label="Verification badge key"
    >
      <span className="font-semibold uppercase tracking-wide">Verification key</span>
      <span className="inline-flex items-center gap-1">
        <VerificationBadge tier="accountabul" />
        <span>{verificationTiers.accountabul.label}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <VerificationBadge tier="trusted-provider" />
        <span>{verificationTiers["trusted-provider"].label}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <VerificationBadge tier="both" />
        <span>{verificationTiers.both.label}</span>
      </span>
    </div>
  );
}
