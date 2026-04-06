/**
 * Creates `public.app_users` if it is missing (half-applied DB / failed migration).
 * Safe to run multiple times. Does not drop data.
 *
 * Usage: npx tsx scripts/ensure-app-users.ts
 */
import * as dotenv from "dotenv";
import { Client } from "pg";
import { getResolvedDatabaseUrl } from "../lib/db/pool";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const url = getResolvedDatabaseUrl();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await client.query<{ regclass: string }>(
      `SELECT to_regclass('public.app_users')::text AS regclass`
    );
    console.log("public.app_users:", rows[0]?.regclass ?? "(check failed)");
    console.log("If login still fails, run full migrations (see README) and `npm run db:seed`.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
