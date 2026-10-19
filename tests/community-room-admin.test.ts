import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMMUNITY_ACCESS_POLICIES,
  isCommunityAccessPolicy,
  isCommunityGrantRole,
  MAX_ROOM_GRANTS,
  parseCommunityRoomInput,
  slugifyRoomName,
} from "../src/lib/community-chat/room-admin.ts";

const ROOM_ID = "6f1f0b5a-6f0e-4e44-9a29-2c3b62f18f0b";
const USER_ID = "0f2b0d0d-5a4b-4a1b-9d3f-9b6a5a4f31cc";

const migration = readFileSync(
  new URL("../supabase/migrations/20260909165841_community_chat.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/routes/api/internal/ops/community-rooms.ts", import.meta.url),
  "utf8",
);

test("room names become database-legal slugs", () => {
  assert.equal(slugifyRoomName("Deal Evaluation"), "deal-evaluation");
  assert.equal(slugifyRoomName("  Accountabul Help!  "), "accountabul-help");
  assert.equal(slugifyRoomName("Vendor   Network 2026"), "vendor-network-2026");
  assert.equal(slugifyRoomName("Café Talk"), "cafe-talk");
  assert.equal(slugifyRoomName("###"), "");
  assert.ok(slugifyRoomName("x".repeat(120)).length <= 60);
});

test("a new room only needs a name and derives the rest", () => {
  const parsed = parseCommunityRoomInput({ name: "Deal Evaluation" }, { updating: false });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, {
    id: null,
    slug: "deal-evaluation",
    name: "Deal Evaluation",
    description: null,
    roomKind: "community",
    sortOrder: 0,
    isActive: true,
    accessPolicy: "signed_in",
    roleGrants: [],
    userGrants: [],
    restore: false,
  });
});

test("every access policy the database accepts is accepted by the parser", () => {
  for (const policy of COMMUNITY_ACCESS_POLICIES) {
    assert.ok(isCommunityAccessPolicy(policy));
    assert.ok(migration.includes(`'${policy}'`));
  }
  assert.equal(isCommunityAccessPolicy("everyone"), false);
  assert.equal(isCommunityGrantRole("admin"), true);
  assert.equal(isCommunityGrantRole("owner"), false);
});

test("invalid room fields fail with 400 before reaching the database", () => {
  const cases: unknown[] = [
    null,
    [],
    { name: "" },
    { name: "x".repeat(81) },
    { name: "General", slug: "Not A Slug" },
    { name: "General", slug: "-leading-hyphen" },
    { name: "General", description: "d".repeat(281) },
    { name: "General", roomKind: "k".repeat(41) },
    { name: "General", sortOrder: 1.5 },
    { name: "General", sortOrder: -1 },
    { name: "General", sortOrder: "3" },
    { name: "General", accessPolicy: "everyone" },
    { name: "General", roleGrants: "admin" },
    { name: "General", roleGrants: ["owner"] },
    { name: "General", userGrants: ["@not a handle"] },
    { name: "General", userGrants: [""] },
    { name: "General", id: ROOM_ID },
  ];
  for (const payload of cases) {
    const parsed = parseCommunityRoomInput(payload, { updating: false });
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(payload)}`);
    if (!parsed.ok) assert.equal(parsed.status, 400);
  }
});

test("a room name that slugifies to nothing is rejected instead of stored", () => {
  const parsed = parseCommunityRoomInput({ name: "###" }, { updating: false });
  assert.equal(parsed.ok, false);
});

test("updates require a real room id and can restore a deleted room", () => {
  assert.equal(parseCommunityRoomInput({ name: "General" }, { updating: true }).ok, false);
  assert.equal(
    parseCommunityRoomInput({ id: "not-a-uuid", name: "General" }, { updating: true }).ok,
    false,
  );
  const parsed = parseCommunityRoomInput(
    { id: ROOM_ID, name: "General", restore: true, isActive: false },
    { updating: true },
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.value.id, ROOM_ID);
  assert.equal(parsed.value.restore, true);
  assert.equal(parsed.value.isActive, false);
});

test("grants are de-duplicated and normalized to ids and bare handles", () => {
  const parsed = parseCommunityRoomInput(
    {
      name: "Vendor Network",
      accessPolicy: "user_allowlist",
      userGrants: ["@Jordan", "jordan", USER_ID, USER_ID.toUpperCase(), " @vendor-one "],
    },
    { updating: false },
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.userGrants, [
    { kind: "handle", handle: "jordan" },
    { kind: "id", userId: USER_ID },
    { kind: "handle", handle: "vendor-one" },
  ]);

  const roles = parseCommunityRoomInput(
    { name: "Staff", accessPolicy: "role_allowlist", roleGrants: ["admin", "ADMIN", "moderator"] },
    { updating: false },
  );
  assert.ok(roles.ok);
  assert.deepEqual(roles.value.roleGrants, ["admin", "moderator"]);
});

test("allowlist rooms cannot mix grant kinds and grants are bounded", () => {
  assert.equal(
    parseCommunityRoomInput(
      { name: "Staff", accessPolicy: "role_allowlist", userGrants: ["@jordan"] },
      { updating: false },
    ).ok,
    false,
  );
  assert.equal(
    parseCommunityRoomInput(
      { name: "Staff", accessPolicy: "user_allowlist", roleGrants: ["admin"] },
      { updating: false },
    ).ok,
    false,
  );
  const tooMany = parseCommunityRoomInput(
    {
      name: "Staff",
      accessPolicy: "user_allowlist",
      userGrants: Array.from({ length: MAX_ROOM_GRANTS + 1 }, (_, index) => `@member-${index}`),
    },
    { updating: false },
  );
  assert.equal(tooMany.ok, false);
});

test("an empty allowlist is allowed and admits nobody by leaving no grants", () => {
  const parsed = parseCommunityRoomInput(
    { name: "Deal Evaluation", accessPolicy: "user_allowlist", userGrants: [] },
    { updating: false },
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.userGrants, []);
  assert.deepEqual(parsed.value.roleGrants, []);
  assert.match(migration, /when 'user_allowlist' then exists \(/);
});

test("the operations route authorizes every method and audits every write", () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assert.match(route, new RegExp(`${method}: async`));
  }
  const authorizeCalls = route.match(/authorizeOperationsRequest\(/g) ?? [];
  assert.equal(authorizeCalls.length, 3, "GET, DELETE, and the shared mutate path each authorize");
  assert.match(route, /ops\.community_room\.created/);
  assert.match(route, /ops\.community_room\.updated/);
  assert.match(route, /ops\.community_room\.deleted/);
  assert.match(route, /target_table: "community_rooms"/);
});

test("deleting a room is a soft delete that keeps its messages", () => {
  assert.match(route, /deleted_at: now, is_active: false/);
  assert.doesNotMatch(route, /from\("community_rooms"\)\s*\.delete\(\)/);
  assert.match(
    migration,
    /room_id uuid not null references public\.community_rooms\(id\) on delete restrict/,
  );
});

test("member-facing reads stay behind row level security, not the operations route", () => {
  assert.match(migration, /alter table public\.community_rooms enable row level security/);
  assert.match(migration, /create policy community_rooms_member_read/);
  assert.match(migration, /revoke all on public\.community_rooms from public, anon, authenticated/);
});
