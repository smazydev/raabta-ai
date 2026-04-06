import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getDb, type Db } from "./drizzle";
import { getPool } from "./pool";
import { QueryBuilder } from "./query-builder";
import { runRpc } from "./rpc";

/** Server-only DB client with full access (no RLS). Use only after API-key / bootstrap authz. */
export function createServiceRoleClient() {
  const pool = getPool();
  return {
    from: (table: string) => new QueryBuilder(pool, table),
    get db(): Db {
      return getDb();
    },
    rpc: (fn: string, params: Record<string, unknown>) => runRpc(pool, fn, params),
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      admin: {
        async listUsers() {
          const r = await pool.query(`SELECT id, email FROM app_users ORDER BY email`);
          return {
            data: {
              users: r.rows.map((row) => ({
                id: row.id as string,
                email: row.email as string,
              })),
            },
            error: null,
          };
        },
        async createUser(input: {
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: { display_name?: string };
        }) {
          const id = randomUUID();
          const hash = await bcrypt.hash(input.password, 12);
          await pool.query(`INSERT INTO app_users (id, email, password_hash) VALUES ($1, lower($2), $3)`, [
            id,
            input.email.trim(),
            hash,
          ]);
          return { data: { user: { id } }, error: null as null };
        },
      },
    },
  };
}

export type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;
