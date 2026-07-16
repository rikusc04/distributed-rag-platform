// Postgres pool + tenant-scoped transaction helper.
//
// `withTenant` opens a transaction, sets `app.current_tenant` so RLS scopes
// every read to the correct tenant, runs the caller's async fn against a
// dedicated pooled client, and rolls back on error.

import { Pool, PoolClient } from "pg";
import pgvector from "pgvector/pg";

import type { Config } from "./config.js";

export interface Db {
  withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
  pool: Pool;
}

export async function makeDb(cfg: Config): Promise<Db> {
  const pool = new Pool({
    host: cfg.dbHost,
    port: cfg.dbPort,
    database: cfg.dbName,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    max: 10,
    ssl: { rejectUnauthorized: false },
  });

  pool.on("connect", async (client) => {
    // Register the pgvector custom type so SELECT of a `vector` column returns
    // a plain number[] instead of the "[0.1, 0.2, ...]" string.
    try {
      await pgvector.registerTypes(client);
    } catch (err) {
      // Non-fatal — the connection just won't decode vectors natively. Log
      // once and move on so we don't crash-loop if the extension isn't
      // installed on a fresh dev DB.
      console.error("failed to register pgvector types", err);
    }
  });

  return {
    pool,
    end: () => pool.end(),
    withTenant: async <T>(
      tenantId: string,
      fn: (client: PoolClient) => Promise<T>,
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // set_config with is_local=true ties the setting to this tx, so it
        // resets on COMMIT/ROLLBACK and can't leak to the next pool checkout.
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
