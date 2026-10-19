export const TIP_MESSAGE_MAX_LENGTH = 280;
export const TIP_DISPLAY_NAME_MAX_LENGTH = 80;

export type TipSpeech = {
  displayName: string;
  message: string;
};

export function normalizeTipSpeech(input: { displayName: unknown; message: unknown }): TipSpeech {
  const displayName =
    typeof input.displayName === "string"
      ? input.displayName.normalize("NFKC").replace(/\s+/g, " ").trim()
      : "";
  const message =
    typeof input.message === "string"
      ? input.message.normalize("NFKC").replace(/\s+/g, " ").trim()
      : "";
  return { displayName, message };
}

export function assertTipSpeech(speech: TipSpeech) {
  if (!speech.displayName) throw new Error("A display name is required.");
  if (speech.displayName.length > TIP_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error("Display names must be 80 characters or fewer.");
  }
  if (!speech.message) throw new Error("A tip message is required.");
  if (speech.message.length > TIP_MESSAGE_MAX_LENGTH) {
    throw new Error("Tip messages must be 280 characters or fewer.");
  }
}

export function formatTipChatBody(input: {
  displayName: string;
  amountMinor: number;
  message: string;
  currency?: string;
}) {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: input.currency ?? "USD",
  }).format(input.amountMinor / 100);
  return `${input.displayName} tipped ${amount} — ${input.message}`;
}
