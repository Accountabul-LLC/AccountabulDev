import {
  buildAlertMessage,
  liveEventUrl,
  selectAlertRecipients,
  type AlertCandidate,
  type AlertChannel,
  type AlertKind,
} from "@/lib/live/alerts";

/**
 * Hop-on alert dispatch.
 *
 * Transports are plain REST so no provider SDK is pulled in, and an
 * unconfigured transport degrades to "suppressed" rather than throwing - going
 * live must never fail because an email key is missing.
 */

type PreferenceRow = {
  user_id: string;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  sms_phone: string | null;
};

type DeliveryStatus = "queued" | "sent" | "failed" | "suppressed";

type DeliveryInsert = {
  event_id: string;
  user_id: string;
  channel: AlertChannel;
  kind: AlertKind;
  status: DeliveryStatus;
  sent_at?: string | null;
};

type DeliveryRow = { user_id: string; channel: AlertChannel };

/**
 * The alert tables ship in 20260916120000_accountabul_live_alerts.sql. The
 * generated Supabase types come from the deployed schema, so until that
 * migration is applied and types are regenerated these two tables are reached
 * through a narrow, deliberately local cast instead of the Database type.
 */
type AlertTables = {
  from(table: string): {
    select(columns: string): Promise<{ data: PreferenceRow[] | null; error: unknown }>;
    insert(rows: DeliveryInsert[]): {
      select(columns: string): Promise<{ data: DeliveryRow[] | null; error: unknown }>;
    };
  };
};

async function alertTables(): Promise<AlertTables> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AlertTables;
}

async function sendEmail(to: string, subject: string, text: string) {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["LIVE_ALERTS_FROM_EMAIL"];
  if (!apiKey || !from) {
    return { status: "suppressed" as const, detail: "Email is not configured." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) {
    return { status: "failed" as const, detail: `Email provider returned ${response.status}.` };
  }
  return { status: "sent" as const, detail: null };
}

async function sendSms(to: string, body: string) {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!sid || !token || !from) {
    return { status: "suppressed" as const, detail: "SMS is not configured." };
  }

  const credentials = Buffer.from(`${sid}:${token}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  );
  if (!response.ok) {
    return { status: "failed" as const, detail: `SMS provider returned ${response.status}.` };
  }
  return { status: "sent" as const, detail: null };
}

/**
 * Loads everyone entitled to hear about this event and fans the alert out.
 *
 * The unique index on (event_id, user_id, channel) is what makes this safe to
 * call more than once: rows that already exist are rejected by the insert, so a
 * repeated go live cannot double-alert anyone.
 */
export async function dispatchHopOnAlerts(input: {
  eventId: string;
  slug: string;
  title: string;
  origin: string;
  /** "live" when the host goes live, "scheduled" for the calendar announcement. */
  kind?: AlertKind;
  startsAt?: string | null;
}) {
  const kind: AlertKind = input.kind ?? "live";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();

  const [members, passes, vendors] = await Promise.all([
    supabaseAdmin
      .from("membership_subscriptions")
      .select("user_id, status, current_period_end")
      .in("status", ["active", "trialing"])
      .gt("current_period_end", nowIso),
    supabaseAdmin
      .from("event_passes")
      .select("user_id")
      .eq("event_id", input.eventId)
      .eq("status", "active")
      .gt("expires_at", nowIso),
    supabaseAdmin.from("business_members").select("user_id"),
  ]);

  const tables = await alertTables();
  const preferences = await tables
    .from("live_alert_preferences")
    .select("user_id, email_opt_in, sms_opt_in, sms_phone");

  const preferenceByUser = new Map<string, PreferenceRow>();
  for (const row of preferences.data ?? []) preferenceByUser.set(row.user_id, row);

  const present = (id: string | null): id is string => Boolean(id);
  const memberIds = new Set((members.data ?? []).map((row) => row.user_id).filter(present));
  const passIds = new Set((passes.data ?? []).map((row) => row.user_id).filter(present));
  const vendorIds = new Set((vendors.data ?? []).map((row) => row.user_id).filter(present));

  const candidateIds = new Set<string>([...memberIds, ...passIds, ...vendorIds]);
  if (candidateIds.size === 0) return { recipients: 0, sent: 0 };

  // Email addresses come from auth, not from the public profile table.
  const emailByUser = new Map<string, string | null>();
  for (const userId of candidateIds) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    emailByUser.set(userId, data.user?.email ?? null);
  }

  const candidates: AlertCandidate[] = [...candidateIds].map((userId) => {
    const preference = preferenceByUser.get(userId);
    return {
      userId,
      email: emailByUser.get(userId) ?? null,
      phone: preference?.sms_phone ?? null,
      isMember: memberIds.has(userId),
      hasPass: passIds.has(userId),
      isVendor: vendorIds.has(userId),
      // Absent preferences mean email on, SMS off - the documented default.
      emailOptIn: preference?.email_opt_in ?? true,
      smsOptIn: preference?.sms_opt_in ?? false,
    };
  });

  const recipients = selectAlertRecipients(candidates);
  const message = buildAlertMessage(kind, {
    title: input.title,
    url: liveEventUrl(input.origin, input.slug),
    startsAt: input.startsAt ?? null,
  });

  const rows: DeliveryInsert[] = [];
  for (const recipient of recipients) {
    for (const channel of recipient.channels) {
      // The in-app banner is a read of this ledger, so queueing is the delivery.
      const queued: DeliveryInsert =
        channel === "in_app"
          ? {
              event_id: input.eventId,
              user_id: recipient.userId,
              channel,
              kind,
              status: "sent",
              sent_at: nowIso,
            }
          : { event_id: input.eventId, user_id: recipient.userId, channel, kind, status: "queued" };
      rows.push(queued);
    }
  }
  if (rows.length === 0) return { recipients: 0, sent: 0 };

  // Only rows that win the unique constraint are ours to send.
  const inserted = await tables
    .from("live_alert_deliveries")
    .insert(rows)
    .select("user_id, channel");
  if (inserted.error) throw inserted.error;

  const claimed = new Set((inserted.data ?? []).map((row) => `${row.user_id}:${row.channel}`));

  let sent = 0;
  for (const recipient of recipients) {
    for (const channel of recipient.channels) {
      if (channel === "in_app") continue;
      if (!claimed.has(`${recipient.userId}:${channel}`)) continue;
      const result =
        channel === "email" && recipient.email
          ? await sendEmail(recipient.email, message.subject, message.text)
          : channel === "sms" && recipient.phone
            ? await sendSms(recipient.phone, message.sms)
            : { status: "suppressed" as const, detail: "No address on file." };
      if (result.status === "sent") sent += 1;
    }
  }

  return { recipients: recipients.length, sent };
}
