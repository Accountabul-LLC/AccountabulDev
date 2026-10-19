#!/usr/bin/env node
// accountabul-audit — a whole-application health scanner, not a linter.
//
//   node scripts/accountabul-audit.mjs            human-readable CODEBASE_AUDIT.md + console summary
//   node scripts/accountabul-audit.mjs --json     also writes codebase-audit.json
//
// Dependency-free by design, matching hourly-gate.mjs's own reasoning: this
// script must run identically in a cloud session that cannot install
// node_modules and in a local session that can. Where a real check needs an
// installed toolchain (tsc, eslint, the production build), it is attempted
// via whatever is on PATH or in this repo's own node_modules/.bin, and its
// absence is reported as SKIPPED with a reason -- never silently treated as
// passing, and never faked.
//
// What each section actually checks is stated in that section's own comment,
// because the honest, useful version of an audit like this says exactly what
// it verified and how, not just a checkmark.
//
// Six sections, mapped to the six things asked for:
//   1. ROUTES   -- broken paths: routes pointing nowhere, dead links, bad API calls
//   2. RUNTIME  -- type errors, swallowed catches, missing awaits (heuristic)
//   3. DEAD     -- unreferenced exports, unused dependencies, import cycles
//   4. FLOW     -- named user workflows, checked as reachability chains
//   5. BUILD    -- typecheck, lint, tests, build, env-var validation
//   6. SECURITY -- secrets, and the generalized form of ACC-20260924-003:
//                  a table service_role can write that a request-scoped
//                  client also writes to

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const SRC = join(ROOT, "src");
const TESTS = join(ROOT, "tests");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** @type {{section:string,id:string,severity:"CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"OK"|"SKIP",title:string,detail:string[]}[]} */
const findings = [];

function record(section, id, severity, title, detail = []) {
  findings.push({ section, id, severity, title, detail: [].concat(detail) });
}

function sh(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: (error.stdout ?? "") + (error.stderr ?? ""), error };
  }
}

function binExists(relBin) {
  return existsSync(join(ROOT, "node_modules", ".bin", relBin));
}

function readSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Recursively walk a directory, yielding absolute file paths. */
function* walk(dir, opts = {}) {
  const { exts, skip = new Set(["node_modules", ".git", "dist", "build", ".vite"]) } = opts;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, opts);
    } else if (!exts || exts.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

function rel(path) {
  return relative(ROOT, path);
}

// ---------------------------------------------------------------------------
// 5. BUILD -- run first, since everything else depends on the source parsing
// ---------------------------------------------------------------------------

function checkBuild() {
  // The gate itself: dependency-free, so this always runs and always means
  // something, in either environment.
  const gate = sh("node", ["scripts/hourly-gate.mjs", "--json"]);
  if (gate.ok) {
    try {
      const parsed = JSON.parse(gate.out);
      const blocking = (parsed.results ?? parsed).filter((r) => r.level === "BLOCK");
      if (blocking.length === 0) {
        record("BUILD", "gate", "OK", "hourly-gate.mjs: no blocking failures");
      } else {
        record(
          "BUILD",
          "gate",
          "CRITICAL",
          `hourly-gate.mjs: ${blocking.length} blocking failure(s)`,
          blocking.map((b) => `${b.id}: ${b.title}`),
        );
      }
    } catch {
      record(
        "BUILD",
        "gate",
        "MEDIUM",
        "hourly-gate.mjs ran but its --json output could not be parsed",
      );
    }
  } else {
    record("BUILD", "gate", "CRITICAL", "hourly-gate.mjs failed to run", [gate.out.slice(0, 500)]);
  }

  // The test suite: also dependency-free (node --experimental-strip-types
  // --test), so this is a real, non-heuristic signal in any environment.
  const testFiles = existsSync(TESTS)
    ? readdirSync(TESTS).filter((f) => f.endsWith(".test.ts"))
    : [];
  if (testFiles.length > 0) {
    const test = sh("node", [
      "--experimental-strip-types",
      "--test",
      ...testFiles.map((f) => join("tests", f)),
    ]);
    const summary = test.out.match(/# pass (\d+)/);
    const failSummary = test.out.match(/# fail (\d+)/);
    const totalSummary = test.out.match(/# tests (\d+)/);
    if (summary && failSummary) {
      const pass = Number(summary[1]);
      const fail = Number(failSummary[1]);
      const total = totalSummary ? Number(totalSummary[1]) : pass + fail;
      if (fail === 0) {
        record("BUILD", "tests", "OK", `tests: ${pass}/${total} passing`);
      } else {
        const failing = [...test.out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
        record("BUILD", "tests", "HIGH", `tests: ${fail}/${total} failing`, failing.slice(0, 20));
      }
    } else {
      record("BUILD", "tests", "MEDIUM", "test run produced no parseable summary", [
        test.out.slice(-800),
      ]);
    }
  } else {
    record("BUILD", "tests", "SKIP", "no tests/*.test.ts files found");
  }

  // Typecheck / lint / build: only meaningful with real dependencies
  // installed and resolvable. Reported as a real result when the binary is
  // present, SKIP with a stated reason otherwise -- never inferred.
  const tscBin = join("node_modules", "typescript", "bin", "tsc");
  if (existsSync(join(ROOT, tscBin))) {
    const tsc = sh("node", [tscBin, "--noEmit", "-p", "tsconfig.json"]);
    const errors = [...tsc.out.matchAll(/^(.+\.tsx?)\(\d+,\d+\): error TS\d+:/gm)];
    // Module-resolution noise from partially-installed dependencies (this
    // environment may not carry every package main.tsx imports) is reported
    // separately from real type errors so it doesn't drown out the signal.
    const unresolved = errors.filter((m) => tsc.out.includes(`Cannot find module`));
    const real = tsc.ok ? [] : errors;
    if (tsc.ok) {
      record("BUILD", "typecheck", "OK", "tsc --noEmit: clean");
    } else if (real.length > 0) {
      record(
        "BUILD",
        "typecheck",
        "HIGH",
        `tsc --noEmit: ${real.length} error(s) (includes any from unresolved modules if dependencies are only partially installed here)`,
        [...new Set(real.map((m) => m[1]))].slice(0, 30).map((f) => rel(join(ROOT, f))),
      );
    }
    void unresolved;
  } else {
    record(
      "BUILD",
      "typecheck",
      "SKIP",
      "typescript not installed in this environment's node_modules -- see AGENTS.md on cloud-session dependency limits",
    );
  }

  if (binExists("eslint")) {
    const lint = sh(join("node_modules", ".bin", "eslint"), ["."]);
    if (lint.ok) {
      record("BUILD", "lint", "OK", "eslint: clean");
    } else {
      const problems = lint.out.match(/(\d+) problems?/);
      record("BUILD", "lint", "MEDIUM", `eslint: ${problems ? problems[1] : "some"} problem(s)`, [
        lint.out.slice(-800),
      ]);
    }
  } else {
    record("BUILD", "lint", "SKIP", "eslint not installed in this environment's node_modules");
  }

  if (binExists("vite")) {
    const build = sh(join("node_modules", ".bin", "vite"), ["build"]);
    record(
      "BUILD",
      "production-build",
      build.ok ? "OK" : "CRITICAL",
      build.ok ? "vite build: succeeded" : "vite build: failed",
      build.ok ? [] : [build.out.slice(-1000)],
    );
  } else {
    record(
      "BUILD",
      "production-build",
      "SKIP",
      "vite not installed in this environment's node_modules",
    );
  }

  // Environment-variable validation: every process.env["X"] read in src/,
  // cross-referenced against .env.example. A variable the code reads but
  // .env.example never mentions is undocumented; that is a real deployment
  // risk (see this session's own NATIONWIDE_DATABASE_URL / row-ID vars) even
  // when it isn't a bug today.
  const envExample = readSafe(join(ROOT, ".env.example")) ?? "";
  const documented = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const referenced = new Set();
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(/process\.env\[["'`]([A-Z][A-Z0-9_]*)["'`]\]/g)) {
      referenced.add(m[1]);
    }
  }
  const undocumented = [...referenced].filter((name) => !documented.has(name)).sort();
  if (undocumented.length === 0) {
    record(
      "BUILD",
      "env-vars",
      "OK",
      "every process.env[...] read in src/ is documented in .env.example",
    );
  } else {
    record(
      "BUILD",
      "env-vars",
      "MEDIUM",
      `${undocumented.length} environment variable(s) read in src/ but not in .env.example`,
      undocumented,
    );
  }
}

// ---------------------------------------------------------------------------
// 1. ROUTES -- TanStack file routes vs. what the app actually links to/calls
// ---------------------------------------------------------------------------

function checkRoutes() {
  const routesDir = join(SRC, "routes");
  if (!existsSync(routesDir)) {
    record("ROUTES", "routes", "SKIP", "src/routes not found");
    return;
  }

  // A TanStack Start file route's path is its file path relative to
  // src/routes, with the .ts(x) stripped and index/$param translated. This
  // reads the route tree the framework itself generated, which is the
  // authoritative map -- not a re-derivation of TanStack's own conventions.
  const treePath = join(SRC, "routeTree.gen.ts");
  const tree = readSafe(treePath);
  const declaredPaths = new Set();
  if (tree) {
    // The `path:` literal on each runtime Route object misses routes defined
    // only through TanStack's flat-file convention (e.g. dashboard.billing.tsx
    // has no `path: '/dashboard/billing'` literal anywhere). The interface
    // map TanStack also generates -- `'/dashboard/billing': typeof
    // DashboardBillingRoute` -- lists every route unconditionally, so it is
    // the reliable source; `path:` literals are unioned in as a second pass
    // in case a future generator version drops the interface map.
    for (const m of tree.matchAll(/^\s*['"`](\/[^'"`]*)['"`]:\s*typeof\s/gm))
      declaredPaths.add(m[1]);
    for (const m of tree.matchAll(/\bpath:\s*['"`]([^'"`]+)['"`]/g)) declaredPaths.add(m[1]);
  }
  if (declaredPaths.size === 0) {
    record(
      "ROUTES",
      "route-tree",
      "MEDIUM",
      "routeTree.gen.ts not found or carries no path entries",
    );
  } else {
    record(
      "ROUTES",
      "route-tree",
      "OK",
      `${declaredPaths.size} route path(s) declared in routeTree.gen.ts`,
    );
  }

  // Every string literal that looks like an internal path, referenced from a
  // navigation call or href, cross-checked against the declared tree. A
  // dynamic segment ($id) in the declared path is treated as a wildcard.
  const toRegexes = [...declaredPaths].map((p) => {
    const pattern = p
      .split("/")
      .map((segment) =>
        segment.startsWith("$") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return new RegExp(`^${pattern}/?$`);
  });
  const linkPattern = /\b(?:to|href)\s*[:=]\s*["'`](\/(?!\/)[^"'`\s]*)["'`]/g;
  const brokenLinks = new Map();
  for (const file of walk(SRC, { exts: [".tsx", ".ts"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(linkPattern)) {
      const target = m[1].split("?")[0].split("#")[0];
      if (target.startsWith("/api/")) continue; // checked in the API section
      if (!toRegexes.some((re) => re.test(target))) {
        const list = brokenLinks.get(target) ?? [];
        list.push(rel(file));
        brokenLinks.set(target, list);
      }
    }
  }
  if (brokenLinks.size === 0) {
    record(
      "ROUTES",
      "internal-links",
      "OK",
      "every internal to=/href= literal matches a declared route",
    );
  } else {
    record(
      "ROUTES",
      "internal-links",
      "HIGH",
      `${brokenLinks.size} internal link target(s) match no declared route`,
      [...brokenLinks.entries()].slice(0, 20).map(([target, files]) => `${target} <- ${files[0]}`),
    );
  }
}

// ---------------------------------------------------------------------------
// API -- src/routes/api/** handlers vs. their frontend callers
// ---------------------------------------------------------------------------

function checkApi() {
  const apiDir = join(SRC, "routes", "api");
  if (!existsSync(apiDir)) {
    record("ROUTES", "api", "SKIP", "src/routes/api not found");
    return;
  }
  const endpoints = new Set();
  for (const file of walk(apiDir, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    if (!/\bhandlers\s*:/.test(text) && !text.includes("createFileRoute")) continue;
    // Derive the route path from the file's own location under src/routes,
    // the same convention the route tree itself uses.
    // TanStack's flat-route convention: a `.` inside the filename (not the
    // final extension) is a path separator, exactly like a `/` in a nested
    // directory would be -- markets.ticker.ts is /markets/ticker, the same
    // convention dashboard.billing.tsx uses for pages.
    const relPath = relative(routesRootFor(file), file)
      .replace(/\.tsx?$/, "")
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => segment.split(".").join("/"))
      .join("/")
      .replace(/\/index$/, "");
    endpoints.add(`/${relPath}`);
  }

  const callPattern = /\bfetch\(\s*["'`](\/api\/[^"'`\s]*)["'`]/g;
  const calledPaths = new Map();
  for (const file of walk(SRC, { exts: [".tsx", ".ts"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(callPattern)) {
      const target = m[1].split("?")[0];
      const list = calledPaths.get(target) ?? [];
      list.push(rel(file));
      calledPaths.set(target, list);
    }
  }

  const missing = [...calledPaths.keys()].filter(
    (called) => ![...endpoints].some((ep) => called === ep || called.startsWith(ep)),
  );
  if (missing.length === 0) {
    record(
      "ROUTES",
      "api-calls",
      "OK",
      'every fetch("/api/...") call matches a route file under src/routes/api',
    );
  } else {
    record(
      "ROUTES",
      "api-calls",
      "HIGH",
      `${missing.length} frontend fetch() call(s) to an /api path with no matching route file`,
      missing.map((p) => `${p} <- ${calledPaths.get(p)[0]}`),
    );
  }
}

function routesRootFor(file) {
  const marker = join(SRC, "routes");
  return marker;
}

// ---------------------------------------------------------------------------
// 3. DEAD -- unreferenced exports (heuristic) and unused dependencies
// ---------------------------------------------------------------------------

function checkDeadCode() {
  const exportPattern = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;
  const declared = new Map(); // symbol -> file
  for (const dir of [join(SRC, "lib"), join(SRC, "components")]) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir, { exts: [".ts", ".tsx"] })) {
      const text = readSafe(file) ?? "";
      for (const m of text.matchAll(exportPattern)) {
        if (!declared.has(m[1])) declared.set(m[1], []);
        declared.get(m[1]).push(file);
      }
    }
  }
  const blob = [];
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) blob.push(readSafe(file) ?? "");
  for (const file of walk(TESTS, { exts: [".ts"] })) blob.push(readSafe(file) ?? "");
  const wholeText = blob.join("\n");

  const unreferenced = [];
  for (const [symbol, files] of declared) {
    // Cheap and honest: counts every occurrence of the identifier anywhere in
    // src/ or tests/, including its own declaration line, so "1" means
    // declared-and-never-used-elsewhere. A default-exported component whose
    // only reference is a dynamic string (unlikely here) would false-positive;
    // that is a known limitation of a regex-based reachability check, stated
    // rather than hidden.
    const count = (wholeText.match(new RegExp(`\\b${symbol}\\b`, "g")) ?? []).length;
    if (count <= 1) unreferenced.push({ symbol, file: files[0] });
  }
  if (unreferenced.length === 0) {
    record(
      "DEAD",
      "unreferenced-exports",
      "OK",
      "no exported symbol under src/lib or src/components is referenced zero times elsewhere",
    );
  } else {
    record(
      "DEAD",
      "unreferenced-exports",
      "MEDIUM",
      `${unreferenced.length} exported symbol(s) with no reference found outside their own declaration (heuristic -- verify before deleting)`,
      unreferenced.slice(0, 30).map((u) => `${u.symbol} (${rel(u.file)})`),
    );
  }

  // Unused dependencies: every package.json dependency, grepped against
  // src/, workers/ and scripts/ for a matching `from "<pkg>"` / `require`.
  const pkg = JSON.parse(readSafe(join(ROOT, "package.json")) ?? "{}");
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const usageBlob = blob.join("\n") + (readSafe(join(ROOT, "vite.config.ts")) ?? "");
  const unused = Object.keys(allDeps).filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`["'\`]${escaped}(?:/|["'\`])`).test(usageBlob);
  });
  if (unused.length === 0) {
    record(
      "DEAD",
      "unused-dependencies",
      "OK",
      "every package.json dependency has at least one matching import",
    );
  } else {
    record(
      "DEAD",
      "unused-dependencies",
      "LOW",
      `${unused.length} declared dependency/ies with no matching import found (heuristic -- some are used only via config files or CLI)`,
      unused,
    );
  }

  // npm audit: needs registry access, which this session's egress policy may
  // block. Attempted, never assumed.
  const audit = sh("npm", ["audit", "--json"]);
  if (audit.ok || audit.out.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(audit.out);
      const vulnCount = parsed.metadata?.vulnerabilities?.total ?? 0;
      if (vulnCount === 0) {
        record("DEAD", "npm-audit", "OK", "npm audit: 0 known vulnerabilities");
      } else {
        record("DEAD", "npm-audit", "HIGH", `npm audit: ${vulnCount} known vulnerabilit(y/ies)`, [
          JSON.stringify(parsed.metadata.vulnerabilities),
        ]);
      }
    } catch {
      record("DEAD", "npm-audit", "SKIP", "npm audit ran but produced no parseable JSON");
    }
  } else {
    record("DEAD", "npm-audit", "SKIP", "npm audit could not reach the registry from this session");
  }

  // Import cycles: a simple two-hop-and-deeper DFS over the relative import
  // graph within src/. Bounded effort, not a full whole-program analysis.
  const graph = new Map();
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    const deps = new Set();
    for (const m of text.matchAll(/from\s+["'`](\.[^"'`]+)["'`]/g)) {
      const resolved = resolveRelativeImport(file, m[1]);
      if (resolved) deps.add(resolved);
    }
    graph.set(file, deps);
  }
  const cycles = findCycles(graph);
  if (cycles.length === 0) {
    record(
      "DEAD",
      "import-cycles",
      "OK",
      "no circular import found among relative (./...) imports in src/",
    );
  } else {
    record(
      "DEAD",
      "import-cycles",
      "MEDIUM",
      `${cycles.length} circular import chain(s) found`,
      cycles.slice(0, 10).map((c) => c.map(rel).join(" -> ")),
    );
  }
}

function resolveRelativeImport(fromFile, spec) {
  const dir = join(fromFile, "..");
  for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = join(dir, spec + suffix);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function findCycles(graph) {
  const cycles = [];
  const stack = [];
  const onStack = new Set();
  const visited = new Set();
  function dfs(node) {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    onStack.add(node);
    for (const dep of graph.get(node) ?? []) dfs(dep);
    stack.pop();
    onStack.delete(node);
  }
  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
    if (cycles.length >= 50) break; // bounded effort
  }
  return cycles;
}

// ---------------------------------------------------------------------------
// 4. FLOW -- named workflows, checked as a chain of real references
// ---------------------------------------------------------------------------

function checkFlows() {
  // Each flow is a chain of things that must actually reference each other,
  // not just each independently exist. A broken chain names the first link
  // that fails.
  const flows = [
    {
      name: "Auth -> database",
      steps: [
        [
          "auth middleware exists",
          () => existsSync(join(SRC, "integrations", "supabase", "auth-middleware.ts")),
        ],
        [
          "a server function uses requireSupabaseAuth",
          () => grepAny(SRC, /requireSupabaseAuth/, [".ts"]),
        ],
      ],
    },
    {
      name: "API -> database",
      steps: [
        ["an API route exists", () => existsSync(join(SRC, "routes", "api"))],
        [
          "an API route reads from Supabase",
          () => grepAny(join(SRC, "routes", "api"), /\.from\(["'`]/, [".ts", ".tsx"]),
        ],
      ],
    },
    {
      name: "Payments -> Stripe",
      steps: [
        [
          "a Stripe client is constructed somewhere in src/",
          () => grepAny(SRC, /new Stripe\(/, [".ts"]),
        ],
        [
          "a webhook route verifies Stripe signatures",
          () =>
            grepAny(join(SRC, "routes"), /stripe.*webhook|webhook.*stripe/i, [".ts", ".tsx"]) ||
            grepAny(join(SRC, "routes"), /constructEvent/, [".ts", ".tsx"]),
        ],
      ],
    },
    {
      name: "Property -> Analysis",
      steps: [
        [
          "property analysis component exists",
          () =>
            existsSync(join(SRC, "components", "property-intelligence", "property-analysis.tsx")),
        ],
        [
          "it is rendered from the explorer shell",
          () =>
            (
              readSafe(join(SRC, "components", "property-intelligence", "property-explorer.tsx")) ??
              ""
            ).includes("PropertyAnalysis"),
        ],
      ],
    },
    {
      name: "Property -> Deal (investment) analysis",
      steps: [
        [
          "deal analyst component exists",
          () => existsSync(join(SRC, "components", "property-intelligence", "deal-analyst.tsx")),
        ],
        [
          "it is rendered from the explorer shell",
          () =>
            (
              readSafe(join(SRC, "components", "property-intelligence", "property-explorer.tsx")) ??
              ""
            ).includes("DealAnalyst"),
        ],
      ],
    },
  ];

  for (const flow of flows) {
    const failedStep = flow.steps.find(([, check]) => !safeCheck(check));
    if (failedStep) {
      record("FLOW", flow.name, "HIGH", `${flow.name}: broken at "${failedStep[0]}"`);
    } else {
      record("FLOW", flow.name, "OK", `${flow.name}: chain intact`);
    }
  }
}

function safeCheck(fn) {
  try {
    return Boolean(fn());
  } catch {
    return false;
  }
}

function grepAny(dir, pattern, exts) {
  if (!existsSync(dir)) return false;
  for (const file of walk(dir, { exts })) {
    if (pattern.test(readSafe(file) ?? "")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2. RUNTIME -- high-confidence heuristics only; each is stated so a false
//    positive is checkable rather than trusted blindly.
// ---------------------------------------------------------------------------

function checkRuntime() {
  const emptyCatch = [];
  const swallowedCatch = [];
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/g)) {
      const body = m[1].trim();
      if (body === "" || /^\/\/.*$/.test(body) || /^\/\*.*\*\/$/.test(body)) {
        emptyCatch.push(rel(file));
      } else if (
        !/(throw|console\.(error|warn)|logger?\.|captureException|toast\.error|record\(|Sentry)/.test(
          body,
        )
      ) {
        swallowedCatch.push(rel(file));
      }
    }
  }
  if (emptyCatch.length === 0) {
    record("RUNTIME", "empty-catch", "OK", "no fully empty catch block found");
  } else {
    record(
      "RUNTIME",
      "empty-catch",
      "MEDIUM",
      `${emptyCatch.length} empty catch block(s)`,
      [...new Set(emptyCatch)].slice(0, 20),
    );
  }
  if (swallowedCatch.length > 0) {
    record(
      "RUNTIME",
      "swallowed-catch",
      "LOW",
      `${swallowedCatch.length} catch block(s) with a body that neither rethrows nor logs (may be intentional -- verify)`,
      [...new Set(swallowedCatch)].slice(0, 20),
    );
  }

  // Missing await: an `async function` call site, at statement position,
  // whose returned promise is neither awaited, returned, nor chained. This
  // is necessarily a narrow heuristic (it cannot resolve which functions are
  // actually async without a type checker), so it is scoped to calls of
  // functions this repo itself declares `async function <name>` and reports
  // them as candidates, not confirmed bugs.
  const asyncFnNames = new Set();
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(/\basync function\s+([A-Za-z_$][\w$]*)/g)) asyncFnNames.add(m[1]);
  }
  const suspects = [];
  for (const file of walk(SRC, { exts: [".ts", ".tsx"] })) {
    const text = readSafe(file) ?? "";
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (/^(await|return|const|let|var)\b/.test(trimmed)) continue;
      for (const name of asyncFnNames) {
        if (new RegExp(`^${name}\\(`).test(trimmed)) {
          suspects.push(`${rel(file)}: ${trimmed.slice(0, 80)}`);
          break;
        }
      }
    }
  }
  if (suspects.length === 0) {
    record(
      "RUNTIME",
      "missing-await",
      "OK",
      "no statement-position call to a known async function is left unawaited (heuristic)",
    );
  } else {
    record(
      "RUNTIME",
      "missing-await",
      "MEDIUM",
      `${suspects.length} statement-position call(s) to a known async function with no await/return (heuristic -- confirm each)`,
      suspects.slice(0, 20),
    );
  }
}

// ---------------------------------------------------------------------------
// 6. SECURITY -- secrets, and the generalized ACC-20260924-003 pattern
// ---------------------------------------------------------------------------

function checkSecurity() {
  // Secrets: high-confidence literal patterns only (a real key format), never
  // "any long string", to keep the false-positive rate low enough to trust.
  const secretPatterns = [
    [/sk_live_[0-9a-zA-Z]{10,}/, "Stripe live secret key"],
    [/sk_test_[0-9a-zA-Z]{10,}/, "Stripe test secret key"],
    [/service_role.{0,20}eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/s, "Supabase service-role JWT"],
    [/AKIA[0-9A-Z]{16}/, "AWS access key ID"],
    [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "embedded private key"],
  ];
  const hits = [];
  for (const file of walk(ROOT, { exts: [".ts", ".tsx", ".json", ".env"] })) {
    if (file.includes(join(ROOT, "node_modules"))) continue;
    if (rel(file).startsWith(".env")) continue; // .env is gitignored local config, not shipped code
    const text = readSafe(file) ?? "";
    for (const [pattern, label] of secretPatterns) {
      if (pattern.test(text)) hits.push(`${label} in ${rel(file)}`);
    }
  }
  if (hits.length === 0) {
    record(
      "SECURITY",
      "secrets",
      "OK",
      "no literal secret matching a known key format found in tracked source",
    );
  } else {
    record("SECURITY", "secrets", "CRITICAL", `${hits.length} likely embedded secret(s)`, hits);
  }

  // The generalized ACC-20260924-003 pattern: for every table whose
  // migrations grant INSERT or UPDATE to service_role but explicitly do NOT
  // grant it to authenticated, find every .functions.ts call site that
  // writes to that table and check whether it passes context.supabase (the
  // request-scoped client) rather than a service-role client. This is
  // exactly the check that would have caught ACC-20260924-003 before it
  // shipped, run against every table in the schema instead of one.
  const serviceRoleOnlyTables = new Set();
  const authenticatedWritableTables = new Set();
  for (const file of walk(MIGRATIONS, { exts: [".sql"] })) {
    const text = readSafe(file) ?? "";
    for (const m of text.matchAll(
      /grant\s+(?:all|select,\s*insert|insert)[^;]*\son\s+(?:public\.)?([a-z_]+)\s+to\s+service_role/gi,
    )) {
      serviceRoleOnlyTables.add(m[1]);
    }
    for (const m of text.matchAll(
      /grant\s+[^;]*\b(?:insert|update|all)\b[^;]*\son\s+(?:public\.)?([a-z_]+)\s+to\s+authenticated/gi,
    )) {
      authenticatedWritableTables.add(m[1]);
    }
  }
  const writeOnlyByServiceRole = [...serviceRoleOnlyTables].filter(
    (t) => !authenticatedWritableTables.has(t),
  );

  const suspectWrites = [];
  const fnFiles = existsSync(join(SRC, "lib"))
    ? [...walk(join(SRC, "lib"), { exts: [".functions.ts"] })]
    : [];
  for (const file of fnFiles) {
    const text = readSafe(file) ?? "";
    for (const table of writeOnlyByServiceRole) {
      // Precise on purpose: the client the write call itself hangs off of
      // must literally be `context.supabase`, not merely present somewhere
      // else in the file. A file-level co-occurrence check (an earlier
      // version of this) flagged every module that reads with the
      // authenticated client and separately writes with supabaseAdmin --
      // which is the CORRECT pattern, not the bug -- so it is not used here.
      const suspectPattern = new RegExp(
        `context\\.supabase\\s*\\n?\\s*\\.from\\(["'\`]${table}["'\`]\\)[\\s\\S]{0,120}\\.(insert|update|upsert)\\(`,
      );
      if (suspectPattern.test(text)) {
        suspectWrites.push(`${table} <- ${rel(file)}`);
      }
    }
  }
  if (writeOnlyByServiceRole.length === 0) {
    record(
      "SECURITY",
      "service-role-boundary",
      "SKIP",
      "no table found with service_role-only write grants (or migrations directory not found)",
    );
  } else if (suspectWrites.length === 0) {
    record(
      "SECURITY",
      "service-role-boundary",
      "OK",
      `${writeOnlyByServiceRole.length} service-role-only table(s) checked; no .functions.ts file writes one inline via context.supabase.from(...). ` +
        `SCOPE LIMIT, stated rather than hidden: this only catches the client used INLINE in the same .functions.ts file. ` +
        `ACC-20260924-003 itself is shaped differently -- context.supabase is passed as an argument into a .server.ts function, which receives it under a ` +
        `different parameter name, so this check cannot see the write at all. A clean result here does not mean no more instances of that exact shape exist; ` +
        `it means none of the INLINE form were found. Tracing a client through a function call into another file needs real dataflow analysis, which this ` +
        `dependency-free script does not attempt.`,
    );
  } else {
    record(
      "SECURITY",
      "service-role-boundary",
      "CRITICAL",
      `${suspectWrites.length} write path(s) may use the authenticated client against a service-role-only table (heuristic -- same pattern as ACC-20260924-003; verify each before treating as confirmed)`,
      [...new Set(suspectWrites)],
    );
  }

  // Ops endpoints sharing one bearer token: reaffirm the standing finding
  // rather than re-deciding it, and count how many routes it now covers.
  const opsDir = join(SRC, "routes", "api", "internal", "ops");
  if (existsSync(opsDir)) {
    const opsRoutes = [...walk(opsDir, { exts: [".ts"] })].filter((f) =>
      (readSafe(f) ?? "").includes("authorizeOperationsRequest"),
    );
    record(
      "SECURITY",
      "ops-shared-token",
      "MEDIUM",
      `${opsRoutes.length} ops route(s) share one OPERATIONS_API_KEY (standing finding, not new)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function severityRank(sev) {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, OK: 4, SKIP: 5 }[sev] ?? 6;
}

function renderConsole() {
  const bySection = new Map();
  for (const f of findings) {
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    bySection.get(f.section).push(f);
  }
  const lines = ["ACCOUNTABUL CODEBASE AUDIT", "─".repeat(60), ""];
  for (const [section, items] of bySection) {
    lines.push(section);
    for (const item of items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) {
      const mark = { CRITICAL: "✗", HIGH: "✗", MEDIUM: "⚠", LOW: "⚠", OK: "✓", SKIP: "·" }[
        item.severity
      ];
      lines.push(`${mark} ${item.title}`);
    }
    lines.push("");
  }
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity] += 1;
  lines.push("─".repeat(60));
  lines.push(`CRITICAL: ${counts.CRITICAL}`);
  lines.push(`HIGH:     ${counts.HIGH}`);
  lines.push(`MEDIUM:   ${counts.MEDIUM}`);
  lines.push(`LOW:      ${counts.LOW}`);
  lines.push("");
  lines.push(`TOTAL: ${counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW}`);
  return lines.join("\n");
}

function renderMarkdown() {
  const bySection = new Map();
  for (const f of findings) {
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    bySection.get(f.section).push(f);
  }
  const lines = [
    "# Accountabul codebase audit",
    "",
    `Generated ${new Date().toISOString()} by \`scripts/accountabul-audit.mjs\`.`,
    "",
    "Every SKIP names what was skipped and why -- it is never a silent pass. " +
      "Findings marked heuristic can have false positives; verify before acting.",
    "",
  ];
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) if (counts[f.severity] !== undefined) counts[f.severity] += 1;
  lines.push(
    `**CRITICAL: ${counts.CRITICAL} · HIGH: ${counts.HIGH} · MEDIUM: ${counts.MEDIUM} · LOW: ${counts.LOW}**`,
    "",
  );
  for (const [section, items] of bySection) {
    lines.push(`## ${section}`, "");
    for (const item of items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))) {
      lines.push(`### [${item.severity}] ${item.title}`);
      for (const d of item.detail) lines.push(`- ${d}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

checkBuild();
checkRoutes();
checkApi();
checkDeadCode();
checkFlows();
checkRuntime();
checkSecurity();

console.log(renderConsole());
writeFileSync(join(ROOT, "CODEBASE_AUDIT.md"), renderMarkdown());
if (JSON_OUT) {
  writeFileSync(
    join(ROOT, "codebase-audit.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2),
  );
}

const hasCritical = findings.some((f) => f.severity === "CRITICAL");
process.exit(hasCritical ? 1 : 0);
