export const INQUIRY_LIMITS = {
  contactName: 120,
  contactEmail: 254,
  contactPhone: 40,
  message: 2_000,
} as const;

export type InquiryDraft = {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  message: string;
};

export type NormalizedInquiry = {
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  message: string;
};

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize and bound public inquiry data before it reaches Supabase. */
export function normalizeInquiryInput(input: InquiryDraft): NormalizedInquiry {
  const contact_name = input.contact_name.trim();
  const contact_email = input.contact_email.trim();
  const contact_phone = input.contact_phone.trim();
  const message = input.message.trim();

  if (!contact_name || !contact_email || !message) {
    throw new Error("Name, email, and message are required.");
  }
  if (contact_name.length > INQUIRY_LIMITS.contactName) {
    throw new Error(`Name may not exceed ${INQUIRY_LIMITS.contactName} characters.`);
  }
  if (contact_email.length > INQUIRY_LIMITS.contactEmail || !SIMPLE_EMAIL.test(contact_email)) {
    throw new Error("Enter a valid email address.");
  }
  if (contact_phone.length > INQUIRY_LIMITS.contactPhone) {
    throw new Error(`Phone may not exceed ${INQUIRY_LIMITS.contactPhone} characters.`);
  }
  if (message.length > INQUIRY_LIMITS.message) {
    throw new Error(
      `Message may not exceed ${INQUIRY_LIMITS.message.toLocaleString()} characters.`,
    );
  }

  return {
    contact_name,
    contact_email,
    contact_phone: contact_phone || null,
    message,
  };
}
