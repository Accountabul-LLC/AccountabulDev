/**
 * Automated safeguards for community chat.
 *
 * Chat is publish-first. Nothing in this file decides whether a message may be
 * published — every accepted message is published immediately. These rules run
 * afterwards and decide only whether a published message should be flagged for
 * staff, or hidden straight away because it is clearly harmful.
 *
 * The only checks that ever stop a send are cheap, account- or behaviour-level
 * ones that do not inspect meaning: rate limits, exact-duplicate flooding, and
 * an active mute or ban.
 *
 * Paid on-air comments use the separate, deliberately strict filter in
 * src/lib/conference/moderation.ts. Do not merge the two.
 */

export type FlagCategory =
  | "spam"
  | "harassment"
  | "hate"
  | "sexual"
  | "violence"
  | "self_harm"
  | "illegal"
  | "malicious_link"
  | "flooding"
  | "other";

export type RestrictionKind = "mute" | "room_removal" | "ban";

export type Severity = "low" | "high";

export type SafeguardSignal = {
  category: FlagCategory;
  severity: Severity;
  /** Machine-readable rule or provider category that produced the signal. */
  rule: string;
};

export type AutomatedOutcome = "none" | "flag" | "hide";

/** Same message, same member, same room, inside this window: refused as flooding. */
export const DUPLICATE_WINDOW_MS = 30_000;
/** Distinct member reports that hide a message until staff look at it. */
export const REPORT_AUTO_HIDE_THRESHOLD = 3;
/** Reports a single member may file per window, across all rooms. */
export const REPORT_RATE_LIMIT = 10;
export const REPORT_RATE_WINDOW_MS = 10 * 60_000;
export const REPORT_DETAIL_MAX_LENGTH = 500;

/** Categories a member can choose when reporting, in the order they are shown. */
export const REPORT_CATEGORIES: { value: FlagCategory; label: string }[] = [
  { value: "spam", label: "Spam or scam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hateful conduct" },
  { value: "violence", label: "Threats or violence" },
  { value: "sexual", label: "Sexual content" },
  { value: "self_harm", label: "Self-harm" },
  { value: "illegal", label: "Illegal activity or fraud" },
  { value: "malicious_link", label: "Harmful link" },
  { value: "other", label: "Something else" },
];

export function isFlagCategory(value: string): value is FlagCategory {
  return REPORT_CATEGORIES.some((entry) => entry.value === value) || value === "flooding";
}

export function flagCategoryLabel(category: FlagCategory) {
  if (category === "flooding") return "Flooding";
  return REPORT_CATEGORIES.find((entry) => entry.value === category)?.label ?? "Other";
}

/* ---------------------------------------------------------------------------
 * Deterministic rules
 * ------------------------------------------------------------------------ */

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Link shorteners hide the destination, which is how malicious links travel. */
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "rb.gy",
  "tiny.cc",
]);

const RISKY_FILE_EXTENSION = /\.(?:exe|scr|bat|cmd|msi|apk|jar|vbs|ps1|dmg|iso)(?:[?#]|$)/i;

const SPAM_PHRASES =
  /\b(?:guaranteed (?:returns?|profits?|income)|free money|double your (?:money|crypto|bitcoin)|crypto giveaway|send (?:me )?(?:btc|eth|usdt)|(?:dm|message|text) me on (?:telegram|whatsapp|signal)|make \$?\d[\d,]* (?:a|per) (?:day|week) from home|click (?:here|the link) (?:now|fast))\b/i;

const THREAT_PHRASES =
  /\b(?:i(?:'m| am)? (?:going to|gonna|will) (?:kill|shoot|stab|hurt) (?:you|u|him|her|them)|i know where you live|you(?:'re| are) (?:dead|going to die))\b/i;

const SELF_HARM_ENCOURAGEMENT = /\b(?:kill yourself|kys|go die)\b/i;

/** Classify one URL. Ordinary https links to real sites are normal in chat. */
export function assessLink(raw: string): SafeguardSignal | null {
  let url: URL;
  try {
    url = new URL(raw.startsWith("www.") ? `https://${raw}` : raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORTENER_HOSTS.has(host)) {
    return { category: "malicious_link", severity: "low", rule: "link_shortener" };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    return { category: "malicious_link", severity: "low", rule: "link_ip_address" };
  }
  if (host.split(".").some((label) => label.startsWith("xn--"))) {
    return { category: "malicious_link", severity: "low", rule: "link_punycode" };
  }
  if (url.username || url.password) {
    return { category: "malicious_link", severity: "high", rule: "link_embedded_credentials" };
  }
  if (RISKY_FILE_EXTENSION.test(url.pathname)) {
    return { category: "malicious_link", severity: "high", rule: "link_executable_download" };
  }
  return null;
}

/** Deterministic, local, instant. Runs after publication. */
export function assessMessageText(body: string): SafeguardSignal[] {
  const text = body.normalize("NFKC");
  const signals: SafeguardSignal[] = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    const signal = assessLink(match[0]);
    if (signal) signals.push(signal);
  }
  if (SPAM_PHRASES.test(text)) {
    signals.push({ category: "spam", severity: "low", rule: "spam_phrase" });
  }
  if (THREAT_PHRASES.test(text)) {
    signals.push({ category: "violence", severity: "high", rule: "threat_phrase" });
  }
  if (SELF_HARM_ENCOURAGEMENT.test(text)) {
    signals.push({ category: "self_harm", severity: "high", rule: "self_harm_encouragement" });
  }
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length >= 30 && letters === letters.toUpperCase()) {
    signals.push({ category: "spam", severity: "low", rule: "all_caps" });
  }
  if (/(.)\1{14,}/u.test(text)) {
    signals.push({ category: "spam", severity: "low", rule: "repeated_characters" });
  }
  return dedupeSignals(signals);
}

/* ---------------------------------------------------------------------------
 * Moderation provider
 * ------------------------------------------------------------------------ */

/**
 * Provider categories severe enough to hide immediately. Everything else the
 * provider flags becomes a low-severity flag and stays visible for staff.
 */
const HIGH_SEVERITY_PROVIDER_CATEGORIES = new Set([
  "sexual/minors",
  "hate/threatening",
  "harassment/threatening",
  "violence/graphic",
  "self-harm/intent",
  "self-harm/instructions",
  "illicit/violent",
]);

function providerCategory(name: string): FlagCategory {
  const root = name.split("/")[0];
  switch (root) {
    case "harassment":
      return "harassment";
    case "hate":
      return "hate";
    case "sexual":
      return "sexual";
    case "violence":
      return "violence";
    case "self-harm":
      return "self_harm";
    case "illicit":
      return "illegal";
    default:
      return "other";
  }
}

/**
 * Map a provider result to signals. An unavailable provider produces no
 * signals: a provider outage never flags or hides ordinary conversation.
 */
export function providerSignals(result: {
  provider: "deterministic" | "openai" | "unavailable";
  reasons: string[];
}): SafeguardSignal[] {
  if (result.provider !== "openai") return [];
  return dedupeSignals(
    result.reasons.map((reason) => ({
      category: providerCategory(reason),
      severity: HIGH_SEVERITY_PROVIDER_CATEGORIES.has(reason) ? "high" : "low",
      rule: `provider:${reason}`,
    })),
  );
}

/* ---------------------------------------------------------------------------
 * Decisions
 * ------------------------------------------------------------------------ */

/** No signals: nothing happens. Only low signals: flag. Any high signal: hide. */
export function decideAutomatedOutcome(signals: SafeguardSignal[]): AutomatedOutcome {
  if (signals.length === 0) return "none";
  return signals.some((signal) => signal.severity === "high") ? "hide" : "flag";
}

/** The category a flag is filed under: the most severe signal wins. */
export function primaryCategory(signals: SafeguardSignal[]): FlagCategory {
  const high = signals.find((signal) => signal.severity === "high");
  return (high ?? signals[0])?.category ?? "other";
}

export function shouldAutoHideFromReports(distinctReporters: number) {
  return distinctReporters >= REPORT_AUTO_HIDE_THRESHOLD;
}

function dedupeSignals(signals: SafeguardSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.rule)) return false;
    seen.add(signal.rule);
    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Restrictions
 * ------------------------------------------------------------------------ */

export type ActiveRestriction = {
  kind: RestrictionKind;
  reason: string;
  expires_at: string | null;
};

/** Every active restriction stops posting; only ban and room removal stop reading. */
export function restrictionBlocksReading(kind: RestrictionKind) {
  return kind !== "mute";
}

/** What a restricted member is told. Never reveals who acted. */
export function describeRestriction(restriction: ActiveRestriction, now = new Date()) {
  const until = restriction.expires_at ? new Date(restriction.expires_at) : null;
  const when =
    until && until > now
      ? ` until ${new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(until)}`
      : "";
  switch (restriction.kind) {
    case "mute":
      return `You can read this room but can't post${when}. This follows a Chat Policy review.`;
    case "room_removal":
      return `You no longer have access to this room${when}.`;
    case "ban":
      return `Your chat access has been suspended${when} for violating the Chat Policy.`;
  }
}

/** Preset mute lengths offered to staff. */
export const MUTE_DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 hour" },
  { minutes: 24 * 60, label: "24 hours" },
  { minutes: 7 * 24 * 60, label: "7 days" },
  { minutes: 30 * 24 * 60, label: "30 days" },
];
