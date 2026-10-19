#!/usr/bin/env node
/**
 * Development chat seeding CLI.
 *
 * Calls the operations endpoint on a running dev server, so seeding goes through
 * the same environment gate and bearer-token check as any other ops action.
 *
 *   node scripts/seed-community-chat.mjs status
 *   node scripts/seed-community-chat.mjs seed [--per-room 100]
 *   node scripts/seed-community-chat.mjs clear [--batch <uuid>]
 *
 * Reads OPERATIONS_API_KEY from the environment or .env, and targets
 * SEED_TARGET_URL (default http://localhost:3000).
 */
import { readFileSync } from "node:fs";

const ENDPOINT = "/api/internal/ops/community-chat-seed";

function loadEnvFile() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.replace(/^﻿/, ""));
      if (!match) continue;
      values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const [command = "status", ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith("--")) continue;
    flags[flag.slice(2)] = rest[index + 1]?.startsWith("--") ? true : rest[++index];
  }
  return { command, flags };
}

async function main() {
  const fileEnv = loadEnvFile();
  const key = process.env.OPERATIONS_API_KEY || fileEnv.OPERATIONS_API_KEY;
  if (!key) {
    console.error("OPERATIONS_API_KEY is not set. Add it to .env or the environment.");
    process.exit(1);
  }

  const base = process.env.SEED_TARGET_URL || fileEnv.SEED_TARGET_URL || "http://localhost:3000";
  const { command, flags } = parseArgs(process.argv.slice(2));

  const request = { headers: { authorization: `Bearer ${key}` } };
  let url = new URL(ENDPOINT, base);

  if (command === "status") {
    request.method = "GET";
  } else if (command === "seed") {
    request.method = "POST";
    request.headers["content-type"] = "application/json";
    const perRoom = flags["per-room"];
    request.body = JSON.stringify(perRoom ? { messages_per_room: Number(perRoom) } : {});
  } else if (command === "clear") {
    request.method = "DELETE";
    if (typeof flags.batch === "string") url.searchParams.set("batch_id", flags.batch);
  } else {
    console.error(`Unknown command "${command}". Use status, seed, or clear.`);
    process.exit(1);
  }

  const response = await fetch(url, request);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`${response.status}: ${body.error ?? "request failed"}`);
    process.exit(1);
  }

  if (command === "seed") {
    console.log(`${body.rooms_populated} rooms populated`);
    console.log(`${body.messages_created} test messages created`);
    console.log(`${body.personas_used} test users used`);
    console.log(`batch ${body.batch_id}`);
    for (const room of body.rooms) console.log(`  ${room.name}: ${room.messages}`);
  } else if (command === "clear") {
    console.log(`${body.messages_removed} seeded messages removed`);
    console.log(`${body.batches_cleared} batches marked cleared`);
  } else {
    console.log(`${body.rooms.length} active rooms`);
    for (const room of body.rooms) console.log(`  ${room.name} (${room.slug})`);
    console.log(`${body.seeded_messages} seeded messages`);
    console.log(`${body.real_messages} real messages`);
    console.log(`${body.personas_available} personas available`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
