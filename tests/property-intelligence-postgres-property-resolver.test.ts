// Slice 4 of the nationwide multi-state ingestion port. Exercises
// createNationwidePostgresPropertyResolver against a hand-written, in-memory
// fake PostgresTransactionHost modeling only the two queries the resolver
// actually issues (property_ingest.source_definitions,
// property_ingest.identifier_match_policies -- plus the crosswalk/identifier
// evidence queries when policies exist). Never a network connection, never a
// real or embedded Postgres, matching this repo's established fake-DB test
// style (tests/property-intelligence-geography-import.test.ts).
import assert from "node:assert/strict";
import test from "node:test";

import { createNationwidePostgresPropertyResolver } from "../src/lib/property-intelligence/nationwide-postgres-property-resolver.ts";
import type {
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionHost,
} from "../src/lib/property-intelligence/nationwide-geography-catalog.ts";
import type { PropertyResolutionBundle } from "../src/lib/property-intelligence/nationwide-property-resolution.ts";

const SOURCE_DEFINITION_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_KEY = "ms_rankin_county_tax_sale_report_v1";
const RESOLUTION_AS_OF = "2026-09-24T00:00:00.000Z";

type FakePolicy = {
  source_identifier_type: string;
  canonical_identifier_type: string;
  issuer_jurisdiction_id: string | null;
  issuer_county_fips: string | null;
  policy_version: string;
  evidence_reference: string;
};

class FakePropertyResolutionDatabase implements PostgresTransactionHost {
  policies: FakePolicy[] = [];
  identifiers: Array<{
    property_id: string;
    issuer_county_fips: string;
    identifier_type: string;
    normalized_value: string;
    is_authoritative: boolean;
    is_preferred: boolean;
    valid_to: string | null;
  }> = [];

  async transaction<Result>(
    callback: (transaction: PostgresTransaction) => Promise<Result>,
  ): Promise<Result> {
    return callback({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> => {
        const normalized = sql.replace(/\s+/g, " ").trim();

        if (
          normalized.startsWith(
            "select source_key, contract_version from property_ingest.source_definitions",
          )
        ) {
          return {
            rows: [{ source_key: SOURCE_KEY, contract_version: 1 }],
          } as unknown as PostgresQueryResult<Row>;
        }
        if (normalized.startsWith("select policy.source_identifier_type")) {
          return { rows: this.policies } as unknown as PostgresQueryResult<Row>;
        }
        if (
          normalized.startsWith("select crosswalk.property_id::text, crosswalk.evidence_reference")
        ) {
          return { rows: [] } as PostgresQueryResult<Row>;
        }
        if (normalized.startsWith("select identifier.property_id::text")) {
          const candidates = JSON.parse(params[0] as string) as Array<{
            issuer_county_fips: string;
            identifier_type: string;
            normalized_value: string;
          }>;
          const rows = this.identifiers.filter((identifier) =>
            candidates.some(
              (candidate) =>
                candidate.issuer_county_fips === identifier.issuer_county_fips &&
                candidate.identifier_type === identifier.identifier_type &&
                candidate.normalized_value === identifier.normalized_value,
            ),
          );
          return { rows } as unknown as PostgresQueryResult<Row>;
        }
        throw new Error(
          `FakePropertyResolutionDatabase: unmodeled query: ${normalized.slice(0, 80)}`,
        );
      },
    });
  }
}

function bundle(): PropertyResolutionBundle {
  return {
    sourceRecord: {
      sourceDefinitionKey: SOURCE_KEY,
      sourceRecordKey: "record-1",
      sourceVersion: "1",
      recordFingerprint: "a".repeat(64),
    } as PropertyResolutionBundle["sourceRecord"],
    propertyCandidate: {
      identifiers: [
        {
          identifierType: "tax_sale_parcel_reference",
          issuerCountyFips: "28121",
          rawValue: "12-34-56",
          normalizedValue: "123456",
          verificationStatus: "published",
          isAuthoritative: false,
        },
      ],
      addresses: [],
      observations: [],
    },
  };
}

test("Slice 4: the resolver fails closed when no approved identifier-match policy exists", async () => {
  const database = new FakePropertyResolutionDatabase();
  const resolve = createNationwidePostgresPropertyResolver({
    database,
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    sourceDefinitionKey: SOURCE_KEY,
    contractVersion: 1,
    resolutionAsOf: RESOLUTION_AS_OF,
  });

  const result = await resolve(bundle());
  assert.equal(result.status, "unresolved");
  assert.equal(result.propertyId, null);
  assert.match(result.reason, /No enabled identifier match policy authorizes automatic resolution/);
});

test("Slice 4: an approved, enabled identifier-match policy lets an exact scoped identifier resolve", async () => {
  const database = new FakePropertyResolutionDatabase();
  database.policies.push({
    source_identifier_type: "tax_sale_parcel_reference",
    canonical_identifier_type: "parcel_number",
    issuer_jurisdiction_id: null,
    issuer_county_fips: null,
    policy_version: "v1",
    evidence_reference: "policy-doc-1",
  });
  database.identifiers.push({
    property_id: "33333333-3333-4333-8333-333333333333",
    issuer_county_fips: "28121",
    identifier_type: "parcel_number",
    normalized_value: "123456",
    is_authoritative: true,
    is_preferred: true,
    valid_to: null,
  });

  const resolve = createNationwidePostgresPropertyResolver({
    database,
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    sourceDefinitionKey: SOURCE_KEY,
    contractVersion: 1,
    resolutionAsOf: RESOLUTION_AS_OF,
  });

  const result = await resolve(bundle());
  assert.equal(result.status, "resolved");
  assert.equal(result.propertyId, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.method, "exact_scoped_identifier");
});

test("Slice 4: a normalized bundle from a different source contract is rejected before any query", async () => {
  const database: PostgresTransactionHost = {
    transaction: async () => {
      throw new Error("must not be called for a mismatched source contract");
    },
  };
  const resolve = createNationwidePostgresPropertyResolver({
    database,
    sourceDefinitionId: SOURCE_DEFINITION_ID,
    sourceDefinitionKey: SOURCE_KEY,
    contractVersion: 1,
    resolutionAsOf: RESOLUTION_AS_OF,
  });
  const wrongSourceBundle = bundle();
  (wrongSourceBundle.sourceRecord as { sourceDefinitionKey: string }).sourceDefinitionKey =
    "some_other_source_v1";
  await assert.rejects(resolve(wrongSourceBundle), /does not match the property resolver contract/);
});
