// Ported from property-intelligence-app's app/lib/nationwide-health-webhook-sink.ts.
//
// One adaptation, because the two repos model the outbox differently. There,
// NationwideIngestionIncidentTransition carries outboxId and idempotencyKey;
// here those live on NationwideHealthOutboxEntry instead, keeping the domain
// transition free of delivery bookkeeping. The sink only ever receives the
// notification plus the idempotency key, so:
//
//   * the event body carries idempotencyKey as the outbox row's durable
//     identity in place of outboxId. Both uniquely identify the same row --
//     idempotency_key is UNIQUE in 20260924150000 -- so a receiver dedupes on
//     it identically.
//   * the source additionally cross-checks the supplied key against the one
//     embedded in the notification. That check is not expressible here because
//     the notification does not carry a key; the UUID-format check remains,
//     and the caller (deliverNextNationwideHealthNotification) is the only
//     path that supplies it, reading it straight off the outbox entry.
import type {
  NationwideHealthDeliverySink,
  NationwideHealthNotification,
} from "./nationwide-ingestion-health-delivery.ts";
import { UUID_V1_TO_V5 as UUID_PATTERN } from "../validation/patterns.ts";

export type CreateNationwideHealthWebhookSinkInput = {
  endpoint: string;
  bearerToken: string;
  timeoutMillis?: number;
  fetchImpl?: typeof fetch;
};

function endpoint(value: string) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 2_048) {
    throw new Error("health webhook endpoint must be a trimmed HTTPS URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("health webhook endpoint must be a trimmed HTTPS URL");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      "health webhook endpoint must be an HTTPS URL without credentials or a fragment",
    );
  }
  return parsed.toString();
}

function token(value: string) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 16 ||
    value.length > 4_096 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new Error(
      "health webhook bearer token must be a trimmed managed secret of 16-4096 characters",
    );
  }
  return value;
}

function timeout(value: number | undefined) {
  const resolved = value ?? 10_000;
  if (!Number.isInteger(resolved) || resolved < 1_000 || resolved > 60_000) {
    throw new Error("health webhook timeoutMillis must be an integer between 1000 and 60000");
  }
  return resolved;
}

function eventBody(notification: NationwideHealthNotification, idempotencyKey: string) {
  return {
    schemaVersion: 1,
    eventType: "accountabul.nationwide_ingestion_health",
    idempotencyKey,
    incidentId: notification.incidentId,
    sourceDefinitionId: notification.sourceDefinitionId,
    sourceKey: notification.sourceKey,
    contractVersion: notification.contractVersion,
    stateCode: notification.stateCode,
    countyFips: notification.countyFips,
    transition: notification.transition,
    alertCode: notification.alertCode,
    severity: notification.severity,
    observed: notification.observed,
    expected: notification.expected,
    snapshotAsOf: notification.snapshotAsOf,
    enqueuedAt: notification.enqueuedAt,
    claimCount: notification.claimCount,
  };
}

export function createNationwideHealthWebhookSink(
  input: CreateNationwideHealthWebhookSinkInput,
): NationwideHealthDeliverySink {
  const target = endpoint(input.endpoint);
  const bearerToken = token(input.bearerToken);
  const timeoutMillis = timeout(input.timeoutMillis);
  const fetchImpl = input.fetchImpl ?? fetch;
  if (typeof fetchImpl !== "function")
    throw new Error("health webhook fetch implementation is required");
  return {
    async deliver({ notification, idempotencyKey }) {
      if (!UUID_PATTERN.test(idempotencyKey)) {
        throw new Error("health webhook delivery requires the durable outbox idempotency key");
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMillis);
      let response: Response;
      try {
        response = await fetchImpl(target, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${bearerToken}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "user-agent": "Accountabul-Nationwide-Health/1",
          },
          body: JSON.stringify(eventBody(notification, idempotencyKey)),
          redirect: "error",
          signal: abort.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw new Error(`health alert provider returned HTTP ${response.status}`);
      }
    },
  };
}
