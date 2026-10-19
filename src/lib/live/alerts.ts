/**
 * Hop-on alerts. Who hears that a room went live, and on which channel.
 *
 * The spec is explicit that SMS is never a blast to every phone on file: it
 * reaches only people who opted into live text alerts. Email and in-app reach
 * entitled members, pass holders, and vendors who have a signed-in account.
 */

export type AlertChannel = "in_app" | "email" | "sms";

/**
 * A scheduled event is announced when it is put on the calendar, and again
 * when the host actually goes live. They are separate deliveries so one does
 * not suppress the other.
 */
export type AlertKind = "scheduled" | "live";

export type AlertCandidate = {
  userId: string;
  email: string | null;
  phone: string | null;
  /** Active or trialing membership. */
  isMember: boolean;
  /** Holds an active pass for this specific event. */
  hasPass: boolean;
  /** Verified vendor with a signed-in Accountabul user. */
  isVendor: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
};

export type AlertRecipient = {
  userId: string;
  channels: AlertChannel[];
  email: string | null;
  phone: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164, the only shape we will hand to an SMS provider. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isAlertEligible(candidate: AlertCandidate) {
  return candidate.isMember || candidate.hasPass || candidate.isVendor;
}

export function emailChannelOpen(candidate: AlertCandidate) {
  return candidate.emailOptIn && Boolean(candidate.email) && EMAIL.test(candidate.email ?? "");
}

/** SMS requires an explicit opt-in *and* a well-formed number. Never inferred. */
export function smsChannelOpen(candidate: AlertCandidate) {
  return candidate.smsOptIn && Boolean(candidate.phone) && E164.test(candidate.phone ?? "");
}

export function channelsFor(candidate: AlertCandidate): AlertChannel[] {
  if (!isAlertEligible(candidate)) return [];
  const channels: AlertChannel[] = ["in_app"];
  if (emailChannelOpen(candidate)) channels.push("email");
  if (smsChannelOpen(candidate)) channels.push("sms");
  return channels;
}

export function selectAlertRecipients(candidates: readonly AlertCandidate[]): AlertRecipient[] {
  const seen = new Set<string>();
  const recipients: AlertRecipient[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.userId)) continue;
    const channels = channelsFor(candidate);
    if (channels.length === 0) continue;
    seen.add(candidate.userId);
    recipients.push({
      userId: candidate.userId,
      channels,
      email: emailChannelOpen(candidate) ? candidate.email : null,
      phone: smsChannelOpen(candidate) ? candidate.phone : null,
    });
  }
  return recipients;
}

/**
 * One delivery per person, per event, per channel, per kind - re-running go
 * live is safe, and the go-live alert still sends after a scheduled one.
 */
export function alertDedupeKey(
  eventId: string,
  userId: string,
  channel: AlertChannel,
  kind: AlertKind = "live",
) {
  return `${eventId}:${userId}:${channel}:${kind}`;
}

export function liveEventUrl(origin: string, slug: string) {
  return `${origin.replace(/\/$/, "")}/live/${encodeURIComponent(slug)}`;
}

export type HopOnMessage = { subject: string; text: string; sms: string };

/**
 * The link always opens the Accountabul event page — never a Zoom or Restream
 * guest link. "No" is just not clicking through; we do not track a decline.
 */
export function buildHopOnMessage(input: { title: string; url: string }): HopOnMessage {
  const subject = `We're live: ${input.title}`;
  const text = [
    `We're live now — ${input.title}.`,
    "",
    `Hop on? Yes: ${input.url}`,
    "",
    "If now is not a good time, no action is needed. The replay posts to the same page.",
  ].join("\n");
  const sms = `Accountabul is live: ${input.title}. Hop on? ${input.url} (Reply STOP to opt out.)`;
  return { subject, text, sms };
}

/**
 * The schedule-time announcement. It names the start time and links to the
 * same event page, so the room is already on someone radar before it opens.
 */
export function buildScheduledMessage(input: {
  title: string;
  url: string;
  startsAt: string;
}): HopOnMessage {
  const when = new Date(input.startsAt);
  const stamp = Number.isNaN(when.getTime())
    ? "soon"
    : when.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC";

  const subject = `Scheduled: ${input.title}`;
  const text = [
    `${input.title} is scheduled for ${stamp}.`,
    "",
    `Save the room: ${input.url}`,
    "",
    "We will send one more message when the host actually goes live.",
  ].join("\n");
  const sms = `Accountabul: ${input.title} is scheduled for ${stamp}. ${input.url} (Reply STOP to opt out.)`;
  return { subject, text, sms };
}

export function buildAlertMessage(
  kind: AlertKind,
  input: { title: string; url: string; startsAt?: string | null },
): HopOnMessage {
  if (kind === "scheduled" && input.startsAt) {
    return buildScheduledMessage({ title: input.title, url: input.url, startsAt: input.startsAt });
  }
  return buildHopOnMessage({ title: input.title, url: input.url });
}

export type AlertPreferencesInput = {
  emailOptIn: boolean;
  smsOptIn: boolean;
  smsPhone: string | null;
};

/**
 * Normalizes what a person submits from their settings. US ten-digit numbers
 * are accepted and prefixed with +1; everything else must already be E.164.
 * Turning SMS on without a usable number is refused rather than saved.
 */
export function normalizeAlertPreferences(input: AlertPreferencesInput): AlertPreferencesInput {
  const raw = (input.smsPhone ?? "").trim();
  let phone: string | null = null;
  if (raw) {
    const digits = raw.replace(/[^\d+]/g, "");
    const candidate = /^\d{10}$/.test(digits)
      ? `+1${digits}`
      : /^1\d{10}$/.test(digits)
        ? `+${digits}`
        : digits;
    if (!E164.test(candidate)) {
      throw new Error("Enter a mobile number like +15555550123.");
    }
    phone = candidate;
  }
  if (input.smsOptIn && !phone) {
    throw new Error("Add a mobile number to turn on text alerts.");
  }
  return {
    emailOptIn: Boolean(input.emailOptIn),
    smsOptIn: Boolean(input.smsOptIn),
    smsPhone: phone,
  };
}
