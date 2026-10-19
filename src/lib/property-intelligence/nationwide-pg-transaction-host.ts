// Slice 4 of the nationwide multi-state ingestion port. Ported (adapted)
// from property-intelligence-app's app/lib/nationwide-pg-transaction-host.ts:
// a thin wrapper that opens ONE PostgreSQL session and exposes it through
// this repo's `PostgresTransactionHost` contract (kept in
// nationwide-geography-catalog.ts since Slice 1, reused here instead of
// redeclaring it) -- bounded transactions (statement/lock/idle timeouts),
// begin/commit/rollback discipline, and a clean session close on the way
// out, even when the callback throws.
//
// UNLIKE the source, this module has NO import of the `pg` package and NO
// default client construction at all. `options.clientFactory` is REQUIRED
// (not optional the way the source's is): the only way to obtain a working
// `PostgresTransactionHost` from this module is to hand it a real client
// constructed by the caller. Calling `withNationwidePgTransactionHost`
// without a `clientFactory` throws before anything resembling a network
// call happens, which keeps this module itself testable against a fake
// client and unable to reach a database on its own.
//
// `pg` IS a dependency of this repo, and
// nationwide-postgres-client.server.ts is the one module that imports it and
// supplies a real `clientFactory` to this one --  keeping the driver import
// out of this file is what preserves the property above.
import type {
  PostgresQueryResult,
  PostgresTransactionHost,
} from "./nationwide-geography-catalog.ts";

export type NationwidePgClientConfig = {
  connectionString: string;
  application_name: string;
  connectionTimeoutMillis: number;
  keepAlive: true;
};

export type NationwidePgClient = {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};

export type NationwidePgClientFactory = (config: NationwidePgClientConfig) => NationwidePgClient;

export type NationwidePgSessionOptions = {
  connectionString: string;
  applicationName?: string;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  lockTimeoutMillis?: number;
  idleInTransactionTimeoutMillis?: number;
  // No default: the caller MUST inject a real client. See module header.
  clientFactory: NationwidePgClientFactory;
};

const APPLICATION_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,62}$/;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number,
) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function validatedConnectionString(value: string) {
  const connectionString = value.trim();
  if (!connectionString || connectionString !== value || connectionString.length > 4_096) {
    throw new Error("connectionString must be a trimmed PostgreSQL connection string");
  }
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("connectionString must be an absolute PostgreSQL connection string");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.pathname.slice(1)
  ) {
    throw new Error("connectionString must identify a PostgreSQL host and database");
  }
  return connectionString;
}

function validatedApplicationName(value: string | undefined) {
  const applicationName = value?.trim() || "accountabul-nationwide-ingestion";
  if (!APPLICATION_NAME_PATTERN.test(applicationName)) {
    throw new Error("applicationName must use 1-63 safe identifier characters");
  }
  return applicationName;
}

async function closeClient(client: NationwidePgClient, priorError: unknown) {
  try {
    await client.end();
  } catch (closeError) {
    if (priorError !== undefined) {
      throw new AggregateError(
        [priorError, closeError],
        "PostgreSQL session and cleanup both failed",
      );
    }
    throw closeError;
  }
  if (priorError !== undefined) throw priorError;
}

export async function withNationwidePgTransactionHost<Result>(
  options: NationwidePgSessionOptions,
  callback: (database: PostgresTransactionHost) => Promise<Result>,
): Promise<Result> {
  if (typeof callback !== "function") throw new Error("PostgreSQL session requires a callback");
  if (typeof options.clientFactory !== "function") {
    throw new Error(
      "PostgreSQL session requires an injected clientFactory -- this module has no default client and " +
        "never opens a real connection on its own",
    );
  }
  const connectionString = validatedConnectionString(options.connectionString);
  const connectionTimeoutMillis = boundedInteger(
    options.connectionTimeoutMillis,
    10_000,
    "connectionTimeoutMillis",
    60_000,
  );
  const statementTimeoutMillis = boundedInteger(
    options.statementTimeoutMillis,
    120_000,
    "statementTimeoutMillis",
    900_000,
  );
  const lockTimeoutMillis = boundedInteger(
    options.lockTimeoutMillis,
    10_000,
    "lockTimeoutMillis",
    120_000,
  );
  const idleInTransactionTimeoutMillis = boundedInteger(
    options.idleInTransactionTimeoutMillis,
    60_000,
    "idleInTransactionTimeoutMillis",
    900_000,
  );
  const clientConfig: NationwidePgClientConfig = {
    connectionString,
    application_name: validatedApplicationName(options.applicationName),
    connectionTimeoutMillis,
    keepAlive: true,
  };
  const client = options.clientFactory(clientConfig);
  let closed = false;
  let transactionActive = false;
  let priorError: unknown;
  let result: Result | undefined;

  try {
    await client.connect();
    const database: PostgresTransactionHost = {
      async transaction(transactionCallback) {
        if (closed) throw new Error("PostgreSQL session is already closed");
        if (transactionActive)
          throw new Error("nested or overlapping PostgreSQL transactions are not allowed");
        transactionActive = true;
        await client.query("begin");
        let callbackActive = true;
        try {
          await client.query("set transaction isolation level read committed");
          await client.query(
            `select set_config('statement_timeout', $1, true),
                    set_config('lock_timeout', $2, true),
                    set_config('idle_in_transaction_session_timeout', $3, true)`,
            [
              String(statementTimeoutMillis),
              String(lockTimeoutMillis),
              String(idleInTransactionTimeoutMillis),
            ],
          );
          const value = await transactionCallback({
            async query<Row extends Record<string, unknown> = Record<string, unknown>>(
              sql: string,
              params?: unknown[],
            ): Promise<PostgresQueryResult<Row>> {
              if (!callbackActive || !transactionActive || closed) {
                throw new Error("PostgreSQL transaction query escaped its active callback");
              }
              const queryResult = await client.query(sql, params);
              return { rows: queryResult.rows as Row[] };
            },
          });
          callbackActive = false;
          await client.query("commit");
          return value;
        } catch (error) {
          callbackActive = false;
          try {
            await client.query("rollback");
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "PostgreSQL transaction and rollback both failed",
            );
          }
          throw error;
        } finally {
          transactionActive = false;
        }
      },
    };
    result = await callback(database);
  } catch (error) {
    priorError = error;
  } finally {
    closed = true;
    await closeClient(client, priorError);
  }
  return result as Result;
}
