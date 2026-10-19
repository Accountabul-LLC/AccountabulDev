import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDateTime,
  formatMoney,
  locationLabel,
  parseMoneyToMinor,
  slugify,
  uniqueSlug,
} from "../src/lib/format.ts";

test("formatMoney rounds to whole currency units and keeps the request label", () => {
  assert.equal(formatMoney(null), "Price on request");
  assert.equal(formatMoney(undefined), "Price on request");
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(1), "$0");
  assert.equal(formatMoney(49), "$0");
  assert.equal(formatMoney(50), "$1");
  assert.equal(formatMoney(99), "$1");
  assert.equal(formatMoney(100), "$1");
  assert.equal(formatMoney(150), "$2");
  assert.equal(formatMoney(199), "$2");
  assert.equal(formatMoney(250000), "$2,500");
  assert.equal(formatMoney(-100), "-$1");
  assert.equal(formatMoney(12345, "EUR"), "€123");
  assert.throws(() => formatMoney(100, "US"), RangeError);
});

test("parseMoneyToMinor keeps cents and rejects empty text", () => {
  assert.equal(parseMoneyToMinor(""), null);
  assert.equal(parseMoneyToMinor("  "), null);
  assert.equal(parseMoneyToMinor("abc"), null);
  assert.equal(parseMoneyToMinor("$1,234.50"), 123450);
  assert.equal(parseMoneyToMinor("1.2"), 120);
  assert.equal(parseMoneyToMinor("1.005"), 100);
  assert.equal(parseMoneyToMinor("1.999"), 200);
  assert.equal(parseMoneyToMinor("0"), 0);
  assert.equal(parseMoneyToMinor("10.5"), 1050);
  assert.equal(parseMoneyToMinor(".5"), 50);
});

test("slugify and location labels stay stable", () => {
  assert.equal(slugify("  Hello, World!!  "), "hello-world");
  assert.equal(slugify("***"), "");
  assert.equal(slugify("a".repeat(80)).length, 60);
  assert.equal(locationLabel(["Austin", null, "", "TX"]), "Austin, TX");
  assert.equal(locationLabel([]), "");
});

test("uniqueSlug appends a short suffix to the slug", () => {
  const slug = uniqueSlug("Hello, World");
  assert.match(slug, /^hello-world-[a-z0-9]{5}$/);
  assert.match(uniqueSlug("***"), /^item-[a-z0-9]{5}$/);
});

test("missing times stay unannounced", () => {
  assert.equal(formatDateTime(null), "Time to be announced");
  assert.equal(formatDateTime(""), "Time to be announced");
  assert.equal(formatDateTime(undefined), "Time to be announced");
});
