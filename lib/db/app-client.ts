import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { getDb, type Db } from "./drizzle";
import { getPool } from "./pool";
import { QueryBuilder } from "./query-builder";
import { runRpc } from "./rpc";
import { signSessionToken, verifySessionToken } from "@/lib/auth/jwt";
import { getSessionCookieOptions } from "@/lib/auth/session-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";

/** When `cookies().get` is empty on some RSC/Server-Action POSTs, the raw header still has the session. */
function readNamedCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader?.trim()) return undefined;
  for (const segment of cookieHeader.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 1) continue;
    const key = segment.slice(0, eq).trim();
    if (key !== name) continue;
    let val = segment.slice(eq + 1).trim();
    try {
      val = decodeURIComponent(val);
    } catch {
      /* keep raw */
    }
    return val || undefined;
  }
  return undefined;
}

/** Per-request client: Postgres + session cookie auth. */
export async function createUserClient() {
  const pool = getPool();

  return {
    from: (table: string) => new QueryBuilder(pool, table),
    /** Drizzle ORM — same pool; use for new typed queries. */
    get db(): Db {
      return getDb();
    },
    rpc: (fn: string, params: Record<string, unknown>) => runRpc(pool, fn, params),
    auth: {
      async getUser() {
        const c = await cookies();
        let token = c.get(SESSION_COOKIE_NAME)?.value;
        if (!token) {
          token = readNamedCookie((await headers()).get("cookie"), SESSION_COOKIE_NAME);
        }
        const payload = await verifySessionToken(token);
        if (!payload?.sub) {
          return { data: { user: null }, error: null };
        }
        return {
          data: {
            user: {
              id: payload.sub,
              email: (payload.email as string) ?? "",
            },
          },
          error: null,
        };
      },

      async signInWithPassword(input: { email: string; password: string }) {
        const r = await pool.query(
          `SELECT id, password_hash FROM app_users WHERE lower(email) = lower($1) LIMIT 1`,
          [input.email.trim()]
        );
        if (r.rowCount === 0) {
          return { error: { message: "Invalid login credentials" } };
        }
        const row = r.rows[0]!;
        const ok = await bcrypt.compare(input.password, row.password_hash as string);
        if (!ok) {
          return { error: { message: "Invalid login credentials" } };
        }
        const token = await signSessionToken(row.id as string, input.email.trim());
        const c = await cookies();
        c.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
        return { error: null as null };
      },

      async signOut() {
        const c = await cookies();
        c.delete(SESSION_COOKIE_NAME);
      },
    },
  };
}

export type UserDbClient = Awaited<ReturnType<typeof createUserClient>>;
