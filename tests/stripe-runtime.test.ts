import assert from "node:assert/strict";
import test from "node:test";

import {
  getStripeRuntime,
  isStripePurposeConfigured,
  missingStripeCheckoutSecrets,
  missingStripeWebhookSecrets,
  requirePublicSiteUrl,
  requireStripeCheckoutSecrets,
  requireStripeWebhookSecrets,
  stripeCheckoutUnavailableResponse,
} from "../src/lib/stripe/client.server.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("checkout runtime fails closed without a restricted member key", () => {
  withEnv(
    {
      STRIPE_ACCOUNT_ID: "acct_1TESTPLACEHOLDER",
      STRIPE_MEMBER_RESTRICTED_KEY: undefined,
      STRIPE_LIVE_MODE: "true",
    },
    () => {
      assert.equal(isStripePurposeConfigured("member"), false);
      assert.throws(() => getStripeRuntime("member"), /STRIPE_MEMBER_RESTRICTED_KEY/);
    },
  );
});

test("checkout runtime rejects secret keys and test keys in live mode", () => {
  withEnv(
    {
      STRIPE_ACCOUNT_ID: "acct_1TESTPLACEHOLDER",
      STRIPE_LIVE_MODE: "true",
      PUBLIC_SITE_URL: "http://localhost:3000",
    },
    () => {
      withEnv({ STRIPE_MEMBER_RESTRICTED_KEY: "sk_live_not_allowed" }, () => {
        assert.throws(() => getStripeRuntime("member"), /STRIPE_MEMBER_RESTRICTED_KEY/);
      });
      withEnv({ STRIPE_MEMBER_RESTRICTED_KEY: "rk_test_not_for_live" }, () => {
        assert.throws(() => getStripeRuntime("member"), /live restricted key/);
      });
    },
  );
});

test("checkout names every missing secret instead of opening Stripe", () => {
  withEnv(
    {
      STRIPE_ACCOUNT_ID: "acct_1TESTPLACEHOLDER",
      STRIPE_MEMBER_RESTRICTED_KEY: undefined,
      PUBLIC_SITE_URL: "http://localhost:3000",
    },
    () => {
      assert.deepEqual(missingStripeCheckoutSecrets(), ["STRIPE_MEMBER_RESTRICTED_KEY"]);
      assert.throws(() => requireStripeCheckoutSecrets(), /STRIPE_MEMBER_RESTRICTED_KEY/);
    },
  );
});

test("webhook checkout return URL is required", () => {
  withEnv({ PUBLIC_SITE_URL: undefined }, () => {
    assert.throws(() => requirePublicSiteUrl(), /PUBLIC_SITE_URL is required/);
  });
});

test("webhook runtime fails closed without a restricted webhook key", () => {
  withEnv(
    {
      STRIPE_ACCOUNT_ID: "acct_1TESTPLACEHOLDER",
      STRIPE_WEBHOOK_RESTRICTED_KEY: undefined,
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_LIVE_MODE: "true",
    },
    () => {
      assert.equal(isStripePurposeConfigured("webhook"), false);
      assert.deepEqual(missingStripeWebhookSecrets(), ["STRIPE_WEBHOOK_RESTRICTED_KEY"]);
      assert.throws(() => requireStripeWebhookSecrets(), /STRIPE_WEBHOOK_RESTRICTED_KEY/);
      assert.throws(() => getStripeRuntime("webhook"), /STRIPE_WEBHOOK_RESTRICTED_KEY/);
    },
  );
});

test("public checkout routes can return 503 before opening Stripe", async () => {
  let response: Response | null = null;
  withEnv(
    {
      STRIPE_ACCOUNT_ID: "acct_1TESTPLACEHOLDER",
      STRIPE_MEMBER_RESTRICTED_KEY: undefined,
      PUBLIC_SITE_URL: "http://localhost:8080",
    },
    () => {
      response = stripeCheckoutUnavailableResponse();
    },
  );
  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), {
    error: "Checkout is not configured.",
    missing: ["STRIPE_MEMBER_RESTRICTED_KEY"],
  });
});
