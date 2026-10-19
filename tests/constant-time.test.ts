import assert from "node:assert/strict";
import test from "node:test";

import { constantTimeEqual } from "../src/lib/security/constant-time.ts";

test("constantTimeEqual matches whole strings and rejects any difference", () => {
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "xbc"), false);
  assert.equal(constantTimeEqual("abc", "abx"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("abcd", "abc"), false);
  assert.equal(constantTimeEqual("a", ""), false);
  assert.equal(constantTimeEqual("café", "cafe"), false);
  assert.equal(constantTimeEqual("café", "café"), true);
  assert.equal(constantTimeEqual("a\u0000b", "a\u0000b"), true);
  assert.equal(constantTimeEqual("a\u0000b", "a\u0000c"), false);
  assert.equal(constantTimeEqual("Bearer secret", "Bearer secret"), true);
  assert.equal(constantTimeEqual("Bearer secret", "Bearer secreT"), false);
});
