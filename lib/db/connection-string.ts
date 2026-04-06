/**
 * Single Postgres backend: Supabase-hosted Postgres, Amazon RDS, Neon, Docker, etc.
 * Prefer `DATABASE_URL`; other names are common in hosting dashboards (swap env only).
 */
export function resolvePostgresConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim()
  );
}
