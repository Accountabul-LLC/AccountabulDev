export type VerificationTier = "accountabul" | "trusted-provider" | "both";

export const verificationTiers: Record<VerificationTier, { label: string; description: string }> = {
  accountabul: {
    label: "Accountabul verified",
    description: "Accountabul independently reviewed the supporting evidence for this fact.",
  },
  "trusted-provider": {
    label: "Trusted provider",
    description:
      "A connected public or trusted data provider published this fact; Accountabul has not independently verified it.",
  },
  both: {
    label: "Verified by both",
    description:
      "A trusted provider published this fact and Accountabul independently confirmed the supporting evidence.",
  },
};

export function verificationTierForRecord(status: string | null | undefined): VerificationTier {
  if (status === "accountabul-and-provider-verified") return "both";
  if (status === "accountabul-verified-owner-record") return "accountabul";
  return "trusted-provider";
}
