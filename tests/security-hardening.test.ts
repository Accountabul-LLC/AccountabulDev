import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emailsMatch, normalizeEmail } from "../src/lib/security/emails.ts";
import { clientAddress, rateLimitResponse } from "../src/lib/security/rate-limit.server.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260904090000_security_assessment_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const verification = readFileSync(
  new URL("../src/lib/business/verification.functions.ts", import.meta.url),
  "utf8",
);
const conference = readFileSync(
  new URL("../src/lib/conference/conference.functions.ts", import.meta.url),
  "utf8",
);
const checkout = readFileSync(
  new URL("../src/routes/api/public/paid-comments.$id.checkout.ts", import.meta.url),
  "utf8",
);
const webhook = readFileSync(
  new URL("../src/routes/api/public/webhooks/stripe.ts", import.meta.url),
  "utf8",
);
const catalog = readFileSync(
  new URL("../src/routes/api/internal/ops/catalog.ts", import.meta.url),
  "utf8",
);
const opsEvents = readFileSync(
  new URL("../src/routes/api/internal/ops/events.ts", import.meta.url),
  "utf8",
);
const billing = readFileSync(
  new URL("../src/lib/billing/billing.functions.ts", import.meta.url),
  "utf8",
);
const tips = readFileSync(new URL("../src/lib/tips.functions.ts", import.meta.url), "utf8");
const publicTips = readFileSync(
  new URL("../src/routes/api/public/tips.ts", import.meta.url),
  "utf8",
);
const eventPasses = readFileSync(
  new URL("../src/routes/api/public/event-passes.ts", import.meta.url),
  "utf8",
);
const eventAccess = readFileSync(
  new URL("../src/lib/conference/event-access.server.ts", import.meta.url),
  "utf8",
);
const tierLock = readFileSync(
  new URL("../supabase/migrations/20260904123000_lock_membership_tier_writes.sql", import.meta.url),
  "utf8",
);
const eventBillingLock = readFileSync(
  new URL("../supabase/migrations/20260904130000_lock_event_billing_columns.sql", import.meta.url),
  "utf8",
);
const eventWriteLock = readFileSync(
  new URL("../supabase/migrations/20260904131000_lock_event_client_writes.sql", import.meta.url),
  "utf8",
);
const authServer = readFileSync(
  new URL("../src/lib/conference/auth.server.ts", import.meta.url),
  "utf8",
);
const stripeRuntime = readFileSync(
  new URL("../src/lib/stripe/client.server.ts", import.meta.url),
  "utf8",
);
const speakerJoin = readFileSync(
  new URL("../src/routes/api/public/speakers/join.ts", import.meta.url),
  "utf8",
);
const speakerJoinPage = readFileSync(
  new URL("../src/routes/speakers.join.tsx", import.meta.url),
  "utf8",
);
const speakerRequests = readFileSync(
  new URL("../src/routes/api/internal/ops/speaker-requests.ts", import.meta.url),
  "utf8",
);
const opsStudio = readFileSync(
  new URL("../src/routes/api/internal/ops/studio.ts", import.meta.url),
  "utf8",
);
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("authenticated events and businesses lose stream and tax columns", () => {
  assert.match(migration, /REVOKE SELECT ON public\.events FROM authenticated/);
  assert.match(migration, /GRANT SELECT \(/);
  assert.doesNotMatch(migration, /embed_url/);
  assert.doesNotMatch(migration, /replay_url_path/);
  assert.match(migration, /REVOKE SELECT ON public\.businesses FROM authenticated/);
  assert.doesNotMatch(migration, /tax_id_last4/);
  assert.doesNotMatch(migration, /verification_reference/);
  assert.match(migration, /DROP POLICY IF EXISTS property_inquiries_guest_insert/);
  assert.match(migration, /DROP POLICY IF EXISTS service_inquiries_guest_insert/);
  assert.match(migration, /public\.can_manage_business\(p_business_id, auth\.uid\(\)\)/);
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.review_business\(uuid, text, text, text\)[\s\S]*FROM public, anon, authenticated/,
  );
  assert.match(migration, /get_my_business_profile/);
});

test("verification cannot self-publish and requires a granting tier", () => {
  assert.match(verification, /grants_vendor_verification/);
  assert.match(verification, /profile_status: "pending_review"/);
  assert.doesNotMatch(verification, /Your business is now a Verified Vendor/);
  assert.doesNotMatch(verification, /profile_status: "published"/);
});

test("live chat re-derives ban state before insert", () => {
  const liveChat = readFileSync(
    new URL("../src/lib/conference/live-chat.functions.ts", import.meta.url),
    "utf8",
  );
  // The ban is read on every attempt, inside the one decision both Send and
  // Pay go through, before anything is published or a checkout is created.
  const decide = liveChat.slice(liveChat.indexOf("async function decideFor"));
  assert.match(decide, /rpc\("is_chat_banned"/);
  assert.ok(decide.indexOf("is_chat_banned") < decide.indexOf("decideChatSend("));
  assert.equal(liveChat.match(/await decideFor\(data\.eventId\)/g)?.length, 2);
  for (const handler of ["sendLiveChatMessage", "payForLiveChatComment"]) {
    const body = liveChat.slice(liveChat.indexOf(`export const ${handler}`));
    const decided = body.indexOf("await decideFor(data.eventId)");
    const publishes = body.indexOf("publishLiveChatMessage(");
    assert.ok(decided > -1 && decided < publishes, `${handler} publishes before checking bans`);
  }
});

test("paid-comment checkout binds the submitter email and recovers failed payments", () => {
  assert.match(checkout, /guestEmail/);
  assert.match(checkout, /emailsMatch/);
  assert.match(checkout, /\.in\("status", \["approved", "payment_failed"\]\)/);
  assert.match(checkout, /rateLimitResponse/);
});

test("Stripe runtime requires live restricted keys and rejects secret keys", () => {
  assert.match(stripeRuntime, /must be a restricted Stripe key/);
  assert.match(stripeRuntime, /rk_live_/);
  assert.match(webhook, /Webhook secret not configured/);
  assert.match(webhook, /Webhook key not configured/);
  assert.match(webhook, /getStripeRuntime\("webhook"\)/);
});

test("membership prices are not writable by browser roles and catalog writes stay gated", () => {
  assert.match(
    tierLock,
    /REVOKE ALL ON TABLE public\.membership_tiers FROM PUBLIC, anon, authenticated/,
  );
  assert.match(tierLock, /GRANT SELECT ON TABLE public\.membership_tiers TO anon, authenticated/);
  assert.match(tierLock, /DROP POLICY IF EXISTS "Admins can update membership tiers"/);
  assert.match(eventBillingLock, /REVOKE UPDATE \([\s\S]*stripe_price_id[\s\S]*pass_price_minor/);
  assert.match(
    eventWriteLock,
    /REVOKE INSERT, UPDATE, DELETE ON public\.events FROM PUBLIC, anon, authenticated/,
  );
  assert.match(catalog, /STRIPE_OPERATIONS_MUTATIONS_ENABLED/);
  assert.match(catalog, /authorizeOperationsRequest/);
  assert.doesNotMatch(opsEvents, /stripe_price_id:/);
  assert.doesNotMatch(opsEvents, /pass_price_minor:/);
  assert.doesNotMatch(billing, /input\.priceId|data\.priceId/);
  assert.match(billing, /stripe_price_id_monthly/);
  assert.match(billing, /requireStripeCheckoutSecrets/);
  assert.match(tips, /requireStripeCheckoutSecrets/);
  assert.doesNotMatch(tips, /Payment provider is not connected yet/);
  assert.match(publicTips, /stripeCheckoutUnavailableResponse/);
  assert.match(eventPasses, /stripeCheckoutUnavailableResponse/);
  assert.match(checkout, /stripeCheckoutUnavailableResponse/);
});

test("ops Open Studio does not publish the event and requires the operations bearer", () => {
  assert.match(opsStudio, /authorizeOperationsRequest/);
  assert.match(opsStudio, /hostStudioPath/);
  assert.doesNotMatch(opsStudio, /\.update\(/);
  assert.doesNotMatch(opsStudio, /status:\s*"live"/);
});

test("Accountabul Live media credentials are server-only Cloudflare RealtimeKit settings", () => {
  assert.match(envExample, /^CLOUDFLARE_ACCOUNT_ID=/m);
  assert.match(envExample, /^CLOUDFLARE_REALTIMEKIT_APP_ID=/m);
  assert.match(envExample, /^CLOUDFLARE_REALTIMEKIT_API_TOKEN=/m);
  assert.doesNotMatch(envExample, /^VITE_[A-Z_]*(CLOUDFLARE|REALTIMEKIT|STREAM)/m);
  assert.doesNotMatch(envExample, /^VITE_[A-Z_]*(API_TOKEN|SECRET|SERVICE_ROLE)/m);
});

test("Stripe webhooks fail closed without an account id and scope subscriptions", () => {
  assert.match(webhook, /Stripe account is not configured/);
  assert.match(webhook, /STRIPE_LIVE_MODE/);
  assert.match(
    webhook,
    /\.eq\("stripe_account_id", expectedAccountId\)[\s\S]*\.eq\("stripe_customer_id", object\.customer\)/,
  );
});

test("optional conference identity uses publishable claims", () => {
  assert.match(authServer, /getClaims/);
  assert.doesNotMatch(authServer, /supabaseAdmin/);
});

test("email matching is normalized and rejects unequal values", () => {
  assert.equal(normalizeEmail("  A@Example.COM "), "a@example.com");
  assert.equal(emailsMatch("A@example.com", "a@example.com"), true);
  assert.equal(emailsMatch("a@example.com", "b@example.com"), false);
  assert.equal(emailsMatch("a@example.com", "a@example.co"), false);
  assert.equal(emailsMatch("  a@example.com", "a@example.com  "), true);
  assert.equal(emailsMatch("", " "), true);
  assert.equal(emailsMatch("", ""), true);
});

test("rate limiter denies a burst from the same address", async () => {
  process.env["RATE_LIMIT_STORE"] = "memory";
  process.env["RATE_LIMIT_TRUST_CF"] = "true";
  const request = new Request("https://example.test", {
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  assert.equal(await rateLimitResponse(request, "hardening-test", 2, 60_000), null);
  assert.equal(await rateLimitResponse(request, "hardening-test", 2, 60_000), null);
  const denied = await rateLimitResponse(request, "hardening-test", 2, 60_000);
  assert.equal(denied?.status, 429);
});

test("rate limiter ignores X-Forwarded-For and shares the unknown bucket", async () => {
  process.env["RATE_LIMIT_STORE"] = "memory";
  delete process.env["RATE_LIMIT_TRUST_CF"];
  assert.equal(
    clientAddress(
      new Request("https://example.test", { headers: { "x-forwarded-for": "198.51.100.1" } }),
    ),
    "unknown",
  );
  assert.equal(
    clientAddress(
      new Request("https://example.test", {
        headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.2" },
      }),
    ),
    "unknown",
  );

  process.env["RATE_LIMIT_TRUST_CF"] = "true";
  assert.equal(
    clientAddress(
      new Request("https://example.test", {
        headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.2" },
      }),
    ),
    "203.0.113.10",
  );

  const first = new Request("https://example.test", {
    headers: { "x-forwarded-for": "198.51.100.1" },
  });
  const second = new Request("https://example.test", {
    headers: { "x-forwarded-for": "198.51.100.2" },
  });
  assert.equal(await rateLimitResponse(first, "hardening-xff", 2, 60_000), null);
  assert.equal(await rateLimitResponse(second, "hardening-xff", 2, 60_000), null);
  const denied = await rateLimitResponse(second, "hardening-xff", 2, 60_000);
  assert.equal(denied?.status, 429);
});

test("evening hardening denies viewer tax reads, tip reads, and role oracles", () => {
  const evening = readFileSync(
    new URL(
      "../supabase/migrations/20260904200000_evening_assessment_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const circleWebhook = readFileSync(
    new URL("../src/lib/crypto/circle-webhook.ts", import.meta.url),
    "utf8",
  );
  const circleWallets = readFileSync(
    new URL("../src/lib/crypto/circle-wallets.server.ts", import.meta.url),
    "utf8",
  );
  const circleRoute = readFileSync(
    new URL("../src/routes/api/public/webhooks/circle.ts", import.meta.url),
    "utf8",
  );
  const intent = readFileSync(new URL("../src/lib/tips/intent.server.ts", import.meta.url), "utf8");
  assert.match(evening, /public\.can_manage_business\(p_business_id, auth\.uid\(\)\)/);
  assert.match(evening, /private\.subject_is_self_or_admin/);
  assert.match(evening, /create policy tips_read/);
  assert.match(evening, /revoke insert, update, delete on public\.business_policies from anon/i);
  assert.match(evening, /consume_rate_limit/);
  assert.match(evening, /tips_deposit_address_idx/);
  assert.match(circleWebhook, /missing_token_config/);
  assert.match(circleWallets, /CIRCLE_USDC_TOKEN_ID/);
  assert.match(circleRoute, /isRetryableCircleUnmatched/);
  assert.match(intent, /eventAcceptsTips/);
  assert.match(verification, /tax_id_last4_present: true/);
  assert.doesNotMatch(verification, /diff: \{[\s\S]*tax_id_last4: data\.taxId\.slice/);
});

test("client-imported function modules load the admin client inside handlers", () => {
  assert.doesNotMatch(
    conference,
    /^import \{ supabaseAdmin \} from "@\/integrations\/supabase\/client\.server"/m,
  );
  assert.match(conference, /await import\("@\/integrations\/supabase\/client\.server"\)/);
  assert.doesNotMatch(
    billing,
    /^import \{ supabaseAdmin \} from "@\/integrations\/supabase\/client\.server"/m,
  );
  assert.match(billing, /await import\("@\/integrations\/supabase\/client\.server"\)/);
  assert.doesNotMatch(tips, /from "@\/integrations\/supabase\/client\.server"/);
  assert.match(tips, /await import\("@\/lib\/tips\/intent\.server"\)/);
});

test("api fortress keeps verification and ledger columns off the authenticated Data API", () => {
  const fortress = readFileSync(
    new URL("../supabase/migrations/20260904210000_api_fortress_column_lock.sql", import.meta.url),
    "utf8",
  );
  const allowlist = readFileSync(
    new URL(
      "../supabase/migrations/20260904211000_api_fortress_column_allowlist.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const restreamWorker = readFileSync(
    new URL("../workers/restream-chat-bridge/src/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(fortress, /revoke insert, update \(/i);
  assert.match(fortress, /tax_id_last4/);
  assert.match(allowlist, /revoke update on public\.businesses from authenticated/i);
  assert.match(allowlist, /grant update \(/i);
  assert.match(allowlist, /grant insert \(/i);
  assert.match(allowlist, /revoke delete on public\.businesses from authenticated/i);
  assert.doesNotMatch(allowlist, /tax_id_last4/);
  assert.doesNotMatch(allowlist, /verification_reference/);
  assert.doesNotMatch(allowlist, /published_at/);
  assert.doesNotMatch(allowlist, /public_profile_enabled/);
  assert.match(allowlist, /revoke select on public\.payment_events from authenticated/i);
  assert.match(restreamWorker, /operationsBearerMatches/);
  assert.match(restreamWorker, /constantTimeEqual/);
  assert.doesNotMatch(
    restreamWorker,
    /authorization"\) !== `Bearer \$\{env\.OPERATIONS_API_KEY\}`/,
  );
});

test("september 6 hardening privatizes media buckets and wraps the presence oracle", () => {
  const sept6 = readFileSync(
    new URL(
      "../supabase/migrations/20260906010000_september_6_assessment_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const circleWallets = readFileSync(
    new URL("../src/lib/crypto/circle-wallets.server.ts", import.meta.url),
    "utf8",
  );
  const circleRoute = readFileSync(
    new URL("../src/routes/api/public/webhooks/circle.ts", import.meta.url),
    "utf8",
  );
  const entitlements = readFileSync(
    new URL("../src/lib/conference/entitlements.ts", import.meta.url),
    "utf8",
  );
  assert.match(sept6, /set public = false/);
  assert.match(sept6, /business-media/);
  assert.match(sept6, /property-media/);
  assert.match(sept6, /private\.subject_is_self_or_admin\(_user_id\)/);
  assert.match(sept6, /can_view_event_presence/);
  assert.match(circleWallets, /CIRCLE_WEBHOOK_KEY_ID/);
  assert.match(circleRoute, /constantTimeEqual\(expectedKeyId, keyId\)/);
  assert.match(webhook, /Stripe subscription is missing its current period end/);
  assert.match(entitlements, /if \(!membership\.currentPeriodEnd\) return false;/);
  assert.match(entitlements, /if \(!expiresAt\) return false;/);
  assert.doesNotMatch(entitlements, /!membership\.currentPeriodEnd \|\|/);
});

test("evening red-team hardening drops moderator from vendor RPCs and fail-closes entitlements", () => {
  const evening = readFileSync(
    new URL(
      "../supabase/migrations/20260906020000_evening_red_team_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(evening, /has_role\(auth\.uid\(\), ['"]moderator['"]\)/);
  assert.match(evening, /get_my_business_profile/);
  assert.match(evening, /list_property_inquiries/);
  assert.match(evening, /list_service_inquiries/);
  assert.match(evening, /list_business_credentials/);
  assert.match(evening, /list_business_members/);
  assert.match(evening, /update_inquiry_status/);
  assert.match(evening, /current_period_end is not null/);
  assert.match(evening, /pass\.expires_at is not null/);
  // Guest checkout (event-passes.ts) shares the expiry logic with the
  // authenticated purchase path (event-access.server.ts) rather than each
  // computing its own; the guest route itself only needs the TTL, for cookie
  // Max-Age.
  assert.match(eventAccess, /eventPassExpiresAt/);
  assert.match(eventPasses, /EVENT_PASS_TTL_MS/);
  assert.match(webhook, /eventPassExpiresAt/);
  assert.match(conference, /\.gt\("expires_at"/);
  assert.doesNotMatch(conference, /expires_at\.is\.null/);
});

test("september 10 hardening fail-closes inquiry status, community policy, and Circle retries", () => {
  const sept10 = readFileSync(
    new URL(
      "../supabase/migrations/20260910100000_september_10_red_team_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const circleWebhook = readFileSync(
    new URL("../src/lib/crypto/circle-webhook.ts", import.meta.url),
    "utf8",
  );
  const circleRoute = readFileSync(
    new URL("../src/routes/api/public/webhooks/circle.ts", import.meta.url),
    "utf8",
  );
  const rateLimit = readFileSync(
    new URL("../src/lib/security/rate-limit.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(sept10, /revoke insert \(status\) on public\.property_inquiries/i);
  assert.match(sept10, /p\.business_id = property_inquiries\.business_id/);
  assert.match(sept10, /s\.business_id = service_inquiries\.business_id/);
  assert.match(sept10, /r\.access_policy = _access_policy/);
  assert.match(sept10, /public\.can_manage_business\(p_business_id, auth\.uid\(\)\)/);
  assert.match(sept10, /can_manage_business\(b\.id, auth\.uid\(\)\)/);
  assert.doesNotMatch(sept10, /has_role\(auth\.uid\(\), ['"]moderator['"]\)/);
  assert.match(circleWebhook, /not_complete/);
  assert.match(circleWebhook, /unmatched_wallet/);
  assert.match(
    circleRoute,
    /markCircleEventRetryable\(notification\.notificationId, null, "unmatched_wallet"\)/,
  );
  assert.match(rateLimit, /RATE_LIMIT_TRUST_CF/);
  const community = readFileSync(
    new URL("../supabase/migrations/20260909165841_community_chat.sql", import.meta.url),
    "utf8",
  );
  const login = readFileSync(new URL("../src/routes/login.tsx", import.meta.url), "utf8");
  const signup = readFileSync(
    new URL("../src/components/auth/signup-form.tsx", import.meta.url),
    "utf8",
  );
  assert.match(community, /r\.access_policy = _access_policy/);
  assert.match(
    community,
    /revoke all on public\.community_room_grants from public, anon, authenticated/i,
  );
  assert.doesNotMatch(community, /grant insert on public\.community_messages/i);
  assert.match(login, /\/auth\/callback\?next=\$\{encodeURIComponent\(next\)\}/);
  assert.doesNotMatch(login, /redirectTo: `\$\{window\.location\.origin\}\$\{next\}`/);
  assert.match(signup, /\/auth\/callback\?next=\$\{encodeURIComponent\(next\)\}/);
  const googleOauth = readFileSync(
    new URL(
      "../supabase/migrations/20260909185041_google_oauth_profile_fields.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(googleOauth, /full_name/);
  assert.match(googleOauth, /values \(new\.id, 'member'\)/);
  assert.doesNotMatch(googleOauth, /raw_user_meta_data ->> 'role'/);
  const allowlist = readFileSync(
    new URL(
      "../supabase/migrations/20260910101000_september_10_inquiry_column_allowlist.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(allowlist, /revoke insert on public\.property_inquiries from anon, authenticated/i);
  assert.doesNotMatch(allowlist, /grant insert \([\s\S]*status/i);
});

test("speaker join exchanges the token in a POST body, not the query string", () => {
  assert.match(speakerJoin, /POST: async/);
  assert.doesNotMatch(speakerJoin, /searchParams\.get\(["']token["']\)/);
  assert.doesNotMatch(speakerRequests, /[?&]token=/);
  assert.match(speakerRequests, /speakerJoinPath/);
  assert.match(speakerJoinPage, /location\.hash/);
  assert.doesNotMatch(speakerJoinPage, /search\[.token.\]|searchParams\.get\(["']token["']\)/);
});
