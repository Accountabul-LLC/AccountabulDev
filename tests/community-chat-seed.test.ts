import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRoomConversation,
  MAX_MESSAGE_BODY_LENGTH,
  MAX_SEED_MESSAGES_PER_ROOM,
  SEED_MESSAGES_PER_ROOM,
  type ResolvedSeedPersona,
} from "../src/lib/community-chat/seed-conversation.ts";
import { corpusForRoom, SEED_CORPUS_LINES } from "../src/lib/community-chat/seed-messages.ts";
import {
  emblemSvg,
  SEED_AVATAR_FILES,
  initialsOf,
  isSeedEmail,
  SEED_PERSONAS,
  seedEmailFor,
} from "../src/lib/community-chat/seed-personas.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260916140000_community_chat_seed_batches.sql", import.meta.url),
  "utf8",
);
const seeder = readFileSync(
  new URL("../src/lib/community-chat/seed.server.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/routes/api/internal/ops/community-chat-seed.ts", import.meta.url),
  "utf8",
);

const ENDING_AT = new Date("2026-09-16T17:30:00.000Z");

const personas: ResolvedSeedPersona[] = SEED_PERSONAS.map((persona, index) => ({
  ...persona,
  userId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
}));

function buildFixture(
  room = {
    id: "9d7c1a2b-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    slug: "deal-evaluation",
    name: "Deal Evaluation",
  },
  count = SEED_MESSAGES_PER_ROOM,
) {
  let counter = 0;
  return buildRoomConversation({
    room,
    personas,
    batchId: "11111111-2222-4333-8444-555555555555",
    endingAt: ENDING_AT,
    count,
    newId: () => `attempt-${(counter += 1)}`,
  });
}

test("every room gets the requested number of messages", () => {
  assert.equal(buildFixture().length, 100);
  assert.equal(buildFixture(undefined, 7).length, 7);
});

test("messages are chronological and end at the requested time", () => {
  const rows = buildFixture();
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Date.parse(rows[index - 1]!.created_at);
    const current = Date.parse(rows[index]!.created_at);
    assert.ok(current >= previous, `message ${index} went backwards in time`);
  }
  assert.equal(rows[rows.length - 1]!.created_at, ENDING_AT.toISOString());
});

test("timestamps span several days rather than sharing one instant", () => {
  const rows = buildFixture();
  const days = new Set(rows.map((row) => row.created_at.slice(0, 10)));
  assert.ok(days.size >= 3, `expected at least 3 calendar days, got ${days.size}`);

  const spanHours =
    (Date.parse(rows[rows.length - 1]!.created_at) - Date.parse(rows[0]!.created_at)) / 3_600_000;
  assert.ok(spanHours > 24, `expected more than a day of history, got ${spanHours} hours`);
});

test("several different members speak, in groupable runs", () => {
  const rows = buildFixture();
  const speakers = new Set(rows.map((row) => row.user_id));
  assert.ok(speakers.size >= 8, `expected at least 8 speakers, got ${speakers.size}`);

  const consecutive = rows.filter(
    (row, index) => index > 0 && rows[index - 1]!.user_id === row.user_id,
  );
  assert.ok(consecutive.length > 0, "no consecutive same-author messages to group");
  assert.ok(
    consecutive.length < rows.length / 2,
    "too many consecutive messages; the conversation should alternate",
  );
});

test("consecutive messages from one member sit close together in time", () => {
  const rows = buildFixture();
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1]!.user_id !== rows[index]!.user_id) continue;
    const gapMinutes =
      (Date.parse(rows[index]!.created_at) - Date.parse(rows[index - 1]!.created_at)) / 60_000;
    // Allow the overnight gap, which can land inside a run.
    assert.ok(gapMinutes <= 16 * 60, `run gap of ${gapMinutes} minutes is too long`);
  }
});

test("bodies are realistic, varied and within the database limit", () => {
  const rows = buildFixture();
  const bodies = rows.map((row) => row.body);

  for (const body of bodies) {
    assert.ok(body.length >= 1 && body.length <= MAX_MESSAGE_BODY_LENGTH);
    assert.ok(!/^test message \d+$/i.test(body), `placeholder body leaked through: ${body}`);
  }

  assert.ok(new Set(bodies).size >= 50, "not enough distinct lines to judge the UI");
  assert.ok(
    bodies.some((body) => body.length <= 20),
    "no very short messages",
  );
  assert.ok(
    bodies.some((body) => body.length >= 90),
    "no long messages",
  );
  assert.ok(
    bodies.some((body) => body.includes("?")),
    "no questions",
  );
  assert.ok(
    bodies.some((body) => /\$\d/.test(body)),
    "no dollar figures",
  );
});

test("the same line never repeats back to back", () => {
  const rows = buildFixture();
  for (let index = 1; index < rows.length; index += 1) {
    assert.notEqual(rows[index]!.body, rows[index - 1]!.body);
  }
});

test("rooms get content matched to their topic, with a general fallback", () => {
  assert.ok(
    corpusForRoom({ slug: "deal-evaluation", name: "Deal Evaluation" }).includes(
      SEED_CORPUS_LINES.deal[0]!,
    ),
  );
  assert.ok(
    corpusForRoom({ slug: "vendor-network", name: "Vendor Network" }).includes(
      SEED_CORPUS_LINES.vendor[0]!,
    ),
  );
  assert.ok(corpusForRoom({ slug: "help", name: "Help" }).includes(SEED_CORPUS_LINES.help[0]!));
  assert.ok(
    corpusForRoom({ slug: "watercooler", name: "Watercooler" }).includes(
      SEED_CORPUS_LINES.general[0]!,
    ),
    "an unknown room should fall back to general conversation",
  );
  // Short reactions belong everywhere.
  for (const room of [
    { slug: "general", name: "General" },
    { slug: "vendor-network", name: "Vendor Network" },
  ]) {
    assert.ok(corpusForRoom(room).includes(SEED_CORPUS_LINES.shared[0]!));
  }
});

test("two rooms do not produce the same conversation", () => {
  const dealRoom = buildFixture();
  const vendorRoom = buildFixture(
    { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", slug: "vendor-network", name: "Vendor Network" },
    SEED_MESSAGES_PER_ROOM,
  );
  assert.notDeepEqual(
    dealRoom.map((row) => row.body),
    vendorRoom.map((row) => row.body),
  );
});

test("the generator is deterministic for a given room", () => {
  const first = buildFixture().map((row) => `${row.user_id}|${row.body}|${row.created_at}`);
  const second = buildFixture().map((row) => `${row.user_id}|${row.body}|${row.created_at}`);
  assert.deepEqual(first, second);
});

test("every message carries the batch id and author identity", () => {
  const rows = buildFixture();
  for (const row of rows) {
    assert.equal(row.seed_batch_id, "11111111-2222-4333-8444-555555555555");
    assert.equal(row.metadata.seeded, true);
    assert.ok(row.author_display_name.length > 0);
    assert.ok(row.author_handle.startsWith("dev-"));
    assert.ok(["member", "vendor", "moderator", "admin"].includes(row.author_badge));
    assert.equal(row.published_at, row.created_at);
    assert.equal(row.moderation_status, "approved");
  }
  assert.equal(new Set(rows.map((row) => row.client_attempt_id)).size, rows.length);
});

test("the request count is clamped instead of trusted", () => {
  assert.equal(
    buildFixture(undefined, MAX_SEED_MESSAGES_PER_ROOM + 5000).length,
    MAX_SEED_MESSAGES_PER_ROOM,
  );
  assert.equal(buildFixture(undefined, -3).length, 0);
});

test("personas cover several roles and both avatar states", () => {
  assert.ok(SEED_PERSONAS.length >= 8 && SEED_PERSONAS.length <= 15);
  const badges = new Set(SEED_PERSONAS.map((persona) => persona.badge));
  for (const badge of ["member", "vendor", "moderator", "admin"]) {
    assert.ok(badges.has(badge as never), `missing a ${badge} persona`);
  }
  assert.ok(
    SEED_PERSONAS.some((persona) => persona.avatarUrl),
    "no persona has an avatar, so the image path is untested",
  );
  assert.ok(
    SEED_PERSONAS.some((persona) => !persona.avatarUrl),
    "every persona has an avatar, so the initials fallback is untested",
  );
  assert.equal(new Set(SEED_PERSONAS.map((persona) => persona.handle)).size, SEED_PERSONAS.length);
  assert.equal(new Set(SEED_PERSONAS.map((persona) => persona.key)).size, SEED_PERSONAS.length);
});

test("avatars are served by the app itself so they can never render broken", () => {
  for (const persona of SEED_PERSONAS) {
    if (!persona.avatarUrl) continue;
    assert.equal(persona.avatarUrl, `/seed-avatars/${persona.key}.svg`);
    // The committed file must exist and match what the generator produces.
    const file = SEED_AVATAR_FILES.find((entry) => entry.key === persona.key);
    assert.ok(file, `no generated avatar for ${persona.key}`);
    const svg = readFileSync(
      new URL(`../public/seed-avatars/${persona.key}.svg`, import.meta.url),
      "utf8",
    );
    assert.equal(svg, file.svg, `public/seed-avatars/${persona.key}.svg is out of date`);
    // Look for an actual remote *reference* — an href/src/url() the browser would
    // fetch. A bare `https?:` match is not that: every inline SVG carries
    // xmlns="http://www.w3.org/2000/svg", which is a namespace identifier and is
    // never dereferenced.
    const reachesOut =
      /(?:href|src)\s*=\s*["']?\s*https?:/i.test(svg) || /url\(\s*["']?\s*https?:/i.test(svg);
    assert.ok(!reachesOut, "avatar reaches out to a remote host");
    assert.ok(!/<image|xlink:href/.test(svg), "avatar loads an external resource");
  }
  assert.equal(initialsOf("Jordan Avery"), "JA");
  assert.equal(initialsOf("Taylor Smith"), "TS");
  assert.equal(initialsOf("cher"), "C");
  assert.equal(initialsOf("   "), "?");
  assert.ok(emblemSvg("Dana Ortiz", 0).includes(">DO<"));
  assert.equal(SEED_AVATAR_FILES.length, SEED_PERSONAS.filter((p) => p.avatarUrl).length);
});

test("seed accounts are reserved and recognisable", () => {
  for (const persona of SEED_PERSONAS) {
    const email = seedEmailFor(persona.key);
    assert.ok(email.endsWith("@seed.accountabul.test"));
    assert.ok(isSeedEmail(email));
  }
  assert.equal(isSeedEmail("member@accountabul.com"), false);
  assert.equal(isSeedEmail(null), false);
});

test("seeded rows are identified by column, never by message text", () => {
  assert.match(migration, /add column if not exists seed_batch_id uuid/);
  assert.match(seeder, /\.not\("seed_batch_id", "is", null\)/);
  // The cleanup must not filter on body content.
  const clearSection = seeder.slice(seeder.indexOf("clearSeededCommunityChat"));
  assert.ok(!/\.like\(|\.ilike\(|"body"/.test(clearSection), "cleanup inspects message text");
});

test("the seed batch ledger is service-role only", () => {
  assert.match(
    migration,
    /alter table public\.community_chat_seed_batches enable row level security/,
  );
  assert.match(migration, /force row level security/);
  assert.match(
    migration,
    /revoke all on public\.community_chat_seed_batches from public, anon, authenticated/,
  );
  assert.match(migration, /grant all on public\.community_chat_seed_batches to service_role/);
  assert.ok(
    !/create policy[\s\S]*community_chat_seed_batches/.test(migration),
    "the ledger should have no read policy at all",
  );
});

test("the migration is safe to run against a database that already has the columns", () => {
  assert.match(migration, /add column if not exists author_avatar_url text/);
  assert.match(migration, /create index if not exists community_messages_seed_batch_id_idx/);
  assert.match(migration, /create table if not exists public\.community_chat_seed_batches/);
  assert.ok(!/drop table|drop column|truncate/i.test(migration));
});

test("the endpoint is gated on environment before anything else", () => {
  assert.match(route, /checkSeedingAllowed/);
  assert.match(seeder, /COMMUNITY_CHAT_SEED_ENABLED/);
  assert.match(seeder, /NODE_ENV"\] === "production"/);
  // The gate runs inside guard(), and every handler calls guard() first.
  for (const method of ["GET", "POST", "DELETE"]) {
    const handler = route.slice(route.indexOf(`${method}: async`));
    const guardAt = handler.indexOf("await guard(request)");
    const workAt = handler.indexOf("await import(");
    assert.ok(guardAt > -1 && guardAt < workAt, `${method} does work before the guard`);
  }
});

test("the endpoint still requires the operations bearer token", () => {
  assert.match(
    route,
    /authorizeOperationsRequest\(request, process\.env\["OPERATIONS_API_KEY"\]\)/,
  );
  assert.match(route, /ops\.community_chat\.seeded/);
  assert.match(route, /ops\.community_chat\.seed_cleared/);
});

test("inserts are batched rather than issued one row at a time", () => {
  assert.match(seeder, /INSERT_CHUNK_SIZE = \d+/);
  assert.match(seeder, /start \+= INSERT_CHUNK_SIZE/);
});

test("seed accounts are reused across runs instead of duplicated", () => {
  assert.match(seeder, /\.in\("handle", handles\)/);
  assert.match(seeder, /findAuthUserByEmail/);
  assert.match(seeder, /onConflict: "id"/);
});

test("a database without the seed ledger table still seeds and clears", () => {
  assert.match(seeder, /PGRST205/);
  const guarded =
    seeder.match(/if \(batchError && !isMissingLedger\(batchError\)\) throw batchError;/g) ?? [];
  assert.equal(guarded.length, 3);
});
