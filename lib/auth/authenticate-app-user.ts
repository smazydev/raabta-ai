import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db/pool";

export async function authenticateAppUser(
  email: string,
  password: string
): Promise<{ ok: true; userId: string; email: string } | { ok: false; message: string }> {
  const pool = getPool();
  const r = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM app_users WHERE lower(email) = lower($1) LIMIT 1`,
    [email.trim()]
  );
  if (r.rowCount === 0) {
    return { ok: false, message: "Invalid login credentials" };
  }
  const row = r.rows[0]!;
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    return { ok: false, message: "Invalid login credentials" };
  }
  return { ok: true, userId: row.id, email: email.trim() };
}
