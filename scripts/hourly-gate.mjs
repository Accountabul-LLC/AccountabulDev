#!/usr/bin/env node
// Hourly gate — the shared, dependency-free check every role runs before it
// claims anything. Uses only the Node standard library on purpose: the cloud
// session cannot install node_modules (the lockfiles pin Lovable's private npm
// registry, which is blocked by egress policy), so a gate that needed packages
// would only ever run in one of the two environments.
//
//   node scripts/hourly-gate.mjs            human-readable report
//   node scripts/hourly-gate.mjs --json     machine-readable, for the loop
//
// Exit code 0 = no blocking failures, 1 = at least one BLOCK.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const JSON_OUT = process.argv.includes("--json");

/** @type {{id:string,title:string,level:"BLOCK"|"WARN"|"OK",detail:string[]}[]} */
const results = [];

function record(id, title, level, detail) {
  results.push({ id, title, level, detail: [].concat(detail) });
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function read(relative) {
  const full = join(ROOT, relative);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// ---------------------------------------------------------------------------
// GATE 1 — automated suite
// ---------------------------------------------------------------------------
// Runs each test file separately so one unresolvable import cannot mask the
// rest. Files that fail purely because a package is absent are reported as
// environment gaps (WARN), not as code faults (BLOCK) — otherwise the cloud
// session would report a permanent false red.
function gateTests() {
  const dir = join(ROOT, "tests");
  if (!existsSync(dir)) return record("TEST", "Automated suite", "BLOCK", "tests/ does not exist");

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .sort();
  const failed = [];
  const envBlocked = [];
  let pass = 0;
  let fail = 0;

  for (const file of files) {
    let out = "";
    try {
      out = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--test", join("tests", file)],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
      );
    } catch (error) {
      out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      const missing = out.match(/Cannot find package '([^']+)'/);
      if (missing) envBlocked.push(`${file} (needs '${missing[1]}')`);
      else failed.push(file);
    }
    pass += Number(out.match(/^# pass (\d+)/m)?.[1] ?? 0);
    fail += Number(out.match(/^# fail (\d+)/m)?.[1] ?? 0);
  }

  const summary = [`${pass} passing, ${fail} failing across ${files.length} files`];
  if (envBlocked.length) {
    summary.push(`not runnable here (missing packages): ${envBlocked.join(", ")}`);
  }
  if (failed.length) {
    record("TEST", "Automated suite", "BLOCK", [...summary, `failing files: ${failed.join(", ")}`]);
  } else if (envBlocked.length) {
    record("TEST", "Automated suite", "WARN", [
      ...summary,
      "Build Runner must re-run these with node_modules installed before any gate is claimed.",
    ]);
  } else {
    record("TEST", "Automated suite", "OK", summary);
  }
}

// ---------------------------------------------------------------------------
// GATE 2 — no secrets tracked in git
// ---------------------------------------------------------------------------
// gitignore does not untrack a file that is already in the index, so the
// process rule "never commit .env" has to be asserted against `git ls-files`
// rather than against .gitignore.
function gateTrackedSecrets() {
  const tracked = git("ls-files").split("\n").filter(Boolean);
  const forbidden = tracked.filter(
    (f) =>
      /^\.env$/.test(f) ||
      (/^\.env\./.test(f) && f !== ".env.example") ||
      /^client_secret_.*\.json$/.test(f) ||
      /\.apps\.googleusercontent\.com\.json$/.test(f) ||
      /^\.dev\.vars$/.test(f),
  );

  if (!forbidden.length) {
    return record("SECRET", "Secret files untracked", "OK", "no secret-bearing path is tracked");
  }
  record("SECRET", "Secret files untracked", "BLOCK", [
    `tracked despite .gitignore: ${forbidden.join(", ")}`,
    "Run: git rm --cached <path>. Anything ever placed in these files must be treated as disclosed.",
  ]);
}

// ---------------------------------------------------------------------------
// GATE 3 — every referenced artifact exists
// ---------------------------------------------------------------------------
// A gate cannot be verified from a report that is not in the repository. This
// catches the case where a session claims a phase, writes the findings only
// into its own chat, and leaves the next role nothing to work from.
function gateReferencedArtifacts() {
  const sources = ["AGENTS.md", "docs/security/ASSESSMENT_STATE.md"];
  const unrecorded = new Set();
  const acknowledged = new Set();
  const checked = new Set();
  const PATH = /(?:docs|supabase|src|scripts|tests)\/[A-Za-z0-9._/-]+\.(?:md|sql|tsx|ts|mjs|json)/g;

  for (const source of sources) {
    const body = read(source);
    if (!body) continue;
    for (const line of body.split("\n")) {
      // A citation the document itself marks as absent is a recorded gap, not
      // silent drift. The failure this gate is for is a document that asserts
      // an artifact exists when it does not — so honest bookkeeping passes and
      // only unflagged absences block.
      const struck = /not in git|missing from git|~~/i.test(line);
      for (const ref of line.match(PATH) ?? []) {
        checked.add(ref);
        if (existsSync(join(ROOT, ref))) continue;
        (struck ? acknowledged : unrecorded).add(`${ref}  (cited by ${source})`);
      }
    }
  }

  if (unrecorded.size) {
    return record("REFS", "Cited artifacts present", "BLOCK", [
      `${unrecorded.size} of ${checked.size} cited files do not exist and are not flagged:`,
      ...[...unrecorded].sort(),
      "Either restore the artifact or strike the claim in the citing document.",
    ]);
  }
  if (acknowledged.size) {
    return record("REFS", "Cited artifacts present", "WARN", [
      `${checked.size} references checked; ${acknowledged.size} absent but flagged in place:`,
      ...[...acknowledged].sort(),
      "The phases citing these cannot be independently verified until they are recovered or re-run.",
    ]);
  }
  record("REFS", "Cited artifacts present", "OK", `${checked.size} references all resolve`);
}

// ---------------------------------------------------------------------------
// GATE 4 — separation of duties is still asserted
// ---------------------------------------------------------------------------
// The one invariant the whole workflow rests on: the session that writes a fix
// is never the session that closes it.
function gateSeparationOfDuties() {
  const state = read("docs/security/ASSESSMENT_STATE.md");
  if (!state)
    return record("SOD", "Separation of duties", "BLOCK", "ASSESSMENT_STATE.md is missing");

  if (!/cannot|must not|do not treat/i.test(state)) {
    return record("SOD", "Separation of duties", "BLOCK", [
      "ASSESSMENT_STATE.md no longer states that an implementing session cannot close its own findings.",
    ]);
  }
  record("SOD", "Separation of duties", "OK", "implementer-cannot-close rule is still stated");
}

// ---------------------------------------------------------------------------
// GATE 5 — verification backlog
// ---------------------------------------------------------------------------
// Findings parked at Ready-for-verification are patched but unconfirmed. They
// are not closed, and a growing pile of them is the signal that the fourth gate
// has stopped running.
function gateVerificationBacklog() {
  const state = read("docs/security/ASSESSMENT_STATE.md");
  if (!state) return;

  const ready = (state.match(/Ready-for-verification/g) ?? []).length;
  const closed = (state.match(/\*\*Closed\*\*/g) ?? []).length;
  const detail = [`${ready} mentions of Ready-for-verification, ${closed} recorded closures`];

  if (ready > closed) {
    detail.push(
      "The Verifier gate is behind. A fresh session must close these; no other role may.",
    );
    return record("BACKLOG", "Verification backlog", "WARN", detail);
  }
  record("BACKLOG", "Verification backlog", "OK", detail);
}

// ---------------------------------------------------------------------------
// GATE 6 — working tree is publishable
// ---------------------------------------------------------------------------
function gateWorkingTree() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
  const detail = [`branch ${branch || "unknown"}`, `${dirty.length} uncommitted path(s)`];

  // A staged *deletion* of a secret-bearing path is the remedy, not a risk —
  // only an add or a modification is worth warning about.
  const risky = dirty.filter(
    (line) => /\.env($|\.)|client_secret|googleusercontent/.test(line) && !/^D |^ D/.test(line),
  );
  if (risky.length) {
    detail.push(`secret-bearing paths are dirty: ${risky.join(", ")} — never stage these`);
    return record("TREE", "Working tree", "WARN", detail);
  }
  record("TREE", "Working tree", "OK", detail);
}

// ---------------------------------------------------------------------------

gateTests();
gateTrackedSecrets();
gateReferencedArtifacts();
gateSeparationOfDuties();
gateVerificationBacklog();
gateWorkingTree();

const blocking = results.filter((r) => r.level === "BLOCK");

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { ranAt: new Date().toISOString(), blocking: blocking.length, results },
      null,
      2,
    ),
  );
} else {
  const icon = { OK: "ok  ", WARN: "warn", BLOCK: "BLOCK" };
  console.log(`Accountabul hourly gate — ${new Date().toISOString()}\n`);
  for (const r of results) {
    console.log(`[${icon[r.level]}] ${r.id}  ${r.title}`);
    for (const line of r.detail) console.log(`         ${line}`);
  }
  console.log(
    `\n${blocking.length ? `${blocking.length} blocking failure(s) — do not push.` : "No blocking failures."}`,
  );
}

process.exit(blocking.length ? 1 : 0);
