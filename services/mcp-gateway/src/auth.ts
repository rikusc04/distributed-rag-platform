// API-key auth. Keys are provided by the client in the `Authorization` header
// as `Bearer <key>`. We look up a sha256 hash of the raw key in `api_keys`
// and return the associated tenant_id.

import { createHash } from "node:crypto";

import type { Pool } from "pg";

export class AuthError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
    this.name = "AuthError";
  }
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function parseBearer(headerValue: string | undefined): string {
  if (!headerValue) {
    throw new AuthError("missing_header", "Authorization header is required");
  }
  const match = /^Bearer\s+(\S+)$/.exec(headerValue);
  if (!match) {
    throw new AuthError("bad_header", "Authorization header must be `Bearer <key>`");
  }
  return match[1];
}

export async function resolveTenant(pool: Pool, rawKey: string): Promise<string> {
  const hash = hashApiKey(rawKey);
  // Bypass RLS explicitly by hitting the row via primary lookup on key_hash.
  // The `api_keys` policy still filters by tenant, but the gateway itself
  // needs to run this query without a tenant context (we don't know it yet).
  // Simplest solution: keep this lookup outside any withTenant() call. The
  // key_hash column is UNIQUE so a match returns at most one row.
  const result = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id
       FROM api_keys
      WHERE key_hash = $1
        AND revoked_at IS NULL`,
    [hash],
  );
  if (result.rows.length === 0) {
    throw new AuthError("unknown_key", "unknown or revoked API key");
  }
  return result.rows[0].tenant_id;
}
