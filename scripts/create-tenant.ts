/**
 * Provision a new tenant + admin user (service role). Requires migrations including provider_infra.
 *
 * Usage:
 *   npx tsx scripts/create-tenant.ts --name "Acme Bank" --slug acme-bank --email admin@acme.example --password 'SecurePass123!'
 */
import * as dotenv from "dotenv";
import { bootstrapTenant } from "../lib/platform/create-tenant";
import { resolvePostgresConnectionString } from "../lib/db/connection-string";

dotenv.config({ path: ".env.local" });
dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  if (!resolvePostgresConnectionString()) {
    console.error("Missing DATABASE_URL (or POSTGRES_URL / SUPABASE_DATABASE_URL)");
    process.exit(1);
  }

  const name = arg("--name");
  const slug = arg("--slug");
  const email = arg("--email");
  const password = arg("--password");
  if (!name || !slug || !email || !password) {
    console.error(
      "Usage: npx tsx scripts/create-tenant.ts --name \"Org\" --slug org-slug --email admin@x --password '...'"
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  const out = await bootstrapTenant({
    name,
    slug,
    adminEmail: email,
    adminPassword: password,
  });
  console.log("Created tenant:", out.tenantId, "slug:", out.slug, "admin user:", out.userId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
