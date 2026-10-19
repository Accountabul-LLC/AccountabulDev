import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260924160000_property_api_platform.sql", import.meta.url),
  "utf8",
);

test("Property API: sandbox keys are owner-scoped — a user can insert/select only their own row", () => {
  assert.match(
    migration,
    /create policy property_api_keys_owner_insert\s+on public\.property_api_keys for insert to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\) and status = 'active' and revoked_at is null\)/,
  );
  assert.match(
    migration,
    /create policy property_api_keys_owner_read\s+on public\.property_api_keys for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/,
  );
});

test("Property API: the only UPDATE policy on property_api_keys can just flip active -> revoked", () => {
  const updatePolicies = migration.match(
    /create policy \w+\s+on public\.property_api_keys for update/g,
  );
  assert.equal(updatePolicies?.length, 1, "exactly one UPDATE policy should exist");
  assert.match(
    migration,
    /create policy property_api_keys_owner_revoke\s+on public\.property_api_keys for update to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) and status = 'active'\)\s+with check \(user_id = \(select auth\.uid\(\)\) and status = 'revoked' and revoked_at is not null\)/,
  );
});

test("Property API: an immutable-fields trigger blocks the owner-revoke UPDATE grant from rewriting key_hash/key_prefix/label/scopes/user_id/created_at", () => {
  assert.match(migration, /create trigger property_api_keys_immutable_fields/);
  assert.match(migration, /new\.key_hash is distinct from old\.key_hash/);
  assert.match(migration, /new\.key_prefix is distinct from old\.key_prefix/);
  assert.match(migration, /new\.label is distinct from old\.label/);
  assert.match(migration, /new\.scopes is distinct from old\.scopes/);
  assert.match(migration, /new\.user_id is distinct from old\.user_id/);
});

test("Property API: minting a key requires an approved access request and is capped at 3 active keys, enforced by a trigger", () => {
  assert.match(migration, /create trigger property_api_keys_quota/);
  assert.match(
    migration,
    /property_api_access_requests r\s+where r\.user_id = new\.user_id and r\.status = 'approved'/,
  );
  assert.match(migration, />= 3 then/);
});

test("Property API: property_api_rate_limits has no policy at all for authenticated — pure internal counters, service-role only", () => {
  assert.doesNotMatch(migration, /create policy \w+\s+on public\.property_api_rate_limits/);
  assert.match(
    migration,
    /revoke all on public\.property_api_rate_limits from public, anon, authenticated;/,
  );
});

test("Property API: usage events are owner-readable but never authenticated-writable", () => {
  assert.match(migration, /grant select on public\.property_api_usage_events to authenticated;/);
  assert.doesNotMatch(
    migration,
    /grant\s+[^;]*insert[^;]*on public\.property_api_usage_events to authenticated/i,
  );
  assert.match(
    migration,
    /create policy property_api_usage_events_owner_read\s+on public\.property_api_usage_events for select to authenticated\s+using \(\s*exists \(\s*select 1 from public\.property_api_keys k\s*where k\.id = key_id and k\.user_id = \(select auth\.uid\(\)\)\s*\)\s*\)/,
  );
});

test("Property API: the rate-limit reservation function is service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.property_api_reserve_rate_limit\(uuid, bigint, integer\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.property_api_reserve_rate_limit\(uuid, bigint, integer\)\s+to service_role;/,
  );
});

test("Property API: every table in this migration has row level security enabled and forced", () => {
  for (const table of [
    "property_api_keys",
    "property_api_rate_limits",
    "property_api_usage_events",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security;`));
  }
});
