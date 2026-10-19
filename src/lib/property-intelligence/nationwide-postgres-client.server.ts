// Real `pg`-backed implementation of the `PostgresTransactionHost` contract,
// unblocking the note left in nationwide-live-st-louis-lra.server.ts and
// nationwide-pg-transaction-host.ts: `pg` is now an approved dependency
// (owner sign-off), so this module can construct a real client -- but it
// still never does so at import time or module scope. `NATIONWIDE_DATABASE_URL`
// is read from `process.env` only inside a function body, the same lazy-init
// pattern as src/integrations/supabase/client.server.ts.
//
// This module builds the pieces; it does not itself run an ingestion, is not
// registered with any route, cron, or scheduled trigger, and this repo's own
// environment has no real value for NATIONWIDE_DATABASE_URL set anywhere --
// calling withRealNationwidePgTransactionHost here would throw on the missing
// env var, not silently connect to anything.
import { Client } from "pg";

import {
  withNationwidePgTransactionHost,
  type NationwidePgClient,
  type NationwidePgClientConfig,
  type NationwidePgSessionOptions,
} from "./nationwide-pg-transaction-host.ts";
import type { PostgresTransactionHost } from "./nationwide-geography-catalog.ts";

function createRealNationwidePgClient(config: NationwidePgClientConfig): NationwidePgClient {
  const client = new Client({
    connectionString: config.connectionString,
    application_name: config.application_name,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    keepAlive: config.keepAlive,
  });
  return {
    connect: () => client.connect(),
    query: (sql, params) => client.query(sql, params),
    end: () => client.end(),
  };
}

export type WithRealNationwidePgTransactionHostOverrides = Partial<
  Omit<NationwidePgSessionOptions, "clientFactory" | "connectionString">
>;

/**
 * Opens one real PostgreSQL session against `NATIONWIDE_DATABASE_URL` (read
 * lazily, inside this function), runs `callback` with the resulting
 * `PostgresTransactionHost`, and closes the session on the way out -- even
 * if `callback` throws. Throws before any connection attempt if the env var
 * is unset, which it is everywhere in this repo's own environment today.
 */
export async function withRealNationwidePgTransactionHost<Result>(
  callback: (database: PostgresTransactionHost) => Promise<Result>,
  overrides?: WithRealNationwidePgTransactionHostOverrides,
): Promise<Result> {
  const connectionString = process.env["NATIONWIDE_DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "Missing NATIONWIDE_DATABASE_URL environment variable. Set it to a PostgreSQL " +
        "connection string for the nationwide ingestion schema before calling this function.",
    );
  }
  return withNationwidePgTransactionHost(
    { ...overrides, connectionString, clientFactory: createRealNationwidePgClient },
    callback,
  );
}
