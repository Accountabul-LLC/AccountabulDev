import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  comparableSnapshotJson,
  contentHashOf,
  snapshotHashOf,
  validateGenerateReportInput,
  validateRecordDeliveryInput,
  type ReportSnapshotPayload,
} from "../src/lib/property-intelligence/report-vault-validation.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/20260924130000_property_report_vault.sql", import.meta.url),
  "utf8",
);

function samplePayload(overrides: Partial<ReportSnapshotPayload> = {}): ReportSnapshotPayload {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-24T12:00:00.000Z",
    workspace: {
      threadId: "11111111-1111-4111-8111-111111111111",
      parcelId: "12345678901",
      address: "123 Main St",
      status: "new",
    },
    property: {
      profile: { owner_name: "Jane Doe", assessed_total_value: 100000 },
      verifiedOwnerRecords: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          category: "tax_receipt",
          title: "2025 tax receipt",
          amount: 1200,
          occurredAt: "2025-06-01",
          vendorName: null,
          referenceNumber: null,
        },
      ],
    },
    deal: {
      scenarioId: "33333333-3333-4333-8333-333333333333",
      label: "Buy and hold",
      inputs: { purchasePrice: 90000 },
      results: { monthlyCashFlow: 250 },
    },
    ...overrides,
  };
}

test("Phase 4: identical property/deal content produces the same content hash regardless of capture time or workspace status", () => {
  const first = samplePayload();
  const second = samplePayload({
    generatedAt: "2026-09-25T09:30:00.000Z",
    workspace: { ...samplePayload().workspace, status: "in_progress" },
  });

  assert.equal(contentHashOf(first), contentHashOf(second));
  // The full snapshot hash (used for the immutable snapshot_hash column) is
  // NOT expected to match -- it includes the capture timestamp verbatim.
  assert.notEqual(snapshotHashOf(first), snapshotHashOf(second));
});

test("Phase 4: any real change to property or deal content changes the content hash", () => {
  const base = samplePayload();
  const changed = samplePayload({
    deal: { ...samplePayload().deal!, inputs: { purchasePrice: 95000 } },
  });
  assert.notEqual(contentHashOf(base), contentHashOf(changed));
});

test("Phase 4: comparableSnapshotJson strips generatedAt and normalizes workspace status", () => {
  const json = comparableSnapshotJson(samplePayload());
  const parsed = JSON.parse(json);
  assert.equal(parsed.generatedAt, undefined);
  assert.equal(parsed.workspace.status, "content");
});

test("Phase 4: generate-report input requires a valid workspace id", () => {
  assert.throws(() => validateGenerateReportInput({}), /property workspace/i);
  assert.throws(
    () => validateGenerateReportInput({ threadId: "not-a-uuid" }),
    /property workspace/i,
  );
  const result = validateGenerateReportInput({
    threadId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.threadId, "11111111-1111-4111-8111-111111111111");
});

test("Phase 4: delivery action must be one of print/download/share/delete", () => {
  assert.throws(
    () =>
      validateRecordDeliveryInput({
        reportId: "11111111-1111-4111-8111-111111111111",
        action: "modify",
      }),
    /valid delivery action/i,
  );
  for (const action of ["print", "download", "share", "delete"]) {
    const result = validateRecordDeliveryInput({
      reportId: "11111111-1111-4111-8111-111111111111",
      action,
    });
    assert.equal(result.action, action);
  }
});

test("Phase 4: property_reports is immutable — no UPDATE or DELETE policy exists at all", () => {
  assert.doesNotMatch(migration, /on public\.property_reports for update/i);
  assert.doesNotMatch(migration, /on public\.property_reports for delete/i);
  assert.match(
    migration,
    /create policy property_reports_owner_insert\s+on public\.property_reports for insert to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\)\)/,
  );
});

test("Phase 4: a non-owner cannot read another user's report row", () => {
  assert.match(
    migration,
    /create policy property_reports_owner_read\s+on public\.property_reports for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/,
  );
  const selectPolicies = migration.match(
    /create policy \w+\s+on public\.property_reports for select/g,
  );
  assert.equal(selectPolicies?.length, 1, "exactly one SELECT policy should exist");
});

test("Phase 4: property_report_deliveries is append-only — insert-only for the report's own owner, no update/delete policy", () => {
  assert.match(
    migration,
    /create policy property_report_deliveries_owner_insert\s+on public\.property_report_deliveries for insert to authenticated/,
  );
  assert.doesNotMatch(migration, /property_report_deliveries.*for update/is);
  assert.doesNotMatch(migration, /property_report_deliveries.*for delete/is);
});

test("Phase 4: a delivery can only be recorded against a report the caller owns", () => {
  assert.match(
    migration,
    /with check \(\s*user_id = \(select auth\.uid\(\)\)\s*and exists \(\s*select 1 from public\.property_reports r\s*where r\.id = report_id and r\.user_id = \(select auth\.uid\(\)\)\s*\)\s*\)/,
  );
});

test("Phase 4: storage reads for property-report-vault are limited to the owner's own folder, with no write policy for authenticated clients", () => {
  assert.match(
    migration,
    /create policy property_report_vault_owner_read\s+on storage\.objects for select to authenticated\s+using \(\s*bucket_id = 'property-report-vault'\s+and split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text\s*\)/,
  );
  // No INSERT policy for authenticated on this bucket -- PDFs are only ever
  // written by the service role from report-vault.server.ts, never by a
  // client-side render.
  assert.doesNotMatch(
    migration,
    /on storage\.objects for insert to authenticated[\s\S]*?property-report-vault/,
  );
  assert.doesNotMatch(migration, /property-report-vault[\s\S]*?to anon/i);
});

test("Phase 4: the storage bucket is private with no public flag", () => {
  assert.match(migration, /'property-report-vault',\s*'property-report-vault',\s*false,/);
});

test("Phase 4: report_documents/report_snapshots split was deliberately collapsed to one table (documented judgment call)", () => {
  // Guards against silently re-splitting property_reports back into a
  // separate documents table without updating the migration's rationale.
  assert.match(migration, /collapsed the source's 3-table split into 2 tables/);
});
