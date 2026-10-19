import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export type StripeKeyPurpose = "member" | "operations" | "webhook";

const stripeClients = new Map<StripeKeyPurpose, Stripe>();

const PURPOSE_ENV: Record<StripeKeyPurpose, string> = {
  member: "STRIPE_MEMBER_RESTRICTED_KEY",
  operations: "STRIPE_OPERATIONS_RESTRICTED_KEY",
  webhook: "STRIPE_WEBHOOK_RESTRICTED_KEY",
};

export const STRIPE_INTEGRATION_IDENTIFIER = "accountabul_web_kqrmvznp";

export type StripeRuntimeConfig = {
  accountId: string;
  client: Stripe;
};

/**
 * Returns the account-scoped Stripe client used by Accountabul.
 *
 * STRIPE_ACCOUNT_ID is required even though standard-account requests do not
 * send a Stripe-Account header. Persisting and checking this identifier keeps
 * records from two standalone Stripe accounts from being reconciled together.
 */
export function getStripeRuntime(purpose: StripeKeyPurpose = "member"): StripeRuntimeConfig {
  if (purpose === "member") requireStripeCheckoutSecrets();
  const keyName = PURPOSE_ENV[purpose];
  const secretKey = process.env[keyName];
  const accountId = process.env["STRIPE_ACCOUNT_ID"];

  if (!secretKey || !accountId) {
    throw new Error(`Stripe is not configured. ${keyName} and STRIPE_ACCOUNT_ID are required.`);
  }
  if (!accountId.startsWith("acct_")) {
    throw new Error("STRIPE_ACCOUNT_ID must be a Stripe account ID.");
  }
  if (!secretKey.startsWith("rk_")) {
    throw new Error(`${keyName} must be a restricted Stripe key.`);
  }
  const liveMode = process.env["STRIPE_LIVE_MODE"] === "true";
  if (liveMode && !secretKey.startsWith("rk_live_")) {
    throw new Error(`${keyName} must be a live restricted key when STRIPE_LIVE_MODE is true.`);
  }
  if (!liveMode && secretKey.startsWith("rk_live_")) {
    throw new Error(`${keyName} must not be a live key unless STRIPE_LIVE_MODE is true.`);
  }

  let stripeClient = stripeClients.get(purpose);
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      appInfo: {
        name: "Accountabul",
        version: "1.0.0",
        url: "https://accountabul.com",
      },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
    stripeClients.set(purpose, stripeClient);
  }

  return { accountId, client: stripeClient };
}

export function isStripePurposeConfigured(purpose: StripeKeyPurpose) {
  const secretKey = process.env[PURPOSE_ENV[purpose]];
  const accountId = process.env["STRIPE_ACCOUNT_ID"];
  return Boolean(secretKey?.startsWith("rk_") && accountId?.startsWith("acct_"));
}

export function missingStripeCheckoutSecrets() {
  const missing: string[] = [];
  if (!process.env["STRIPE_ACCOUNT_ID"]?.startsWith("acct_")) missing.push("STRIPE_ACCOUNT_ID");
  if (!process.env["STRIPE_MEMBER_RESTRICTED_KEY"]?.startsWith("rk_")) {
    missing.push("STRIPE_MEMBER_RESTRICTED_KEY");
  }
  if (!process.env["PUBLIC_SITE_URL"]) missing.push("PUBLIC_SITE_URL");
  return missing;
}

export function requireStripeCheckoutSecrets() {
  const missing = missingStripeCheckoutSecrets();
  if (missing.length > 0) {
    throw new Error(`Stripe checkout is not configured. Missing ${missing.join(", ")}.`);
  }
}

export function stripeCheckoutUnavailableResponse() {
  const missing = missingStripeCheckoutSecrets();
  if (missing.length === 0) return null;
  return Response.json({ error: "Checkout is not configured.", missing }, { status: 503 });
}

export function missingStripeWebhookSecrets() {
  const missing: string[] = [];
  if (!process.env["STRIPE_ACCOUNT_ID"]?.startsWith("acct_")) missing.push("STRIPE_ACCOUNT_ID");
  if (!process.env["STRIPE_WEBHOOK_RESTRICTED_KEY"]?.startsWith("rk_")) {
    missing.push("STRIPE_WEBHOOK_RESTRICTED_KEY");
  }
  if (!process.env["STRIPE_WEBHOOK_SECRET"]?.startsWith("whsec_")) {
    missing.push("STRIPE_WEBHOOK_SECRET");
  }
  return missing;
}

export function requireStripeWebhookSecrets() {
  const missing = missingStripeWebhookSecrets();
  if (missing.length > 0) {
    throw new Error(`Stripe webhooks are not configured. Missing ${missing.join(", ")}.`);
  }
}

export function requirePublicSiteUrl() {
  const value = process.env["PUBLIC_SITE_URL"];
  if (!value) throw new Error("PUBLIC_SITE_URL is required for Stripe return URLs.");
  return value.replace(/\/$/, "");
}
