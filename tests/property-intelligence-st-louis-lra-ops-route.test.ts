// Activation wiring for the staged nationwide rollout. The ingestion
// entrypoint itself is covered by property-intelligence-st-louis-lra-live.test.ts;
// what regresses silently here is the route around it -- losing the bearer
// guard, taking the two live row IDs from the request body instead of the
// environment, or dropping the 503 that keeps an unconfigured deployment
// inert. The route imports @tanstack/react-router, so these are source-level
// assertions in this repo's existing style for ops routes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROUTE_PATH = "../src/routes/api/internal/ops/nationwide-st-louis-lra-ingest.ts";

function sourceOf(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("the ingestion entrypoint is reachable from a registered route", () => {
  const tree = sourceOf("../src/routeTree.gen.ts");
  assert.match(tree, /'\/api\/internal\/ops\/nationwide-st-louis-lra-ingest'/);
  assert.match(sourceOf(ROUTE_PATH), /runLiveStLouisLraIngestionWithRealDatabase\(/);
});

test("the route is bearer-guarded by OPERATIONS_API_KEY before it does anything", () => {
  const source = sourceOf(ROUTE_PATH);
  const guard = source.indexOf("authorizeOperationsRequest(request");
  const run = source.indexOf("runLiveStLouisLraIngestionWithRealDatabase(");
  assert.ok(guard > 0, "route must call authorizeOperationsRequest");
  assert.match(source, /OPERATIONS_API_KEY/);
  assert.ok(guard < run, "the auth guard must run before the ingestion call");
});

test("the live row IDs come from the environment, never from the request", () => {
  const source = sourceOf(ROUTE_PATH);
  assert.match(source, /process\.env\["NATIONWIDE_ST_LOUIS_LRA_SOURCE_DEFINITION_ID"\]/);
  assert.match(source, /process\.env\["NATIONWIDE_ST_LOUIS_LRA_JURISDICTION_ID"\]/);
  // A caller-supplied sourceDefinitionId would point a real ingestion run at
  // an arbitrary row, so the route must not read the request body at all.
  assert.doesNotMatch(source, /request\.(json|text|formData)\(/);
});

test("an unconfigured deployment answers 503 instead of attempting a run", () => {
  const source = sourceOf(ROUTE_PATH);
  const check = source.indexOf("!sourceDefinitionId || !jurisdictionId");
  const run = source.indexOf("runLiveStLouisLraIngestionWithRealDatabase(");
  assert.ok(check > 0, "route must check both IDs are configured");
  assert.ok(check < run, "the configuration check must run before the ingestion call");
  assert.match(source, /status:\s*503/);
});

test("the route exposes no GET -- a real ingestion run is never a safe method", () => {
  const source = sourceOf(ROUTE_PATH);
  assert.match(source, /POST:\s*async/);
  assert.doesNotMatch(source, /\bGET:\s*async/);
});
