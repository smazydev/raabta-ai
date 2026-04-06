/**
 * Browser client removed: data access is server-only via Postgres.
 * Live updates use polling against `/api/live-events`.
 */
export function createClient() {
  throw new Error(
    "Browser DB client removed — data access is server-only (DATABASE_URL / Postgres connection on the server)."
  );
}
