import assert from "node:assert/strict";
import test from "node:test";

import { bytesToHex } from "../src/lib/security/hex.ts";

test("bytesToHex encodes each byte as two lowercase hex digits", () => {
  assert.equal(bytesToHex(new Uint8Array()), "");
  assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 255])), "000f10ff");
  assert.equal(bytesToHex(Uint8Array.from([0xab, 0xcd])), "abcd");
});
