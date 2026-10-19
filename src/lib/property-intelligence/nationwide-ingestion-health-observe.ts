// The committing half of nationwide health monitoring, ported from the
// source app's `observeNationwideIngestionHealth`
// (app/lib/nationwide-ingestion-health-monitor.ts).
//
// It completes a loop that was, until now, open at both ends. The pure
// reconciler (nationwide-ingestion-health-monitor.ts) decided transitions
// but nothing called it; the outbox had a reader and a deliverer
// (nationwide-ingestion-health-delivery.ts) but no writer, so
// property_ingest.ingestion_health_outbox could be drained and never filled.
// This is the step in between: observe, persist the incident changes, and
// enqueue each transition for delivery.
//
// One structural difference from the source, following the same split this
// repository already made for the reader. There, `observeNationwideIngestionHealth`
// decides open/escalate/resolve inline while it writes. Here the deciding
// stays in `reconcileNationwideIngestionIncidents`, which already owns those
// rules and is tested without a database; this module only applies what that
// function returned. The reconciler hands back a placeholder identity
// (`new:<sourceDefinitionId>:<alertCode>`) for an incident it opens, and the
// INSERT's real id is substituted before the transition is enqueued -- so no
// outbox row ever carries the placeholder.
//
// What makes this safe to run on a schedule, and each of which is load-bearing:
//
//   * A transaction-scoped advisory lock. Two monitors observing at once
//     would both see the same incident as absent and both open it; the
//     partial unique index would then fail one of them mid-write.
//   * The checkpoint row is read `for update`, and `asOf` must be strictly
//     LATER than the last committed observation. Re-running the same `asOf`
//     raises NationwideHealthObservationAlreadyCommittedError rather than
//     re-enqueueing every transition, and an out-of-order `asOf` is refused
//     outright -- resolving an incident against an older snapshot would
//     close something that is still true.
//   * Active incidents are selected `for update of incident`, so a
//     concurrent resolver cannot close a row between the read and the write.
//   * `includeInactive: false`: a disabled or manual source is never overdue,
//     so it must not open incidents that nothing will ever resolve.
//
// The already-committed case is a distinct error type rather than a silent
// no-op because a scheduler firing twice for one slot is worth seeing; the
// caller can catch it and treat the tick as a no-op.
import {
  queryNationwideIngestionHealth,
  type GetNationwideIngestionHealthInput,
  type NationwideIngestionHealthSnapshot,
} from "./nationwide-ingestion-health-query.ts";
import {
  reconcileNationwideIngestionIncidents,
  type NationwideActiveIncident,
  type NationwideIngestionIncidentTransition,
} from "./nationwide-ingestion-health-monitor.ts";
import { NATIONWIDE_OPERATIONAL_HEALTH_ALERT_CODES } from "./nationwide-ingestion-health.ts";
import type {
  PostgresTransaction,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";
import { UUID_V1_TO_V5 as UUID_PATTERN } from "../validation/patterns.ts";

// Any stable 64-bit key works; it only has to be the same in every monitor.
const MONITOR_ADVISORY_LOCK_KEY = 8_534_221_907_441_002;

const OPERATIONAL_ALERT_CODE_SET = new Set<string>(NATIONWIDE_OPERATIONAL_HEALTH_ALERT_CODES);

export class NationwideHealthObservationAlreadyCommittedError extends Error {
  readonly asOf: string;

  constructor(asOf: string) {
    super(`health observation is already committed for ${asOf}`);
    this.name = "NationwideHealthObservationAlreadyCommittedError";
    this.asOf = asOf;
  }
}

export type ObserveNationwideIngestionHealthInput = Omit<
  GetNationwideIngestionHealthInput,
  "includeInactive"
>;

export type ObserveNationwideIngestionHealthResult = {
  snapshot: NationwideIngestionHealthSnapshot;
  transitions: NationwideIngestionIncidentTransition[];
};

type ActiveIncidentRow = {
  id: string;
  source_definition_id: string;
  source_key: string;
  contract_version: number | string;
  state_code: string | null;
  county_fips: string | null;
  alert_code: string;
  severity: "warning" | "critical";
  observed: number | string;
  expected: string;
};

function canonicalUtc(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC ISO date-time`);
  }
  return value;
}

function uuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`database returned an invalid ${field}`);
  return value;
}

function positiveInteger(value: number | string, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`database returned an invalid ${field}`);
  }
  return parsed;
}

function boundedText(value: number | string, field: string) {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !text.trim() || text.length > 1_000) {
    throw new Error(`${field} must be non-empty and at most 1000 characters`);
  }
  return text;
}

function activeIncidentFromRow(row: ActiveIncidentRow): NationwideActiveIncident {
  uuid(row.id, "health incident ID");
  uuid(row.source_definition_id, "health incident source definition ID");
  if (!OPERATIONAL_ALERT_CODE_SET.has(row.alert_code)) {
    throw new Error("database returned an unsupported active health alert code");
  }
  return {
    incidentId: row.id,
    sourceDefinitionId: row.source_definition_id,
    sourceKey: row.source_key,
    contractVersion: positiveInteger(row.contract_version, "health incident contract version"),
    stateCode: row.state_code,
    countyFips: row.county_fips,
    alertCode: row.alert_code as NationwideActiveIncident["alertCode"],
    severity: row.severity,
    observed: row.observed,
    expected: row.expected,
  };
}

function outboxPayload(transition: NationwideIngestionIncidentTransition) {
  return {
    schemaVersion: 1,
    incidentId: transition.incidentId,
    sourceDefinitionId: transition.sourceDefinitionId,
    sourceKey: transition.sourceKey,
    contractVersion: transition.contractVersion,
    stateCode: transition.stateCode,
    countyFips: transition.countyFips,
    transition: transition.transition,
    alertCode: transition.alertCode,
    severity: transition.severity,
    observed: transition.observed,
    expected: transition.expected,
    snapshotAsOf: transition.snapshotAsOf,
  };
}

async function enqueueTransition(
  transaction: PostgresTransaction,
  transition: NationwideIngestionIncidentTransition,
) {
  const inserted = await transaction.query<{ id: string; idempotency_key: string }>(
    `insert into property_ingest.ingestion_health_outbox (
       incident_id, source_definition_id, transition, alert_code, severity,
       snapshot_as_of, payload, available_at, enqueued_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $6, $6)
     returning id::text, idempotency_key::text`,
    [
      transition.incidentId,
      transition.sourceDefinitionId,
      transition.transition,
      transition.alertCode,
      transition.severity,
      transition.snapshotAsOf,
      JSON.stringify(outboxPayload(transition)),
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("database did not return the queued health transition");
  uuid(row.id, "health outbox ID");
  uuid(row.idempotency_key, "health outbox idempotency key");
  return transition;
}

export async function observeNationwideIngestionHealth(
  database: PostgresTransactionHost,
  input: ObserveNationwideIngestionHealthInput,
): Promise<ObserveNationwideIngestionHealthResult> {
  const asOf = canonicalUtc(input.asOf, "asOf");
  return database.transaction(async (transaction) => {
    // Serializes monitors against each other for the life of this
    // transaction; released automatically on commit or rollback.
    await transaction.query("select pg_advisory_xact_lock($1)", [MONITOR_ADVISORY_LOCK_KEY]);
    const checkpoint = await transaction.query<{ last_snapshot_as_of: string | Date }>(
      `select last_snapshot_as_of
       from property_ingest.ingestion_health_monitor_state
       where singleton
       for update`,
    );
    const lastSnapshot = checkpoint.rows[0]?.last_snapshot_as_of;
    if (lastSnapshot !== undefined && lastSnapshot !== null) {
      const lastSnapshotValue = new Date(lastSnapshot).valueOf();
      if (Date.parse(asOf) === lastSnapshotValue) {
        throw new NationwideHealthObservationAlreadyCommittedError(asOf);
      }
      if (Date.parse(asOf) < lastSnapshotValue) {
        throw new Error("asOf must be later than the last committed health observation");
      }
    }

    const snapshot = await queryNationwideIngestionHealth(transaction, {
      ...input,
      asOf,
      includeInactive: false,
    });

    const activeResult = await transaction.query<ActiveIncidentRow>(
      `select
         incident.id::text,
         incident.source_definition_id::text,
         source.source_key,
         source.contract_version,
         jurisdiction.state_code,
         jurisdiction.county_fips,
         incident.alert_code,
         incident.severity,
         incident.observed,
         incident.expected
       from property_ingest.ingestion_health_incidents incident
       join property_ingest.source_definitions source
         on source.id = incident.source_definition_id
       join property_core.jurisdictions jurisdiction
         on jurisdiction.id = source.jurisdiction_id
       where incident.resolved_at is null
       order by source.source_key, source.contract_version, incident.alert_code
       for update of incident`,
    );
    const activeIncidents = activeResult.rows.map(activeIncidentFromRow);

    // The decision is the reconciler's; this module only applies it.
    const reconciliation = reconcileNationwideIngestionIncidents({
      asOf: snapshot.asOf,
      sources: snapshot.sources,
      activeIncidents,
    });

    const byIncidentId = new Map(
      activeIncidents.map((incident) => [incident.incidentId, incident]),
    );
    const transitions: NationwideIngestionIncidentTransition[] = [];

    for (const transition of reconciliation.transitions) {
      if (transition.transition === "opened") {
        const inserted = await transaction.query<{ id: string }>(
          `insert into property_ingest.ingestion_health_incidents (
             source_definition_id, alert_code, severity, observed, expected,
             opened_at, last_observed_at, opened_snapshot_as_of,
             last_snapshot_as_of, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $6, $6, $6, $6)
           returning id::text`,
          [
            transition.sourceDefinitionId,
            transition.alertCode,
            transition.severity,
            boundedText(transition.observed, "health alert observed value"),
            boundedText(transition.expected, "health alert expected value"),
            snapshot.asOf,
          ],
        );
        // The reconciler's placeholder identity never reaches the outbox.
        const incidentId = uuid(inserted.rows[0]?.id ?? "", "health incident ID");
        transitions.push(await enqueueTransition(transaction, { ...transition, incidentId }));
        continue;
      }

      if (transition.transition === "resolved") {
        await transaction.query(
          `update property_ingest.ingestion_health_incidents
           set resolved_at = $2, last_snapshot_as_of = $2, updated_at = $2
           where id = $1 and resolved_at is null`,
          [transition.incidentId, snapshot.asOf],
        );
        transitions.push(await enqueueTransition(transaction, transition));
        continue;
      }

      // Escalated: the row is refreshed below with every other still-open
      // incident, so only the outbox entry is added here.
      transitions.push(await enqueueTransition(transaction, transition));
    }

    // Every incident still open after reconciliation gets its observation
    // refreshed, whether or not it produced a transition -- an unchanged
    // incident must still record that it was seen in this snapshot, or it
    // would look stale to anything reading last_observed_at.
    for (const incident of reconciliation.activeIncidents) {
      if (!byIncidentId.has(incident.incidentId)) continue;
      await transaction.query(
        `update property_ingest.ingestion_health_incidents
         set severity = $2, observed = $3, expected = $4,
             last_observed_at = $5, last_snapshot_as_of = $5, updated_at = $5
         where id = $1 and resolved_at is null`,
        [
          incident.incidentId,
          incident.severity,
          boundedText(incident.observed, "health alert observed value"),
          boundedText(incident.expected, "health alert expected value"),
          snapshot.asOf,
        ],
      );
    }

    await transaction.query(
      `insert into property_ingest.ingestion_health_monitor_state (
         singleton, last_snapshot_as_of, updated_at
       ) values (true, $1, $1)
       on conflict (singleton) do update
       set last_snapshot_as_of = excluded.last_snapshot_as_of,
           updated_at = excluded.updated_at`,
      [snapshot.asOf],
    );

    return { snapshot, transitions };
  });
}
