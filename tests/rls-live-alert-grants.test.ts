import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const grantLock = readFileSync(
  new URL("../supabase/migrations/20260919100000_rls_live_alert_grant_lock.sql", import.meta.url),
  "utf8",
);
const defaultLock = readFileSync(
  new URL(
    "../supabase/migrations/20260919130000_rls_public_default_privilege_lock.sql",
    import.meta.url,
  ),
  "utf8",
);

test("ACC-20260919-005: anon and public lose every privilege on hop-on alert tables", () => {
  assert.match(
    grantLock,
    /revoke all on table public\.live_alert_preferences from public, anon, authenticated/,
  );
  assert.match(
    grantLock,
    /revoke all on table public\.live_alert_deliveries from public, anon, authenticated/,
  );
  assert.doesNotMatch(grantLock, /grant [^;]*on table public\.live_alert_\w+ to anon/);
  assert.doesNotMatch(grantLock, /grant [^;]*truncate/i);
});

test("ACC-20260919-006: authenticated may only write own preferences and read own deliveries", () => {
  assert.match(
    grantLock,
    /grant select, insert, update on table public\.live_alert_preferences to authenticated/,
  );
  assert.match(grantLock, /grant select on table public\.live_alert_deliveries to authenticated/);
  assert.doesNotMatch(grantLock, /grant (select, )?insert on table public\.live_alert_deliveries/);
});

test("ACC-20260919-005: alert policies are scoped to authenticated, not public", () => {
  assert.match(grantLock, /to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(grantLock, /live_alert_deliveries_select_own[\s\S]*to authenticated/);
});

test("ACC-20260919-007: money and alert tables force row level security", () => {
  for (const table of [
    "live_alert_preferences",
    "live_alert_deliveries",
    "payment_records",
    "billing_customers",
    "tips",
    "event_passes",
    "membership_subscriptions",
    "paid_comments",
  ]) {
    assert.match(grantLock, new RegExp(`alter table public\\.${table} force row level security`));
  }
});

test("ACC-20260919-008: append-only moderation trigger pins an empty search_path", () => {
  assert.match(
    grantLock,
    /create or replace function private\.community_moderation_actions_append_only\(\)[\s\S]*set search_path = ''/,
  );
});

test("ACC-20260919-005/006: new public tables do not inherit anon or authenticated ALL", () => {
  assert.match(
    defaultLock,
    /alter default privileges in schema public\s+revoke all on tables from public, anon, authenticated/,
  );
  assert.match(
    defaultLock,
    /alter default privileges in schema public\s+revoke all on sequences from public, anon, authenticated/,
  );
  assert.doesNotMatch(defaultLock, /grant all on tables to (public|anon|authenticated)/i);
});
