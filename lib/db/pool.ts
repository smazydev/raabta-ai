import { Pool } from "pg";
import { resolvePostgresConnectionString } from "./connection-string";

declare global {
  var __raabtaPgPool: Pool | undefined;
}

/**
 * Relax TLS verification for Postgres (dev / broken chains only).
 * `pg` merges `parse(connectionString)` *after* your Pool options, so
 * `?sslmode=require` overwrites a top-level `ssl: { rejectUnauthorized: false }`
 * with an empty `ssl` object → Node still verifies the chain and you get
 * SELF_SIGNED_CERT_IN_CHAIN. We rewrite the URL to `sslmode=no-verify`, which
 * `pg-connection-string` maps to `rejectUnauthorized: false`.
 */
function relaxedTlsEnabled(): boolean {
  const v = process.env.PG_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "no";
}

function connectionStringForPool(raw: string): string {
  if (!relaxedTlsEnabled()) return raw;
  if (/sslmode=no-verify/i.test(raw)) return raw;
  if (/[?&]sslmode=/i.test(raw)) {
    return raw.replace(/sslmode=[^&]*/i, "sslmode=no-verify");
  }
  const join = raw.includes("?") ? "&" : "?";
  return `${raw}${join}sslmode=no-verify`;
}

/** Same URI the app pool uses (includes TLS relaxation when configured). */
export function getResolvedDatabaseUrl(): string {
  const url = resolvePostgresConnectionString();
  if (!url) {
    throw new Error(
      "Set DATABASE_URL (or POSTGRES_URL / SUPABASE_DATABASE_URL) to a PostgreSQL connection string — Supabase project DB, RDS, or any Postgres host."
    );
  }
  return connectionStringForPool(url);
}

export function getPool(): Pool {
  const url = resolvePostgresConnectionString();
  if (!url) {
    throw new Error(
      "Set DATABASE_URL (or POSTGRES_URL / SUPABASE_DATABASE_URL) to a PostgreSQL connection string — Supabase project DB, RDS, or any Postgres host."
    );
  }
  if (!globalThis.__raabtaPgPool) {
    globalThis.__raabtaPgPool = new Pool({
      connectionString: connectionStringForPool(url),
      max: Number(process.env.PG_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(relaxedTlsEnabled() ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return globalThis.__raabtaPgPool;
}
