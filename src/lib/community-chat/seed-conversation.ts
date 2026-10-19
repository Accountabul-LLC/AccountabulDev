import { corpusForRoom } from "./seed-messages.ts";
import type { CommunityBadge, SeedPersona } from "./seed-personas.ts";

/**
 * Deterministic conversation generator for the development chat seed.
 *
 * Pure: no Supabase, no clock, no randomness beyond a seeded PRNG. The route
 * supplies the room list, the resolved persona accounts, the batch id and the
 * end time, so the same inputs always produce the same conversation and the
 * generator can be tested on its own.
 */

/** Messages written per room unless a caller asks for a different count. */
export const SEED_MESSAGES_PER_ROOM = 100;

/** Upper bound so a bad request cannot ask for a million rows. */
export const MAX_SEED_MESSAGES_PER_ROOM = 500;

/** Mirrors the community_messages_body_len database constraint. */
export const MAX_MESSAGE_BODY_LENGTH = 500;

export type SeedRoom = { id: string; slug: string; name: string };

/** A persona that has been resolved to a real auth user id. */
export type ResolvedSeedPersona = SeedPersona & { userId: string };

export type SeededMessageRow = {
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
  published_at: string;
  moderation_status: "approved";
  author_display_name: string;
  author_handle: string;
  author_badge: CommunityBadge;
  author_avatar_url: string | null;
  client_attempt_id: string;
  seed_batch_id: string;
  metadata: { seeded: true; persona: string };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 32-bit string hash, so a room slug can seed the PRNG reproducibly. */
function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, good enough for fixture data. */
function createRandom(seed: number) {
  let state = seed || 1;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(random: () => number, length: number) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

/**
 * Hands out corpus lines in shuffled passes, so a room uses every line once
 * before repeating any and never repeats a line back to back.
 */
function createLineDealer(lines: readonly string[], random: () => number) {
  let deck = shuffled(lines, random);
  let cursor = 0;
  let previous = "";
  return function nextLine() {
    if (cursor >= deck.length) {
      deck = shuffled(lines, random);
      cursor = 0;
    }
    let line = deck[cursor]!;
    cursor += 1;
    if (line === previous && cursor < deck.length) {
      line = deck[cursor]!;
      cursor += 1;
    }
    previous = line;
    return line.slice(0, MAX_MESSAGE_BODY_LENGTH);
  };
}

/**
 * Gap before the next message. Most conversation is fast, some of it pauses for
 * a few minutes, and occasionally the room goes quiet for an hour. The mix is
 * what makes relative timestamps worth looking at.
 */
function nextGapMs(random: () => number, sameAuthor: boolean) {
  if (sameAuthor) return 20_000 + random() * 70_000;
  const roll = random();
  if (roll < 0.6) return 25_000 + random() * 95_000;
  if (roll < 0.9) return 2 * MINUTE + random() * 10 * MINUTE;
  return 25 * MINUTE + random() * 65 * MINUTE;
}

/** Run length for one speaker, so consecutive-message grouping is exercised. */
function nextRunLength(random: () => number) {
  const roll = random();
  if (roll < 0.55) return 1;
  if (roll < 0.85) return 2;
  return 3;
}

export type BuildConversationOptions = {
  room: SeedRoom;
  personas: ResolvedSeedPersona[];
  batchId: string;
  /** The newest message lands here. Defaults to now at the call site. */
  endingAt: Date;
  count?: number;
  /** Injected so tests can assert on stable ids. */
  newId?: () => string;
};

/**
 * Builds one room's worth of chronological messages.
 *
 * Timestamps are laid out forward from an implied start and then shifted so the
 * newest message sits at `endingAt`. Three overnight gaps are inserted along the
 * way, which spreads 100 messages over about four calendar days and gives the UI
 * same-day, yesterday and older formatting to render.
 */
export function buildRoomConversation(options: BuildConversationOptions): SeededMessageRow[] {
  const { room, personas, batchId, endingAt } = options;
  const count = Math.max(
    0,
    Math.min(options.count ?? SEED_MESSAGES_PER_ROOM, MAX_SEED_MESSAGES_PER_ROOM),
  );
  if (count === 0 || personas.length === 0) return [];

  const newId = options.newId ?? (() => crypto.randomUUID());
  const random = createRandom(hashSeed(`${room.slug}:${room.id}`));
  const nextLine = createLineDealer(corpusForRoom(room), random);

  const overnightAt = new Set([
    Math.floor(count / 4),
    Math.floor(count / 2),
    Math.floor((count * 3) / 4),
  ]);

  const offsets: number[] = [];
  const speakers: ResolvedSeedPersona[] = [];

  let elapsed = 0;
  let speaker = personas[pickIndex(random, personas.length)]!;
  let remainingInRun = nextRunLength(random);

  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      if (remainingInRun === 0) {
        let next = personas[pickIndex(random, personas.length)]!;
        // Two speakers in a room would not alternate with themselves.
        if (next.userId === speaker.userId && personas.length > 1) {
          next = personas[(personas.indexOf(next) + 1) % personas.length]!;
        }
        speaker = next;
        remainingInRun = nextRunLength(random);
        elapsed += nextGapMs(random, false);
      } else {
        elapsed += nextGapMs(random, true);
      }
      if (overnightAt.has(index)) elapsed += 11 * HOUR + random() * 4 * HOUR;
    }
    remainingInRun -= 1;
    offsets.push(elapsed);
    speakers.push(speaker);
  }

  const startedAt = endingAt.getTime() - (offsets[offsets.length - 1] ?? 0);

  return offsets.map((offset, index) => {
    const author = speakers[index]!;
    const timestamp = new Date(startedAt + offset).toISOString();
    return {
      room_id: room.id,
      user_id: author.userId,
      body: nextLine(),
      created_at: timestamp,
      published_at: timestamp,
      moderation_status: "approved",
      author_display_name: author.displayName,
      author_handle: author.handle,
      author_badge: author.badge,
      author_avatar_url: author.avatarUrl,
      client_attempt_id: newId(),
      seed_batch_id: batchId,
      metadata: { seeded: true, persona: author.key },
    };
  });
}
