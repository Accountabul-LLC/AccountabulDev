export type AccountType = "individual" | "business";

const INTENT_KEY = "accountabul:signup-intent";

export type SignupIntent = {
  accountType: AccountType;
  businessName?: string;
};

/** Persist the signup choice so it survives an OAuth round trip. */
export function rememberSignupIntent(intent: SignupIntent) {
  try {
    window.localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // storage unavailable — onboarding still collects these details
  }
}

/** Read (and clear) the stored signup choice. */
export function takeSignupIntent(): SignupIntent | null {
  try {
    const raw = window.localStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(INTENT_KEY);
    const parsed = JSON.parse(raw) as SignupIntent;
    if (parsed.accountType !== "individual" && parsed.accountType !== "business") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function peekSignupIntent(): SignupIntent | null {
  try {
    const raw = window.localStorage.getItem(INTENT_KEY);
    return raw ? (JSON.parse(raw) as SignupIntent) : null;
  } catch {
    return null;
  }
}

const RETURN_TO_KEY = "accountabul:return-to";
const RETURN_TO_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** Same-origin app paths only; anything else could send someone off-site. */
export function isSafeReturnPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 512
  );
}

/**
 * Remember where someone was when they chose to create an account, so the end
 * of signup and onboarding brings them back there (for example, to the live
 * room where their unsent chat message is waiting) instead of the dashboard.
 */
export function rememberReturnTo(path: string, now = Date.now()) {
  if (!isSafeReturnPath(path)) return;
  try {
    window.localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ path, savedAt: now }));
  } catch {
    // storage unavailable — they land on the dashboard instead
  }
}

/** Read (and clear) the remembered path, if it is recent and safe. */
export function takeReturnTo(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(RETURN_TO_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(RETURN_TO_KEY);
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > RETURN_TO_MAX_AGE_MS) {
      return null;
    }
    return isSafeReturnPath(parsed.path) ? parsed.path : null;
  } catch {
    return null;
  }
}

export function onboardingPathFor(accountType: AccountType) {
  return accountType === "business" ? "/onboarding/business" : "/onboarding/individual";
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Convert free text into a valid handle (lowercase letters, numbers, dashes). */
export function normalizeHandle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function isValidHandle(handle: string) {
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(handle);
}
