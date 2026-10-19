import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { INQUIRY_LIMITS, normalizeInquiryInput } from "../src/lib/inquiry.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260901174400_inquiry_input_bounds.sql", import.meta.url),
  "utf8",
);

test("public inquiry data is trimmed and an empty phone becomes null", () => {
  assert.deepEqual(
    normalizeInquiryInput({
      contact_name: "  Ada Lovelace  ",
      contact_email: "  ada@example.com ",
      contact_phone: "  ",
      message: "  Please call about this service.  ",
    }),
    {
      contact_name: "Ada Lovelace",
      contact_email: "ada@example.com",
      contact_phone: null,
      message: "Please call about this service.",
    },
  );
});

test("public inquiry validation rejects missing, malformed, and oversized fields", () => {
  const valid = {
    contact_name: "Ada",
    contact_email: "ada@example.com",
    contact_phone: "",
    message: "Please contact me.",
  };

  assert.throws(() => normalizeInquiryInput({ ...valid, contact_name: " " }), /required/);
  assert.throws(
    () => normalizeInquiryInput({ ...valid, contact_email: "not-an-email" }),
    /valid email/,
  );
  assert.throws(
    () =>
      normalizeInquiryInput({
        ...valid,
        message: "x".repeat(INQUIRY_LIMITS.message + 1),
      }),
    /2,000/,
  );
});

test("database constraints mirror the shared inquiry bounds on both lead tables", () => {
  for (const table of ["service_inquiries", "property_inquiries"]) {
    const start = migration.indexOf(`alter table public.${table}`);
    assert.notEqual(start, -1);
    const tableSql = migration.slice(start, start + 1_500);
    assert.match(tableSql, /char_length\(contact_name\) between 1 and 120/);
    assert.match(tableSql, /char_length\(contact_email\) between 3 and 254/);
    assert.match(tableSql, /char_length\(contact_phone\) between 1 and 40/);
    assert.match(tableSql, /char_length\(message\) between 1 and 2000/);
  }
});
