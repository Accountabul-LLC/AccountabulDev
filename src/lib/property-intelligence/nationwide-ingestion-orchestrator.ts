// Ported from property-intelligence-app's app/lib/nationwide-ingestion-run.ts
// and app/lib/nationwide-ingestion-orchestrator.ts (Slice 2 of the
// nationwide multi-state ingestion port). This slice ports only the PURE
// decision logic those two modules contain -- given a manifest, a batch of
// expected/requested/returned source object IDs, and prior batch results,
// what should the next batching plan be and what coverage does a completed
// run represent. It never makes a network call or a database write: the
// source's `executeNationwideSnapshotIngestion` (the actual worker loop that
// calls an adapter's discover/fetchBatch/normalizeRecord and writes
// property_ingest.source_records / property_core.properties through a
// PostgresTransactionHost) is NOT ported into THIS module, which stays pure
// so it can be tested without a database. That execution loop lives in
// nationwide-source-adapter-bindings.ts (`runSnapshotIngestion`), writing
// through nationwide-postgres-writer.ts. What IS ported here (manifest
// validation, run-key building, batch planning, coverage evaluation) is
// exactly the subset a scheduler/orchestrator caller needs to decide what to
// run next and whether a completed run's coverage was sound, without ever
// touching a network or a database itself.
export type SourceObjectId = string | number;

export type SnapshotBatchResult = {
  batchNumber: number;
  requestedIds: SourceObjectId[];
  returnedIds: SourceObjectId[];
  status: "succeeded" | "failed" | "partial";
  error: string | null;
};

export type SnapshotCoverage = {
  status: "complete" | "partial" | "failed";
  reportedCount: number;
  expectedUniqueCount: number;
  returnedUniqueCount: number;
  duplicateRequestedIds: string[];
  unrequestedExpectedIds: string[];
  unexpectedRequestedIds: string[];
  duplicateReturnedIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  failedBatchNumbers: number[];
  partialBatchNumbers: number[];
  missingBatchNumbers: number[];
  canPublishWithdrawals: boolean;
  warnings: string[];
};

function normalizedId(value: SourceObjectId): string {
  const result = String(value).trim();
  if (!result) throw new Error("source object IDs cannot be blank");
  return result;
}

function compareIds(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

export function normalizeUniqueSourceObjectIds(values: SourceObjectId[], field: string) {
  const normalized = values.map(normalizedId);
  const unique = new Set(normalized);
  if (unique.size !== normalized.length)
    throw new Error(`${field} contains duplicate source object IDs`);
  return [...unique].sort(compareIds);
}

export function planSourceObjectIdBatches(
  objectIds: SourceObjectId[],
  batchSize: number,
  serviceMaximum: number,
): string[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error("batchSize must be a positive integer");
  if (!Number.isInteger(serviceMaximum) || serviceMaximum < 1) {
    throw new Error("serviceMaximum must be a positive integer");
  }
  if (batchSize > serviceMaximum)
    throw new Error("batchSize cannot exceed the source service maximum");
  const ids = normalizeUniqueSourceObjectIds(objectIds, "objectIds");
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    batches.push(ids.slice(index, index + batchSize));
  }
  return batches;
}

export function evaluateSnapshotCoverage(input: {
  expectedIds: SourceObjectId[];
  reportedCount: number;
  serviceMaximum: number;
  batches: SnapshotBatchResult[];
}): SnapshotCoverage {
  if (!Number.isInteger(input.reportedCount) || input.reportedCount < 0) {
    throw new Error("reportedCount must be a nonnegative integer");
  }
  if (!Number.isInteger(input.serviceMaximum) || input.serviceMaximum < 1) {
    throw new Error("serviceMaximum must be a positive integer");
  }
  const expectedIds = normalizeUniqueSourceObjectIds(input.expectedIds, "expectedIds");
  const expected = new Set(expectedIds);
  const requestedOccurrenceCount = new Map<string, number>();
  const occurrenceCount = new Map<string, number>();
  const unexpected = new Set<string>();
  const warnings: string[] = [];
  const failedBatchNumbers: number[] = [];
  const partialBatchNumbers: number[] = [];
  const batchNumbers = new Set<number>();

  for (const batch of input.batches) {
    if (!Number.isInteger(batch.batchNumber) || batch.batchNumber < 1) {
      throw new Error("batchNumber must be a positive integer");
    }
    if (batchNumbers.has(batch.batchNumber)) throw new Error("batch numbers must be unique");
    batchNumbers.add(batch.batchNumber);
    if (batch.requestedIds.length > input.serviceMaximum) {
      throw new Error(`batch ${batch.batchNumber} exceeds the source service maximum`);
    }
    const requested = new Set(batch.requestedIds.map(normalizedId));
    if (requested.size !== batch.requestedIds.length) {
      throw new Error(`batch ${batch.batchNumber} requests duplicate source object IDs`);
    }
    requested.forEach((id) =>
      requestedOccurrenceCount.set(id, (requestedOccurrenceCount.get(id) ?? 0) + 1),
    );
    if (batch.status === "failed") {
      failedBatchNumbers.push(batch.batchNumber);
      warnings.push(`Batch ${batch.batchNumber} failed${batch.error ? `: ${batch.error}` : "."}`);
      continue;
    }
    if (batch.status === "partial") {
      partialBatchNumbers.push(batch.batchNumber);
      warnings.push(
        `Batch ${batch.batchNumber} returned a partial response${batch.error ? `: ${batch.error}` : "."}`,
      );
    }
    if (batch.error) warnings.push("Batch succeeded but also published an error message.");
    for (const rawId of batch.returnedIds) {
      const id = normalizedId(rawId);
      occurrenceCount.set(id, (occurrenceCount.get(id) ?? 0) + 1);
      if (!expected.has(id) || !requested.has(id)) unexpected.add(id);
    }
  }

  if (input.reportedCount !== expectedIds.length) {
    warnings.push(
      `Source reported ${input.reportedCount} records but returned ${expectedIds.length} unique expected IDs.`,
    );
  }
  const returned = new Set(occurrenceCount.keys());
  const duplicateRequestedIds = [...requestedOccurrenceCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort(compareIds);
  const unrequestedExpectedIds = expectedIds.filter((id) => !requestedOccurrenceCount.has(id));
  const unexpectedRequestedIds = [...requestedOccurrenceCount.keys()]
    .filter((id) => !expected.has(id))
    .sort(compareIds);
  const highestBatchNumber = batchNumbers.size === 0 ? 0 : Math.max(...batchNumbers);
  const missingBatchNumbers = Array.from(
    { length: highestBatchNumber },
    (_, index) => index + 1,
  ).filter((batchNumber) => !batchNumbers.has(batchNumber));
  const duplicateReturnedIds = [...occurrenceCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort(compareIds);
  const missingIds = expectedIds.filter((id) => !returned.has(id));
  const unexpectedIds = [...unexpected].sort(compareIds);
  if (duplicateRequestedIds.length > 0) {
    warnings.push(
      `${duplicateRequestedIds.length} expected source object IDs were requested more than once.`,
    );
  }
  if (unrequestedExpectedIds.length > 0) {
    warnings.push(
      `${unrequestedExpectedIds.length} expected source object IDs were never requested.`,
    );
  }
  if (unexpectedRequestedIds.length > 0) {
    warnings.push(
      `${unexpectedRequestedIds.length} unregistered source object IDs were requested.`,
    );
  }
  if (missingBatchNumbers.length > 0) {
    warnings.push(`${missingBatchNumbers.length} batch numbers are missing from the run sequence.`);
  }
  if (duplicateReturnedIds.length > 0) {
    warnings.push(`${duplicateReturnedIds.length} source object IDs were returned more than once.`);
  }
  if (missingIds.length > 0)
    warnings.push(`${missingIds.length} expected source object IDs were not returned.`);
  if (unexpectedIds.length > 0) {
    warnings.push(
      `${unexpectedIds.length} unrequested or unregistered source object IDs were returned.`,
    );
  }

  const complete =
    failedBatchNumbers.length === 0 &&
    partialBatchNumbers.length === 0 &&
    input.reportedCount === expectedIds.length &&
    returned.size === expectedIds.length &&
    duplicateRequestedIds.length === 0 &&
    unrequestedExpectedIds.length === 0 &&
    unexpectedRequestedIds.length === 0 &&
    missingBatchNumbers.length === 0 &&
    duplicateReturnedIds.length === 0 &&
    missingIds.length === 0 &&
    unexpectedIds.length === 0;
  const status: SnapshotCoverage["status"] = complete
    ? "complete"
    : failedBatchNumbers.length === input.batches.length && input.batches.length > 0
      ? "failed"
      : "partial";

  return {
    status,
    reportedCount: input.reportedCount,
    expectedUniqueCount: expectedIds.length,
    returnedUniqueCount: returned.size,
    duplicateRequestedIds,
    unrequestedExpectedIds,
    unexpectedRequestedIds,
    duplicateReturnedIds,
    missingIds,
    unexpectedIds,
    failedBatchNumbers: failedBatchNumbers.sort((left, right) => left - right),
    partialBatchNumbers: partialBatchNumbers.sort((left, right) => left - right),
    missingBatchNumbers,
    canPublishWithdrawals: complete,
    warnings,
  };
}

/**
 * Ported from property-intelligence-app's app/lib/nationwide-ingestion-run.ts.
 *
 * A record absent from the current snapshot may only be treated as withdrawn
 * when the snapshot was COMPLETE. On a partial or failed snapshot the absence
 * is far more likely to mean the fetch was short than that the agency removed
 * the record, so withdrawals are suppressed with a reason rather than emitted
 * -- publishing them would silently retire live records on a bad fetch.
 */
export function planConfirmedWithdrawals(
  previouslyActiveRecordKeys: SourceObjectId[],
  currentlyActiveRecordKeys: SourceObjectId[],
  coverage: SnapshotCoverage,
): {
  withdrawalRecordKeys: string[];
  suppressed: boolean;
  reason: string;
} {
  if (!coverage.canPublishWithdrawals) {
    return {
      withdrawalRecordKeys: [],
      suppressed: true,
      reason: "Withdrawals are suppressed because the current source snapshot is not complete.",
    };
  }
  const previous = normalizeUniqueSourceObjectIds(
    previouslyActiveRecordKeys,
    "previouslyActiveRecordKeys",
  );
  const current = new Set(
    normalizeUniqueSourceObjectIds(currentlyActiveRecordKeys, "currentlyActiveRecordKeys"),
  );
  return {
    withdrawalRecordKeys: previous.filter((key) => !current.has(key)),
    suppressed: false,
    reason:
      "The source snapshot is complete, so absent previously active records may receive withdrawal lifecycle events.",
  };
}
