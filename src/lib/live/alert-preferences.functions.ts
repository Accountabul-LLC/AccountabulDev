import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeAlertPreferences, type AlertPreferencesInput } from "@/lib/live/alerts";

type PreferenceRow = {
  email_opt_in: boolean;
  sms_opt_in: boolean;
  sms_phone: string | null;
};

/**
 * live_alert_preferences ships in 20260916120000_accountabul_live_alerts.sql and
 * is not in the generated types until they are regenerated. Queries run through
 * the caller's RLS-scoped client, so a person can only ever read or write
 * their own row.
 */
type PreferenceTable = {
  from(table: "live_alert_preferences"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{ data: PreferenceRow | null; error: unknown }>;
      };
    };
    upsert(
      row: PreferenceRow & { user_id: string; updated_at: string },
      options: { onConflict: string },
    ): Promise<{ error: unknown }>;
  };
};

export const getAlertPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AlertPreferencesInput> => {
    const db = context.supabase as unknown as PreferenceTable;
    const { data, error } = await db
      .from("live_alert_preferences")
      .select("email_opt_in, sms_opt_in, sms_phone")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    // No row yet means the documented defaults: email on, SMS off.
    return {
      emailOptIn: data?.email_opt_in ?? true,
      smsOptIn: data?.sms_opt_in ?? false,
      smsPhone: data?.sms_phone ?? null,
    };
  });

export const saveAlertPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: AlertPreferencesInput) => normalizeAlertPreferences(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as PreferenceTable;
    const { error } = await db.from("live_alert_preferences").upsert(
      {
        user_id: context.userId,
        email_opt_in: data.emailOptIn,
        sms_opt_in: data.smsOptIn,
        sms_phone: data.smsPhone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return data;
  });
