import { getPool } from "@/lib/db/pool";

export type AppProfileRow = {
  tenant_id: string;
  role: string;
  display_name: string | null;
};

/**
 * Load `profiles` for an `app_users.id` using SECURITY DEFINER RPC when present, so pool
 * connections are not blocked by RLS policies that only apply to Supabase's `authenticated` role.
 */
export async function loadAppProfileByUserId(userId: string): Promise<AppProfileRow | null> {
  const pool = getPool();
  try {
    const r = await pool.query<AppProfileRow>(
      `SELECT tenant_id, role, display_name FROM public.raabta_profile_for_app_user($1::uuid)`,
      [userId]
    );
    return r.rows[0] ?? null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/raabta_profile_for_app_user|42883|does not exist/i.test(msg)) throw e;
    const r2 = await pool.query<AppProfileRow>(
      `SELECT tenant_id, role, display_name FROM public.profiles WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    return r2.rows[0] ?? null;
  }
}
