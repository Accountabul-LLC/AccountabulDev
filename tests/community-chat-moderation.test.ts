import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  flagResolutionFor,
  historyActionFor,
  MAX_MUTE_MINUTES,
  MODERATION_ACTIONS,
  moderationActionRequiresReason,
  parseModerationAction,
} from "../src/lib/community-chat/moderation-admin.ts";
import {
  assessLink,
  assessMessageText,
  decideAutomatedOutcome,
  describeRestriction,
  primaryCategory,
  providerSignals,
  REPORT_AUTO_HIDE_THRESHOLD,
  REPORT_CATEGORIES,
  shouldAutoHideFromReports,
} from "../src/lib/community-chat/safeguards.ts";

const MESSAGE = "6f1f0b5a-6f0e-4e44-9a29-2c3b62f18f0b";
const USER = "0f2b0d0d-5a4b-4a1b-9d3f-9b6a5a4f31cc";
const ROOM = "7a1c2d3e-5a4b-4a1b-9d3f-9b6a5a4f31cc";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260917100000_community_chat_post_moderation.sql");
const route = read("../src/routes/api/internal/ops/community-moderation.ts");
const engine = read("../src/lib/community-chat/moderation.server.ts");
const background = read("../src/lib/background.server.ts");
const paidFilter = read("../src/lib/conference/moderation.ts");

/* ---------------------------------------------------------------------------
 * Automated safeguards never stand between a normal message and the room
 * ------------------------------------------------------------------------ */

test("ordinary conversation, including normal links, produces no signals", () => {
  for (const body of [
    "Anyone looked at the duplex on Grand? Numbers look tight at 7% rates.",
    "Here's the listing: https://www.zillow.com/homedetails/123-main-st",
    "Cap rate is 6.2%, cash-on-cash about 9. Worth a walk-through?",
    "www.accountabul.com/tools/deal-calculator has the calculator",
    "LOL",
  ]) {
    assert.deepEqual(assessMessageText(body), [], body);
    assert.equal(decideAutomatedOutcome(assessMessageText(body)), "none");
  }
});

test("suspicious links flag for review; dangerous links hide", () => {
  assert.equal(assessLink("https://bit.ly/3abc")?.rule, "link_shortener");
  assert.equal(assessLink("http://192.168.10.4/login")?.rule, "link_ip_address");
  assert.equal(assessLink("https://xn--pypal-4ve.com")?.rule, "link_punycode");
  assert.equal(assessLink("https://user:pass@example.com")?.severity, "high");
  assert.equal(assessLink("https://files.example.com/setup.exe")?.severity, "high");
  assert.equal(assessLink("https://www.redfin.com/IL/Chicago/home/1"), null);
  assert.equal(assessLink("not a url"), null);
});

test("spam flags, threats and self-harm encouragement hide", () => {
  const spam = assessMessageText("Guaranteed returns!! DM me on Telegram");
  assert.equal(decideAutomatedOutcome(spam), "flag");
  assert.equal(primaryCategory(spam), "spam");

  const threat = assessMessageText("I know where you live");
  assert.equal(decideAutomatedOutcome(threat), "hide");
  assert.equal(primaryCategory(threat), "violence");

  assert.equal(decideAutomatedOutcome(assessMessageText("just kys")), "hide");
  assert.equal(
    decideAutomatedOutcome(assessMessageText("THIS IS THE BEST DEAL YOU WILL EVER SEE FOLKS")),
    "flag",
  );
});

test("a moderation provider outage never flags or hides anything", () => {
  assert.deepEqual(
    providerSignals({ provider: "unavailable", reasons: ["moderation_provider_not_configured"] }),
    [],
  );
  assert.deepEqual(providerSignals({ provider: "openai", reasons: [] }), []);

  const harassment = providerSignals({ provider: "openai", reasons: ["harassment"] });
  assert.equal(decideAutomatedOutcome(harassment), "flag");
  const severe = providerSignals({ provider: "openai", reasons: ["harassment/threatening"] });
  assert.equal(decideAutomatedOutcome(severe), "hide");
  assert.equal(primaryCategory(severe), "harassment");
  assert.equal(
    primaryCategory(providerSignals({ provider: "openai", reasons: ["illicit/violent"] })),
    "illegal",
  );
});

test("the community rules stay separate from the strict paid-comment filter", () => {
  // Paid on-air comments still refuse every link; community chat does not.
  assert.match(paidFilter, /reason: "links"/);
  assert.equal(assessLink("https://www.zillow.com/"), null);
  assert.doesNotMatch(engine, /moderateComment\(/);
  assert.match(engine, /moderateWithProvider\(/);
});

test("reports hide a message only once several different members report it", () => {
  assert.equal(shouldAutoHideFromReports(REPORT_AUTO_HIDE_THRESHOLD - 1), false);
  assert.equal(shouldAutoHideFromReports(REPORT_AUTO_HIDE_THRESHOLD), true);
  // Only open reports count, so dismissed reports do not re-hide a restored message.
  assert.match(engine, /reportCount\("open"\)/);
  assert.ok(REPORT_CATEGORIES.every((entry) => entry.value !== "flooding"));
});

test("screening runs after the response, with a sweep as a backstop", () => {
  assert.match(background, /request\.waitUntil\(promise\)/);
  assert.match(engine, /export async function sweepUnscreenedMessages/);
  assert.match(engine, /\.is\("seed_batch_id", null\)/);
  assert.match(route, /runAfterResponse\("community-chat-sweep"/);
  // Screening claims the message only after it has a result, so a lost worker
  // leaves it for the sweep instead of marking it screened.
  const computeAt = engine.indexOf("const outcome = decideAutomatedOutcome(signals)");
  const claimAt = engine.indexOf('.is("screened_at", null)\n    .select("id")');
  assert.ok(computeAt > 0 && claimAt > computeAt);
});

test("restricted members are told what happened, never who acted", () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  assert.match(
    describeRestriction({ kind: "mute", reason: "spam", expires_at: future }),
    /can read this room but can't post until/,
  );
  assert.match(
    describeRestriction({ kind: "ban", reason: "abuse", expires_at: null }),
    /suspended for violating/,
  );
  assert.doesNotMatch(
    describeRestriction({ kind: "room_removal", reason: "x", expires_at: null }),
    /admin|moderator|staff member/i,
  );
});

/* ---------------------------------------------------------------------------
 * Staff actions
 * ------------------------------------------------------------------------ */

test("every staff action parses with the fields it needs", () => {
  const cases: Record<(typeof MODERATION_ACTIONS)[number], Record<string, unknown>> = {
    hide_message: { messageId: MESSAGE, reason: "spam" },
    unhide_message: { messageId: MESSAGE },
    delete_message: { messageId: MESSAGE, reason: "abuse" },
    restore_message: { messageId: MESSAGE },
    dismiss_flags: { messageId: MESSAGE },
    mute_user: { messageId: MESSAGE, durationMinutes: 60, reason: "flooding" },
    remove_from_room: { userId: USER, roomId: ROOM, reason: "off-topic promotion" },
    ban_user: { userId: USER, reason: "repeated harassment" },
    lift_restriction: { restrictionId: MESSAGE },
  };
  for (const action of MODERATION_ACTIONS) {
    const parsed = parseModerationAction({
      action,
      operator: "owner@example.com",
      ...cases[action],
    });
    assert.ok(parsed.ok, `${action}: ${parsed.ok ? "" : parsed.error}`);
  }
});

test("staff actions that take something away require a reason", () => {
  for (const action of [
    "hide_message",
    "delete_message",
    "mute_user",
    "remove_from_room",
    "ban_user",
  ] as const) {
    assert.equal(moderationActionRequiresReason(action), true);
  }
  assert.equal(parseModerationAction({ action: "hide_message", messageId: MESSAGE }).ok, false);
  assert.equal(parseModerationAction({ action: "unhide_message", messageId: MESSAGE }).ok, true);
});

test("invalid staff requests are refused before touching data", () => {
  const refused: unknown[] = [
    null,
    [],
    { action: "purge_everything" },
    { action: "hide_message", reason: "x" },
    { action: "hide_message", messageId: "not-a-uuid", reason: "x" },
    { action: "mute_user", userId: USER, reason: "x" },
    { action: "mute_user", userId: USER, reason: "x", durationMinutes: MAX_MUTE_MINUTES + 1 },
    { action: "mute_user", userId: USER, reason: "x", durationMinutes: 1.5 },
    { action: "ban_user", userId: USER, roomId: ROOM, reason: "x" },
    { action: "ban_user", reason: "x" },
    { action: "remove_from_room", userId: USER, reason: "x" },
    { action: "lift_restriction" },
    { action: "hide_message", messageId: MESSAGE, reason: "r".repeat(501) },
  ];
  for (const payload of refused) {
    assert.equal(parseModerationAction(payload).ok, false, JSON.stringify(payload)?.slice(0, 80));
  }
});

test("each action resolves flags and writes the matching history entry", () => {
  assert.equal(flagResolutionFor("hide_message"), "actioned");
  assert.equal(flagResolutionFor("ban_user"), "actioned");
  assert.equal(flagResolutionFor("restore_message"), "dismissed");
  assert.equal(flagResolutionFor("dismiss_flags"), "dismissed");
  assert.equal(flagResolutionFor("lift_restriction"), null);
  assert.equal(historyActionFor("remove_from_room"), "user_removed_from_room");
  for (const action of MODERATION_ACTIONS) {
    assert.match(migration, new RegExp(`'${historyActionFor(action)}'`));
  }
  assert.match(route, /authorizeOperationsRequest\(request/);
  assert.match(route, /ops\.community_moderation\.\$\{input\.action\}/);
});

/* ---------------------------------------------------------------------------
 * Database
 * ------------------------------------------------------------------------ */

test("hiding, deleting, and bans are reversible and enforced by the database", () => {
  assert.match(migration, /add column if not exists hidden_at timestamptz/);
  assert.match(migration, /and hidden_at is null\s+and public\.can_access_community_room/);
  // Ban and room removal revoke read access; a mute does not.
  assert.match(
    migration,
    /r\.kind = 'ban'\s+or \(r\.kind = 'room_removal' and r\.room_id = _room_id\)/,
  );
  assert.match(migration, /and not private\.community_chat_access_revoked\(_user_id, _room_id\)/);
  // Restrictions are lifted, never deleted, so history stays intact.
  assert.match(migration, /lifted_at timestamptz/);
});

test("moderation history is append-only and members cannot write moderation data", () => {
  assert.match(migration, /before update or delete on public\.community_moderation_actions/);
  assert.match(
    migration,
    /grant select, insert on public\.community_moderation_actions to service_role/,
  );
  for (const table of [
    "community_message_flags",
    "community_chat_restrictions",
    "community_moderation_actions",
    "community_chat_policy_versions",
    "community_chat_policy_acceptances",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`),
    );
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
  }
  assert.match(migration, /community_message_flags_one_report_per_member/);
});

test("messages held under the old model become reviewable hidden messages", () => {
  assert.match(migration, /where published_at is null\s+and deleted_at is null/);
  assert.match(migration, /hidden_at = created_at/);
  assert.match(migration, /'legacy_pre_moderation_hold'/);
});

test("the chat policy covers what the platform requires, and one version is active", () => {
  for (const rule of [
    /responsible for what you post/i,
    /spam/i,
    /harassment/i,
    /illegal/i,
    /Report/,
    /restrict accounts|restrict, mute, remove, or ban|may remove content/i,
  ]) {
    assert.match(migration, rule);
  }
  assert.match(migration, /community_chat_policy_versions_one_active/);
  // The paid on-air comment standards are left alone.
  assert.doesNotMatch(migration, /update public\.community_standards_versions/);
});
