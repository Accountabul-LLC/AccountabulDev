import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type OpsDataClient = SupabaseClient<Database>;

let localClient: OpsDataClient | undefined;
let localClientPromise: Promise<OpsDataClient> | undefined;

/**
 * Operations routes need a privileged Supabase client. Prefer the service-role
 * key. In local development only, fall back to a seeded admin session so the
 * Ops Hub can review businesses when the dashboard key is not in .env.
 */
export async function getOpsDataClient(): Promise<OpsDataClient> {
  if (process.env["SUPABASE_SERVICE_ROLE_KEY"]) return supabaseAdmin;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY");
  }
  if (localClient) return localClient;
  if (!localClientPromise) localClientPromise = createLocalAdminClient();
  localClient = await localClientPromise;
  return localClient;
}

async function createLocalAdminClient(): Promise<OpsDataClient> {
  const url = process.env["SUPABASE_URL"];
  const publishable = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const email = process.env["OPS_LOCAL_DATA_EMAIL"]?.trim();
  const password = process.env["OPS_LOCAL_DATA_PASSWORD"];
  if (!url || !publishable || !email || !password) {
    throw new Error("Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY");
  }

  const authClient = createClient<Database>(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new Error("Local operations data login failed.");
  }

  return createClient<Database>(url, publishable, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}
