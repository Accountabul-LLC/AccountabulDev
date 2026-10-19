import assert from "node:assert/strict";
import test from "node:test";

import { resolvePropertyIntelligenceAccess } from "../src/lib/property-intelligence/access.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const ACTIVE_MEMBERSHIP = {
  status: "active" as const,
  currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  graceExpiresAt: null,
};
const LAPSED_MEMBERSHIP = {
  status: "canceled" as const,
  currentPeriodEnd: null,
  graceExpiresAt: null,
};

function base(overrides: Partial<Parameters<typeof resolvePropertyIntelligenceAccess>[0]> = {}) {
  return resolvePropertyIntelligenceAccess({
    accessMode: "members",
    isAdmin: false,
    membership: null,
    hasIndividualGrant: false,
    now: NOW,
    ...overrides,
  });
}

test("ACC-20260923-004: defaults deny a signed-in account with no membership, grant or admin role", () => {
  const result = base();
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "members_only");
});

test("an active membership is allowed under the default 'members' mode", () => {
  const result = base({ membership: ACTIVE_MEMBERSHIP });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "active_membership");
});

test("a lapsed membership is not allowed under 'members' mode", () => {
  const result = base({ membership: LAPSED_MEMBERSHIP });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "members_only");
});

test("the individual grant allowlist overrides mode and membership", () => {
  const result = base({ hasIndividualGrant: true });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "individual_grant");
});

test("admin always has access regardless of mode", () => {
  const result = base({ isAdmin: true, accessMode: "members" });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "admin");
});

test("flipping accessMode to 'open' allows any signed-in account with no membership or grant", () => {
  const result = base({ accessMode: "open" });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "open_mode");
});
