import assert from "node:assert/strict";
import test from "node:test";

import {
  createPropertyApiKeyMaterial,
  decodePropertyApiCursor,
  encodePropertyApiCursor,
  normalizePublicPropertyQuery,
  propertyApiCorsHeaders,
  publicPropertyRecord,
  readBearerKey,
  sha256Hex,
  constantTimeEqual,
  type PublicParcelRow,
  type PublicPropertyQuery,
} from "../src/lib/property-intelligence/property-api-contract.ts";
import {
  cleanApiKeyLabel,
  validateCreateApiKeyInput,
  validateRevokeApiKeyInput,
} from "../src/lib/property-intelligence/property-api-keys-validation.ts";

test("sandbox API keys are high-entropy, parseable, and represented only by their hash", async () => {
  const seen = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    const material = await createPropertyApiKeyMaterial();
    assert.match(material.rawKey, /^acct_test_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
    assert.match(material.keyPrefix, /^acct_test_[a-f0-9]{24}$/);
    assert.match(material.keyHash, /^[0-9a-f]{64}$/);
    // The hash must never equal the raw key or its prefix verbatim.
    assert.notEqual(material.keyHash, material.rawKey);
    assert.notEqual(material.keyHash, material.keyPrefix);
    assert.equal(material.keyHash, await sha256Hex(material.rawKey));
    assert.ok(!seen.has(material.rawKey), "raw keys must not repeat across issuances");
    seen.add(material.rawKey);
  }
});

test("readBearerKey only accepts a well-formed sandbox key as a Bearer token", async () => {
  const material = await createPropertyApiKeyMaterial();
  const good = new Request("https://api.example/x", {
    headers: { authorization: `Bearer ${material.rawKey}` },
  });
  const parsed = readBearerKey(good);
  assert.equal(parsed?.keyPrefix, material.keyPrefix);

  assert.equal(readBearerKey(new Request("https://api.example/x")), null);
  assert.equal(
    readBearerKey(
      new Request("https://api.example/x", { headers: { authorization: "Bearer not-a-key" } }),
    ),
    null,
  );
  assert.equal(
    readBearerKey(
      new Request("https://api.example/x", {
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      }),
    ),
    null,
  );
});

test("constantTimeEqual behaves like equality but never short-circuits on the first mismatch", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("normalizePublicPropertyQuery rejects unsupported query parameters", () => {
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?bogus=1")),
    /Unsupported query parameter/,
  );
});

test("normalizePublicPropertyQuery validates and defaults each filter", () => {
  const defaults = normalizePublicPropertyQuery(new URL("https://api.example/x"));
  assert.deepEqual(defaults, {
    q: null,
    ward: null,
    zip: null,
    parcelId: null,
    sort: "updated_desc",
    cursor: null,
    pageSize: 25,
  });

  const filled = normalizePublicPropertyQuery(
    new URL(
      "https://api.example/x?q=Main+St&ward=7&zip=63108&parcel_id=12345678901&sort=address_asc&limit=10",
    ),
  );
  assert.equal(filled.q, "Main St");
  assert.equal(filled.ward, 7);
  assert.equal(filled.zip, "63108");
  assert.equal(filled.parcelId, "12345678901");
  assert.equal(filled.sort, "address_asc");
  assert.equal(filled.pageSize, 10);

  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?ward=abc")),
    /ward/,
  );
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?zip=123")),
    /zip/,
  );
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?parcel_id=123")),
    /parcel_id/,
  );
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?sort=bogus")),
    /sort/,
  );
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?limit=0")),
    /limit/,
  );
  assert.throws(
    () => normalizePublicPropertyQuery(new URL("https://api.example/x?limit=76")),
    /limit/,
  );
});

test("property API pagination cursors round-trip and are bound to their filters", () => {
  const query: PublicPropertyQuery = {
    q: null,
    ward: 7,
    zip: null,
    parcelId: null,
    sort: "updated_desc",
    cursor: null,
    pageSize: 25,
  };
  const cursor = encodePropertyApiCursor(50, query);
  assert.equal(decodePropertyApiCursor({ ...query, cursor }), 50);

  // A cursor minted for one filter set must not be reusable under a different one.
  assert.throws(() => decodePropertyApiCursor({ ...query, ward: 8, cursor }), /cursor is invalid/);
  assert.throws(
    () => decodePropertyApiCursor({ ...query, cursor: "garbage" }),
    /cursor is invalid/,
  );
});

test("publicPropertyRecord only ever exposes the provenance-safe projection", () => {
  const row: PublicParcelRow = {
    id: "11111111-1111-4111-8111-111111111111",
    asr_parcel_id: "12345678901",
    current_address: "123 Main St",
    match_status: "parcel-id-verified",
    last_intelligence_sync_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    property_intel_profiles: {
      ward: 7,
      owner_name: "Jane Doe",
      assessed_total_value: 100000,
      source_url: "https://internal.example/scrape/secret",
      assessor_handle: "internal-session-handle-abc",
      web_mercator_x: -10083000.12,
      web_mercator_y: 4689000.34,
      observed_at: "2026-09-23T00:00:00.000Z",
    },
  };

  const record = publicPropertyRecord(row);
  const json = JSON.stringify(record);

  // Withheld: never in the response, at any depth.
  assert.doesNotMatch(json, /source_url/);
  assert.doesNotMatch(json, /assessor_handle/);
  assert.doesNotMatch(json, /web_mercator/);
  assert.doesNotMatch(json, /internal-session-handle/);
  assert.doesNotMatch(json, /internal\.example/);

  // Exposed: the documented public fields.
  assert.equal(record.asr_parcel_id, "12345678901");
  assert.equal(record.address, "123 Main St");
  assert.equal(record.assessor?.ward, 7);
  assert.equal(record.assessor?.owner_name, "Jane Doe");
  assert.equal(record.assessor?.assessed_total_value, 100000);

  const withoutProfile = publicPropertyRecord({ ...row, property_intel_profiles: null });
  assert.equal(withoutProfile.assessor, null);
});

test("propertyApiCorsHeaders allows same-origin and explicitly configured HTTPS origins only", () => {
  const sameOrigin = propertyApiCorsHeaders(
    new Request("https://api.example/x", { headers: { origin: "https://api.example" } }),
    undefined,
  );
  assert.ok(sameOrigin);

  const configured = propertyApiCorsHeaders(
    new Request("https://api.example/x", { headers: { origin: "https://partner.example" } }),
    "https://partner.example",
  );
  assert.ok(configured);
  assert.equal(configured?.get("Access-Control-Allow-Origin"), "https://partner.example");

  const denied = propertyApiCorsHeaders(
    new Request("https://api.example/x", { headers: { origin: "https://evil.example" } }),
    "https://partner.example",
  );
  assert.equal(denied, null);

  // No Origin header at all (a server-to-server call) is never denied.
  const noOrigin = propertyApiCorsHeaders(new Request("https://api.example/x"), undefined);
  assert.ok(noOrigin);
});

test("cleanApiKeyLabel trims, bounds, and rejects control characters", () => {
  assert.equal(cleanApiKeyLabel("  My   Key  "), "My Key");
  assert.throws(() => cleanApiKeyLabel(""), /required/);
  assert.throws(() => cleanApiKeyLabel("x".repeat(61)), /60 characters/);
  assert.throws(() => cleanApiKeyLabel("bad\u0000label"), /printable/);
});

test("validateCreateApiKeyInput / validateRevokeApiKeyInput reject malformed input", () => {
  assert.deepEqual(validateCreateApiKeyInput({ label: "Prod" }), { label: "Prod" });
  assert.throws(() => validateCreateApiKeyInput({}), /required/);

  assert.throws(() => validateRevokeApiKeyInput({ keyId: "not-a-uuid" }), /API key is required/);
  assert.deepEqual(validateRevokeApiKeyInput({ keyId: "11111111-1111-4111-8111-111111111111" }), {
    keyId: "11111111-1111-4111-8111-111111111111",
  });
});
