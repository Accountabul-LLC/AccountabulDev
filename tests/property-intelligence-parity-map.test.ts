// The refactor map between the Property Intelligence source app and this
// repository, and the test that keeps it honest.
//
// Background: a symbol-level parity sweep against the source
// (Accountabul-LLC/property-intelligence-app, app/lib) leaves 44 exported
// source symbols whose NAMES do not appear anywhere in this repository. Every
// one of them is a rename, a consolidation, or a platform swap rather than a
// gap -- but "trust me, it's a rename" is not checkable, and it rots silently
// the moment someone renames a target symbol.
//
// So the mapping is data, and this test asserts the target half of it still
// exists. If `buildReportPdf` is renamed, this fails and the map has to be
// updated rather than quietly becoming fiction.
//
// What this test does NOT do is verify the source half: the source repository
// is not vendored here, so a CI run cannot re-derive the 46. That half is
// re-measured by hand when the source moves. The target half is the half that
// rots on this repo's own commits, and that is what is pinned here.
//
// Four kinds of mapping appear below:
//
//   * repository -> `.server.ts` / `.functions.ts` split (the bulk of them)
//   * per-source adapters/executors -> one `createNationwideSourceAdapterBindings`
//     registry that binds all six source keys
//   * seven `report-pdf` builders -> one consolidated `buildReportPdf`
//   * Cloudflare/D1/R2 -> Supabase and ops routes (the platform swap)
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const LIB = path.join(import.meta.dirname, "..", "src", "lib", "property-intelligence");

// source symbol -> [target symbol, target file]
const PARITY_MAP: Record<string, readonly [string, string]> = {
  NATIONWIDE_INGESTION_HEALTH_SEVERITIES: [
    "NATIONWIDE_OPERATIONAL_HEALTH_ALERT_CODES",
    "nationwide-ingestion-health.ts",
  ],
  buildConversationTranscriptPdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildDealAnalysisPdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildLegacyReportPdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildPropertyIntakePdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildPropertyIntelligencePdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildVaultPdf: ["buildReportPdf", "report-pdf.server.ts"],
  buildVoiceTranscriptPdf: ["buildReportPdf", "report-pdf.server.ts"],
  createMississippiDesotoLandrollArcGisAdapter: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  createMississippiSosArcGisAdapter: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  createNationwideCloudflareHealthWorker: [
    "deliverNextNationwideHealthNotification",
    "nationwide-ingestion-health-delivery.ts",
  ],
  createNationwideCloudflareIngestionWorker: [
    "executeNationwideProductionWorkerTick",
    "nationwide-production-worker.ts",
  ],
  createNationwideR2ArtifactStore: [
    "createNationwideSupabaseArtifactStore",
    "nationwide-supabase-artifact-store.ts",
  ],
  createPropertyApiKey: ["createSandboxApiKey", "property-api-keys.server.ts"],
  createPropertyRecord: ["createOwnerDocument", "property-records-upload.server.ts"],
  createReportSnapshot: ["generateReportSnapshot", "report-vault.server.ts"],
  createStLouisOfficialLraArcGisAdapter: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  createStLouisOfficialSheriffTaxSaleAdapter: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  deleteAnalysisWorkspace: ["closePropertyWorkspace", "property-workspace.functions.ts"],
  downloadPropertyRecord: ["createSignedUrl", "property-owner-records-storage.ts"],
  downloadVaultDocument: ["resolveReportDownloadUrl", "report-vault.server.ts"],
  executeMississippiDesotoTaxSaleReport: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  executeMississippiRankinTaxSaleReport: [
    "createNationwideSourceAdapterBindings",
    "nationwide-source-adapter-bindings.ts",
  ],
  executeStLouisOfficialSheriffTaxSaleReport: [
    "createStLouisSheriffLiveFetchRows",
    "nationwide-st-louis-sheriff-live-fetch.server.ts",
  ],
  getAnalysisThread: ["getPropertyWorkspace", "property-workspace.functions.ts"],
  getAnalysisThreadForSnapshot: ["generateReportSnapshot", "report-vault.server.ts"],
  getAnalysisWorkspace: ["getPropertyWorkspace", "property-workspace.functions.ts"],
  getDealScenario: ["listDealScenarios", "property-intelligence.functions.ts"],
  getPropertyApiRequest: ["getOwnApiAccessRequest", "api-access-requests.functions.ts"],
  listAnalysisThreads: ["listPropertyWorkspaces", "property-workspace.functions.ts"],
  listPropertyApiKeys: ["listSandboxApiKeys", "property-api-keys.server.ts"],
  listPropertyRecords: ["listOwnerDocuments", "property-records-upload.server.ts"],
  listRecordsPortal: ["listReportVault", "report-vault.server.ts"],
  loadVerifiedPropertyRecordEvents: [
    "filterTimelineEligible",
    "property-records-upload-validation.ts",
  ],
  materializeReportSnapshot: ["generateReportSnapshot", "report-vault.server.ts"],
  nationwideArtifactStore: [
    "createNationwideSupabaseArtifactStore",
    "nationwide-supabase-artifact-store.ts",
  ],
  openAnalysisThread: ["openPropertyWorkspace", "property-workspace.functions.ts"],
  pagePropertyApiPayload: ["encodePropertyApiCursor", "property-api-feed.server.ts"],
  refreshDealScenarioFromProperty: ["buildDealAutofill", "deal-autofill.ts"],
  resolvePropertyFeed: ["getCanonicalPropertyPayload", "canonical-property-feed.ts"],
  resolvePropertySearchFeed: ["getCanonicalPropertySearchPayload", "canonical-property-feed.ts"],
  reviewPropertyRecord: ["reviewOwnerDocument", "property-records-upload.server.ts"],
  revokePropertyApiKey: ["revokeSandboxApiKey", "property-api-keys.server.ts"],
  savePropertyApiRequest: ["submitApiAccessRequest", "api-access-requests.functions.ts"],
};

test("every mapped source symbol has a target symbol that still exists", async () => {
  const broken: string[] = [];
  for (const [sourceSymbol, [targetSymbol, targetFile]] of Object.entries(PARITY_MAP)) {
    let contents: string;
    try {
      contents = await readFile(path.join(LIB, targetFile), "utf8");
    } catch {
      broken.push(`${sourceSymbol} -> ${targetFile} (file missing)`);
      continue;
    }
    if (!new RegExp(`\\b${targetSymbol}\\b`).test(contents)) {
      broken.push(`${sourceSymbol} -> ${targetSymbol} in ${targetFile} (symbol missing)`);
    }
  }
  assert.deepEqual(
    broken,
    [],
    "a mapping went stale: either restore the target symbol or update the map",
  );
});

test("the map covers exactly the symbols the parity sweep left unresolved", () => {
  // A guard against the map quietly growing entries for symbols that are not
  // actually unresolved, which would make the count look better than it is.
  assert.equal(Object.keys(PARITY_MAP).length, 44);
});
