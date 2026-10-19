import assert from "node:assert/strict";
import test from "node:test";

import { serializeJsonLd } from "../src/lib/json-ld.ts";

test("JSON-LD serialization cannot terminate its script element", () => {
  const value = {
    name: '</script><script>alert("xss")</script>',
    description: "A & B > C\u2028next\u2029line",
  };
  const serialized = serializeJsonLd(value);

  assert.doesNotMatch(serialized, /<\/script/i);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(serialized), value);
});
