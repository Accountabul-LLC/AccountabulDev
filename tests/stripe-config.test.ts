import assert from "node:assert/strict";
import test from "node:test";

import { STRIPE_INTEGRATION_IDENTIFIER } from "../src/lib/stripe/client.server.ts";

test("Stripe Checkout integration identifier has the required stable random suffix", () => {
  assert.match(STRIPE_INTEGRATION_IDENTIFIER, /^accountabul_web_[a-z]{8}$/);
});
