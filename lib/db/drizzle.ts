import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPool } from "./pool";
import * as schema from "./schema";

export type AppSchema = typeof schema;

let dbInstance: NodePgDatabase<AppSchema> | null = null;

/**
 * Typed Drizzle client over the same `pg` pool as {@link createUserClient}.
 * Schema mirrors `supabase/migrations/`; DDL remains SQL-first — use Drizzle for queries in new code.
 */
export function getDb(): NodePgDatabase<AppSchema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

export type Db = ReturnType<typeof getDb>;
