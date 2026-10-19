import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  buildRoomConversation,
  MAX_SEED_MESSAGES_PER_ROOM,
  SEED_MESSAGES_PER_ROOM,
  type ResolvedSeedPersona,
  type SeededMessageRow,
  type SeedRoom,
} from "./seed-conversation";
import { SEED_PERSONAS, seedEmailFor, type SeedPersona } from "./seed-personas";

/**
 * Development-only community chat seeder.
 *
 * Writes realistic conversation into every existing room so the chat UI can be
 * judged with a full backlog. Seeded rows carry a seed_batch_id; cleanup deletes
 * strictly on that column, so a real member message can never be removed here.
 */

/** Rows per insert call. Keeps request bodies small without going row by row. */
const INSERT_CHUNK_SIZE = 250;

/** Pages scanned when falling back to an auth user lookup by email. */
const AUTH_LOOKUP_PAGE_SIZE = 1000;
const AUTH_LOOKUP_MAX_PAGES = 20;

/**
 * The seed-run ledger is a convenience. Seeded messages are identified by their
 * own seed_batch_id, so a database without the ledger table still seeds and
 * clears correctly; it just keeps no run history.
 */
function isMissingLedger(error: { code?: string | null } | null) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export type SeedGate = { ok: true } | { ok: false; status: number; message: string };

/**
 * Seeding is a development affordance. It stays off in production unless an
 * operator deliberately turns it on for a staging deployment.
 */
export function checkSeedingAllowed(env: NodeJS.ProcessEnv = process.env): SeedGate {
  if (env["COMMUNITY_CHAT_SEED_ENABLED"] === "true") return { ok: true };
  if (env["NODE_ENV"] === "production") {
    return {
      ok: false,
      status: 404,
      message: "Chat seeding is unavailable in this environment.",
    };
  }
  return { ok: true };
}

export type SeedSummary = {
  batch_id: string;
  rooms_populated: number;
  messages_created: number;
  personas_used: number;
  messages_per_room: number;
  rooms: { id: string; slug: string; name: string; messages: number }[];
};

export type ClearSummary = {
  batch_id: string | null;
  messages_removed: number;
  batches_cleared: number;
};

/**
 * Finds or creates the development member accounts.
 *
 * Accounts are keyed by a reserved email address, so running the seed again
 * reuses the same twelve users instead of piling up duplicates.
 */
export async function ensureSeedPersonaAccounts(): Promise<ResolvedSeedPersona[]> {
  const handles = SEED_PERSONAS.map((persona) => persona.handle);
  const { data: existingProfiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, handle")
    .in("handle", handles);
  if (profileError) throw profileError;

  const idByHandle = new Map<string, string>(
    (existingProfiles ?? []).flatMap((row) => (row.handle ? [[row.handle, row.id] as const] : [])),
  );

  const resolved: ResolvedSeedPersona[] = [];
  for (const persona of SEED_PERSONAS) {
    const known = idByHandle.get(persona.handle);
    const userId = known ?? (await createOrFindAuthUser(persona));
    resolved.push({ ...persona, userId });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabaseAdmin.from("profiles").upsert(
    resolved.map((persona) => ({
      id: persona.userId,
      handle: persona.handle,
      display_name: persona.displayName,
      first_name: persona.displayName.split(" ")[0] ?? persona.displayName,
      last_name: persona.displayName.split(" ").slice(1).join(" ") || null,
      account_type: persona.accountType,
      onboarding_status: "complete" as const,
      updated_at: now,
    })),
    { onConflict: "id" },
  );
  if (upsertError) throw upsertError;

  return resolved;
}

async function createOrFindAuthUser(persona: SeedPersona) {
  const email = seedEmailFor(persona.key);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: {
      display_name: persona.displayName,
      handle: persona.handle,
      community_chat_seed: true,
    },
  });
  if (!error && data.user) return data.user.id;

  // Already registered from an earlier run: find the id and reuse it.
  const found = await findAuthUserByEmail(email);
  if (found) return found;
  throw error ?? new Error(`Could not provision the seed account for ${persona.handle}.`);
}

async function findAuthUserByEmail(email: string) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= AUTH_LOOKUP_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: AUTH_LOOKUP_PAGE_SIZE,
    });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < AUTH_LOOKUP_PAGE_SIZE) return null;
  }
  return null;
}

/** Every room a member could open: active and not soft-deleted. */
export async function listSeedableRooms(): Promise<SeedRoom[]> {
  const { data, error } = await supabaseAdmin
    .from("community_rooms")
    .select("id, slug, name")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function seedCommunityChat(
  options: { messagesPerRoom?: number; endingAt?: Date } = {},
): Promise<SeedSummary> {
  const messagesPerRoom = Math.max(
    1,
    Math.min(options.messagesPerRoom ?? SEED_MESSAGES_PER_ROOM, MAX_SEED_MESSAGES_PER_ROOM),
  );
  const endingAt = options.endingAt ?? new Date();

  const rooms = await listSeedableRooms();
  if (rooms.length === 0) {
    throw new Error("There are no active community rooms to seed.");
  }

  const personas = await ensureSeedPersonaAccounts();
  const batchId = crypto.randomUUID();

  const rows: SeededMessageRow[] = [];
  const perRoom: SeedSummary["rooms"] = [];
  for (const room of rooms) {
    const conversation = buildRoomConversation({
      room,
      personas,
      batchId,
      endingAt,
      count: messagesPerRoom,
    });
    rows.push(...conversation);
    perRoom.push({ id: room.id, slug: room.slug, name: room.name, messages: conversation.length });
  }

  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE);
    const { error } = await supabaseAdmin.from("community_messages").insert(chunk);
    if (error) throw error;
  }

  const { error: batchError } = await supabaseAdmin.from("community_chat_seed_batches").insert({
    id: batchId,
    room_count: rooms.length,
    message_count: rows.length,
    persona_count: personas.length,
    messages_per_room: messagesPerRoom,
  });
  if (batchError && !isMissingLedger(batchError)) throw batchError;

  return {
    batch_id: batchId,
    rooms_populated: rooms.length,
    messages_created: rows.length,
    personas_used: personas.length,
    messages_per_room: messagesPerRoom,
    rooms: perRoom,
  };
}

/**
 * Removes seeded messages, optionally just one batch.
 *
 * The delete filters on seed_batch_id only. Real member messages leave that
 * column null, so they are outside the filter by construction.
 */
export async function clearSeededCommunityChat(
  options: { batchId?: string } = {},
): Promise<ClearSummary> {
  const messageQuery = supabaseAdmin
    .from("community_messages")
    .delete()
    .not("seed_batch_id", "is", null);
  const scoped = options.batchId ? messageQuery.eq("seed_batch_id", options.batchId) : messageQuery;

  const { data: removed, error } = await scoped.select("id");
  if (error) throw error;

  const batchUpdate = supabaseAdmin
    .from("community_chat_seed_batches")
    .update({ cleared_at: new Date().toISOString() })
    .is("cleared_at", null);
  const { data: batches, error: batchError } = await (
    options.batchId ? batchUpdate.eq("id", options.batchId) : batchUpdate
  ).select("id");
  if (batchError && !isMissingLedger(batchError)) throw batchError;

  return {
    batch_id: options.batchId ?? null,
    messages_removed: removed?.length ?? 0,
    batches_cleared: batches?.length ?? 0,
  };
}

/** Counts that the ops console can show before or after a run. */
export async function describeSeedState() {
  const rooms = await listSeedableRooms();
  const { count: seededCount, error: seededError } = await supabaseAdmin
    .from("community_messages")
    .select("id", { count: "exact", head: true })
    .not("seed_batch_id", "is", null);
  if (seededError) throw seededError;

  const { count: realCount, error: realError } = await supabaseAdmin
    .from("community_messages")
    .select("id", { count: "exact", head: true })
    .is("seed_batch_id", null)
    .is("deleted_at", null);
  if (realError) throw realError;

  const { data: batches, error: batchError } = await supabaseAdmin
    .from("community_chat_seed_batches")
    .select("id, created_at, cleared_at, room_count, message_count, persona_count")
    .order("created_at", { ascending: false })
    .limit(10);
  if (batchError && !isMissingLedger(batchError)) throw batchError;

  return {
    rooms: rooms.map((room) => ({ id: room.id, slug: room.slug, name: room.name })),
    seeded_messages: seededCount ?? 0,
    real_messages: realCount ?? 0,
    personas_available: SEED_PERSONAS.length,
    recent_batches: batches ?? [],
  };
}
