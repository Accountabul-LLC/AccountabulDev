import assert from "node:assert/strict";
import test from "node:test";

import { UUID as apiKeyUuid } from "../src/lib/property-intelligence/property-api-keys-validation.ts";
import {
  SHA256_HEX as ownerSha256,
  UUID as ownerUuid,
} from "../src/lib/property-intelligence/property-records-upload-validation.ts";
import {
  SHA256_HEX as reportSha256,
  UUID as reportUuid,
} from "../src/lib/property-intelligence/report-vault-validation.ts";
import {
  SHA256_HEX,
  SHA256_HEX_ANY_CASE,
  UUID_V1_TO_V5,
  UUID_V1_TO_V8,
} from "../src/lib/validation/patterns.ts";
import { trimmedString } from "../src/lib/validation/strings.ts";

const V4 = "11111111-1111-4111-8111-111111111111";
const V5 = "11111111-1111-5111-9abc-111111111111";
const V7 = "11111111-1111-7111-a111-111111111111";
const V8 = "11111111-1111-8111-b111-111111111111";
const NIL = "00000000-0000-0000-0000-000000000000";
const LOWER_SHA = "a".repeat(64);
const UPPER_SHA = "A".repeat(64);

test("the validation modules re-export the shared UUID and SHA-256 patterns", () => {
  for (const pattern of [ownerUuid, reportUuid, apiKeyUuid]) {
    assert.equal(pattern.source, UUID_V1_TO_V8.source);
    assert.equal(pattern.flags, UUID_V1_TO_V8.flags);
  }
  assert.equal(ownerSha256.source, SHA256_HEX.source);
  assert.equal(ownerSha256.flags, SHA256_HEX.flags);
  assert.equal(reportSha256.source, SHA256_HEX.source);
  assert.equal(reportSha256.flags, SHA256_HEX.flags);
});

test("UUID versions 1 through 8 accept v4, v5, v7, and v8 and reject everything else", () => {
  for (const value of [V4, V5, V7, V8, V4.toUpperCase()]) {
    assert.equal(UUID_V1_TO_V8.test(value), true, value);
  }
  for (const value of [NIL, "11111111-1111-0111-8111-111111111111", `${V4} `, V4.slice(0, 35)]) {
    assert.equal(UUID_V1_TO_V8.test(value), false, value);
  }
});

test("UUID versions 1 through 5 reject versions 6, 7, and 8", () => {
  assert.equal(UUID_V1_TO_V5.test(V4), true);
  assert.equal(UUID_V1_TO_V5.test(V5), true);
  assert.equal(UUID_V1_TO_V5.test("11111111-1111-6111-8111-111111111111"), false);
  assert.equal(UUID_V1_TO_V5.test(V7), false);
  assert.equal(UUID_V1_TO_V8.test(V7), true);
  assert.equal(UUID_V1_TO_V5.test(V8), false);
});

test("SHA-256 patterns keep their case rules", () => {
  assert.equal(SHA256_HEX.test(LOWER_SHA), true);
  assert.equal(SHA256_HEX.test(UPPER_SHA), false);
  assert.equal(SHA256_HEX_ANY_CASE.test(LOWER_SHA), true);
  assert.equal(SHA256_HEX_ANY_CASE.test(UPPER_SHA), true);
  assert.equal(SHA256_HEX.test(`${LOWER_SHA}a`), false);
  assert.equal(SHA256_HEX_ANY_CASE.test(LOWER_SHA.slice(0, 63)), false);
});

test("trimmedString trims strings and turns other values into an empty string", () => {
  assert.equal(trimmedString({ name: "  Ada  " }, "name"), "Ada");
  assert.equal(trimmedString({ name: "" }, "name"), "");
  assert.equal(trimmedString({}, "name"), "");
  assert.equal(trimmedString({ name: 12 }, "name"), "");
  assert.equal(trimmedString({ name: null }, "name"), "");
  assert.equal(trimmedString({ note: "  Add photos.  " }, "note"), "Add photos.");
});
