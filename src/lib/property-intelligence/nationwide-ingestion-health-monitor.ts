// Ported from property-intelligence-app's app/lib/nationwide-ingestion-health-monitor.ts
// (Slice 2 of the nationwide multi-state ingestion port). The source's
// `observeNationwideIngestionHealth` does this reconciliation inside a
// single database transaction (advisory-locked against concurrent monitor
// runs, reading/writing property_ingest.ingestion_health_incidents and
// enqueuing property_ingest.ingestion_health_outbox rows). This slice ports
// only the PURE reconciliation decision -- given the currently observed
// alerts (from nationwide-ingestion-health.ts) and the incidents already
// open, which incidents should open, escalate, or resolve, and what outbox
// transitions that implies. It never queries or writes a database itself; a
// caller (not built in this repo) would load the active-incident rows,
// call this, and persist the result inside its own transaction.
import type {
  NationwideIngestionHealthAlert,
  NationwideOperationalHealthAlertCode,
  NationwideSourceIngestionHealth,
} from "./nationwide-ingestion-health.ts";

export type NationwideActiveIncident = {
  incidentId: string;
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  stateCode: string | null;
  countyFips: string | null;
  alertCode: NationwideOperationalHealthAlertCode;
  severity: "warning" | "critical";
  observed: number | string;
  expected: string;
};

export type NationwideIngestionIncidentTransition = {
  incidentId: string;
  sourceDefinitionId: string;
  sourceKey: string;
  contractVersion: number;
  stateCode: string | null;
  countyFips: string | null;
  transition: "opened" | "escalated" | "resolved";
  alertCode: NationwideOperationalHealthAlertCode;
  severity: "warning" | "critical";
  observed: number | string;
  expected: string;
  snapshotAsOf: string;
};

export type NationwideIncidentReconciliation = {
  transitions: NationwideIngestionIncidentTransition[];
  // The incident set as it stands after reconciliation: still-open incidents
  // (new, unchanged, or escalated) with their (possibly updated) severity/
  // observed/expected -- a caller persists this as the new active set.
  activeIncidents: NationwideActiveIncident[];
};

function incidentKey(sourceDefinitionId: string, alertCode: NationwideOperationalHealthAlertCode) {
  return `${sourceDefinitionId}:${alertCode}`;
}

function severityRank(severity: "warning" | "critical") {
  return severity === "critical" ? 2 : 1;
}

function nextIncidentId(
  source: NationwideSourceIngestionHealth,
  alert: NationwideIngestionHealthAlert,
) {
  // Deterministic placeholder identity for an incident this reconciliation
  // opens -- a real caller replaces it with the ID its own INSERT returned
  // before persisting. Kept stable and inspectable for pure-function tests.
  return `new:${incidentKey(source.sourceDefinitionId, alert.code)}`;
}

// Reconcile a health snapshot's alerts against the incidents that were open
// before this observation. Dedupe: at most one open incident per
// (sourceDefinitionId, alertCode) at a time, matching
// ingestion_health_incidents_one_active_idx's partial unique index. Open: a
// currently-observed alert with no matching open incident. Escalate: an open
// incident whose severity increases (warning -> critical). Resolve: an open
// incident whose alert is no longer observed for that source.
export function reconcileNationwideIngestionIncidents(input: {
  asOf: string;
  sources: readonly NationwideSourceIngestionHealth[];
  activeIncidents: readonly NationwideActiveIncident[];
}): NationwideIncidentReconciliation {
  const activeByKey = new Map(
    input.activeIncidents.map((incident) => [
      incidentKey(incident.sourceDefinitionId, incident.alertCode),
      incident,
    ]),
  );
  const observedKeys = new Set<string>();
  const transitions: NationwideIngestionIncidentTransition[] = [];
  const activeIncidents: NationwideActiveIncident[] = [];

  for (const source of input.sources) {
    for (const currentAlert of source.alerts) {
      const key = incidentKey(source.sourceDefinitionId, currentAlert.code);
      if (observedKeys.has(key)) {
        throw new Error("health snapshot contains a duplicate source alert code");
      }
      observedKeys.add(key);
      const existing = activeByKey.get(key);
      if (!existing) {
        const incidentId = nextIncidentId(source, currentAlert);
        transitions.push({
          incidentId,
          sourceDefinitionId: source.sourceDefinitionId,
          sourceKey: source.sourceKey,
          contractVersion: source.contractVersion,
          stateCode: source.stateCode,
          countyFips: source.countyFips,
          transition: "opened",
          alertCode: currentAlert.code,
          severity: currentAlert.severity,
          observed: currentAlert.observed,
          expected: currentAlert.expected,
          snapshotAsOf: input.asOf,
        });
        activeIncidents.push({
          incidentId,
          sourceDefinitionId: source.sourceDefinitionId,
          sourceKey: source.sourceKey,
          contractVersion: source.contractVersion,
          stateCode: source.stateCode,
          countyFips: source.countyFips,
          alertCode: currentAlert.code,
          severity: currentAlert.severity,
          observed: currentAlert.observed,
          expected: currentAlert.expected,
        });
        continue;
      }
      const escalated = severityRank(currentAlert.severity) > severityRank(existing.severity);
      if (escalated) {
        transitions.push({
          incidentId: existing.incidentId,
          sourceDefinitionId: source.sourceDefinitionId,
          sourceKey: source.sourceKey,
          contractVersion: source.contractVersion,
          stateCode: source.stateCode,
          countyFips: source.countyFips,
          transition: "escalated",
          alertCode: currentAlert.code,
          severity: currentAlert.severity,
          observed: currentAlert.observed,
          expected: currentAlert.expected,
          snapshotAsOf: input.asOf,
        });
      }
      activeIncidents.push({
        ...existing,
        severity: currentAlert.severity,
        observed: currentAlert.observed,
        expected: currentAlert.expected,
      });
    }
  }

  for (const existing of input.activeIncidents) {
    const key = incidentKey(existing.sourceDefinitionId, existing.alertCode);
    if (observedKeys.has(key)) continue;
    transitions.push({
      incidentId: existing.incidentId,
      sourceDefinitionId: existing.sourceDefinitionId,
      sourceKey: existing.sourceKey,
      contractVersion: existing.contractVersion,
      stateCode: existing.stateCode,
      countyFips: existing.countyFips,
      transition: "resolved",
      alertCode: existing.alertCode,
      severity: existing.severity,
      observed: existing.observed,
      expected: existing.expected,
      snapshotAsOf: input.asOf,
    });
  }

  return { transitions, activeIncidents };
}
