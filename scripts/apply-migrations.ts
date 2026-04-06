/**
 * Apply every `supabase/migrations/*.sql` file in lexical order via Postgres simple query.
 * Run once against an empty (or pre-migration) database, then `npm run db:seed`.
 *
 * Usage: npx tsx scripts/apply-migrations.ts
 */
import * as dotenv from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import { getResolvedDatabaseUrl } from "../lib/db/pool";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const url = getResolvedDatabaseUrl();
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    for (const name of files) {
      const full = join(dir, name);
      const sql = readFileSync(full, "utf8");
      process.stdout.write(`Applying ${name}… `);
      await client.query(sql);
      console.log("ok");
    }
  } finally {
    await client.end();
  }

  console.log(`\nApplied ${files.length} migration file(s). Next: npm run db:seed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
