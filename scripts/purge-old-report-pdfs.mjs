#!/usr/bin/env node
/**
 * Removes PDF Vault reports rendered before the current report layout.
 *
 *   node scripts/purge-old-report-pdfs.mjs            # dry run: lists what would go
 *   node scripts/purge-old-report-pdfs.mjs --confirm  # deletes storage objects, then rows
 *   node scripts/purge-old-report-pdfs.mjs --before 2026-09-25T14:43:00Z
 *
 * The default cutoff is when the new layout merged (PR #31). Deleting a row
 * cascades to its property_report_deliveries history. The next time a user
 * generates a report for that property, it renders in the current layout.
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "property-report-vault";
const DEFAULT_CUTOFF = "2026-09-25T14:43:00Z";

function loadEnvFile() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const values = {};
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.replace(/^﻿/, ""));
      if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const beforeIndex = args.indexOf("--before");
const cutoff = beforeIndex >= 0 ? args[beforeIndex + 1] : DEFAULT_CUTOFF;
if (!cutoff || Number.isNaN(Date.parse(cutoff))) {
  console.error("--before needs an ISO timestamp.");
  process.exit(1);
}

const env = { ...loadEnvFile(), ...process.env };
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: reports, error } = await supabase
  .from("property_reports")
  .select("id, storage_path, created_at")
  .lt("created_at", cutoff)
  .order("created_at");
if (error) throw error;

console.log(`${reports.length} report(s) created before ${cutoff}.`);
for (const report of reports) console.log(`  ${report.created_at}  ${report.storage_path}`);

if (!confirm) {
  console.log("Dry run. Re-run with --confirm to delete them.");
  process.exit(0);
}

// Rows first: an orphaned object is invisible to users, but a row whose
// object is gone is a broken download, so a failure part-way breaks nothing.
for (let index = 0; index < reports.length; index += 100) {
  const batch = reports.slice(index, index + 100);
  const { error: rowError } = await supabase
    .from("property_reports")
    .delete()
    .in(
      "id",
      batch.map((report) => report.id),
    );
  if (rowError) throw rowError;
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove(batch.map((report) => report.storage_path));
  if (storageError) throw storageError;
}
console.log(`Deleted ${reports.length} report(s).`);
