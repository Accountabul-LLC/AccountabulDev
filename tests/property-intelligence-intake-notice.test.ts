// Contract for intake-claim and warning-preference persistence, ported from
// property-intelligence-app's property-intake-repository.ts and
// property-intelligence-notice-repository.ts.
//
// Both tables are service-role write only, so these functions are the single
// write path and carry the two controls that matter:
//
//   * claims are normalized before storage AND on read, so an unbounded figure
//     can never reach a deal calculation from either direction
//   * the pre-offer warning needs three separate reviews before it may be
//     dismissed, and asking to dismiss early is refused rather than honored
//
// The source's own test for the second one asserts the server refuses early
// dismissal ("Complete three warning reviews before turning off future
// reminders"); that assertion is ported here against the Supabase path.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  acknowledgePropertyIntelligenceNotice,
  defaultPropertyIntakeClaims,
  getPropertyIntakeClaims,
  getPropertyIntelligenceNoticePreference,
  noticePreferenceFromCount,
  savePropertyIntakeClaims,
} from "../src/lib/property-intelligence/property-intake-notice.server.ts";
import type {
  DossierDatabase,
  DossierQuery,
  DossierRow,
} from "../src/lib/property-intelligence/property-dossier.server.ts";

class FakeIntakeDatabase implements DossierDatabase {
  tables: Record<string, DossierRow[]> = {
    property_intake_claims: [],
    property_intelligence_notice_preferences: [],
  };

  from(table: string): DossierQuery {
    const rows = (this.tables[table] ??= []);
    const filters: Array<(row: DossierRow) => boolean> = [];
    let mode: "select" | "upsert" = "select";
    let conflictKeys: string[] = [];
    let values: DossierRow = {};

    const matches = (row: DossierRow) => filters.every((predicate) => predicate(row));
    const apply = () => {
      if (mode !== "upsert") return;
      const existing = rows.find((row) => conflictKeys.every((key) => row[key] === values[key]));
      if (existing) Object.assign(existing, values);
      else rows.push({ ...values });
    };

    const query: DossierQuery = {
      select() {
        return query;
      },
      upsert(next: unknown, options?: { onConflict?: string }) {
        mode = "upsert";
        values = next as DossierRow;
        conflictKeys = options?.onConflict?.split(",").map((key) => key.trim()) ?? [];
        return query;
      },
      insert() {
        return query;
      },
      update() {
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return query;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      order() {
        return query;
      },
      async maybeSingle() {
        return { data: rows.find(matches) ?? null };
      },
      async single() {
        return { data: rows.find(matches) ?? null };
      },
      then(resolve) {
        apply();
        return Promise.resolve({ data: rows.filter(matches) }).then(resolve);
      },
    };
    return query;
  }
}

const THREAD = randomUUID();
const USER = randomUUID();

test("an intake that was never saved reads as bounded defaults", async () => {
  const database = new FakeIntakeDatabase();
  const claims = await getPropertyIntakeClaims(database, THREAD, USER);
  assert.deepEqual(claims, defaultPropertyIntakeClaims());
  assert.equal(claims.updatedAt, null);
});

test("saved claims are normalized before storage and stamped", async () => {
  const database = new FakeIntakeDatabase();
  const saved = await savePropertyIntakeClaims(database, THREAD, USER, {
    propertyUse: "single-family",
    bedrooms: 3,
    bathrooms: 1.5,
    notes: "  Needs roof review.  ",
  });
  assert.equal(saved.propertyUse, "single-family");
  assert.equal(saved.bathrooms, 1.5);
  assert.equal(saved.notes, "Needs roof review.");
  assert.ok(saved.updatedAt, "a save is stamped");

  const reread = await getPropertyIntakeClaims(database, THREAD, USER);
  assert.equal(reread.bedrooms, 3);
  assert.equal(reread.notes, "Needs roof review.");
});

test("an out-of-range claim is refused rather than stored", async () => {
  const database = new FakeIntakeDatabase();
  await assert.rejects(
    savePropertyIntakeClaims(database, THREAD, USER, { bedrooms: 2.5 }),
    /outside the supported range/i,
  );
  assert.equal(
    database.tables["property_intake_claims"]?.length,
    0,
    "nothing is written when validation fails",
  );
});

test("a stored payload that no longer validates degrades to defaults on read", async () => {
  const database = new FakeIntakeDatabase();
  database.tables["property_intake_claims"] = [
    {
      thread_id: THREAD,
      user_id: USER,
      claims: { bedrooms: 2.5 },
      updated_at: "2026-09-24T12:00:00.000Z",
    },
  ];
  const claims = await getPropertyIntakeClaims(database, THREAD, USER);
  assert.equal(claims.bedrooms, null, "an unbounded stored figure never reaches the caller");
  assert.deepEqual(claims, defaultPropertyIntakeClaims());
});

test("one account's intake is not readable as another's", async () => {
  const database = new FakeIntakeDatabase();
  await savePropertyIntakeClaims(database, THREAD, USER, { bedrooms: 3 });
  const other = await getPropertyIntakeClaims(database, THREAD, randomUUID());
  assert.deepEqual(other, defaultPropertyIntakeClaims());
});

test("a fresh account may not dismiss the pre-offer warning", async () => {
  const database = new FakeIntakeDatabase();
  const initial = await getPropertyIntelligenceNoticePreference(database, USER);
  assert.equal(initial.acknowledgmentCount, 0);
  assert.equal(initial.canDismiss, false);

  await assert.rejects(
    acknowledgePropertyIntelligenceNotice(database, USER, "acknowledge-and-dismiss"),
    /Complete three warning reviews/i,
  );
});

test("the warning unlocks only after three reviews, and dismissal then sticks", async () => {
  const database = new FakeIntakeDatabase();
  const first = await acknowledgePropertyIntelligenceNotice(database, USER, "acknowledge");
  assert.equal(first.acknowledgmentCount, 1);
  assert.equal(first.canDismiss, false);

  const second = await acknowledgePropertyIntelligenceNotice(database, USER, "acknowledge");
  assert.equal(second.acknowledgmentCount, 2);
  assert.equal(second.canDismiss, false);
  assert.equal(second.dismissed, false);

  const third = await acknowledgePropertyIntelligenceNotice(
    database,
    USER,
    "acknowledge-and-dismiss",
  );
  assert.equal(third.acknowledgmentCount, 3);
  assert.equal(third.canDismiss, true);
  assert.equal(third.dismissed, true);

  const fourth = await acknowledgePropertyIntelligenceNotice(database, USER, "acknowledge");
  assert.equal(fourth.acknowledgmentCount, 3, "the count never exceeds the requirement");
  assert.equal(fourth.dismissed, true, "dismissal is sticky once earned");
});

test("an invalid acknowledgment action is rejected", async () => {
  const database = new FakeIntakeDatabase();
  await assert.rejects(
    acknowledgePropertyIntelligenceNotice(
      database,
      USER,
      "dismiss" as unknown as Parameters<typeof acknowledgePropertyIntelligenceNotice>[2],
    ),
    /valid warning acknowledgment action/i,
  );
});

test("a stored count outside the policy range can never report more reviews than required", () => {
  assert.equal(noticePreferenceFromCount(99, null).acknowledgmentCount, 3);
  assert.equal(noticePreferenceFromCount(-4, null).acknowledgmentCount, 0);
  assert.equal(noticePreferenceFromCount("nonsense", null).acknowledgmentCount, 0);
  assert.equal(noticePreferenceFromCount(3, "2026-09-24T12:00:00.000Z").dismissed, true);
  assert.equal(noticePreferenceFromCount(3, "").dismissed, false);
});
