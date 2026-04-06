import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { getSessionCookieOptions } from "@/lib/auth/session-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-constants";
import { createClient } from "@/lib/supabase/server";

export type SessionTenant = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string };
  tenantId: string;
  role: string;
  displayName: string | null;
};

type CoreResult =
  | { kind: "ok"; supabase: SessionTenant["supabase"]; user: SessionTenant["user"]; tenantId: string; role: string; displayName: string | null }
  | { kind: "no_user" }
  | { kind: "no_profile" };

async function loadSessionTenantCore(): Promise<CoreResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "no_user" };

  const profile = await loadAppProfileByUserId(user.id);
  if (!profile?.tenant_id) {
    return { kind: "no_profile" };
  }

  return {
    kind: "ok",
    supabase,
    user: { id: user.id, email: user.email ?? "" },
    tenantId: profile.tenant_id,
    role: profile.role ?? "agent",
    displayName: profile.display_name,
  };
}

/** Route Handlers: return 401 JSON instead of redirecting to the login page. */
export async function getSessionTenantForApi(): Promise<SessionTenant | null> {
  const r = await loadSessionTenantCore();
  if (r.kind !== "ok") return null;
  return {
    supabase: r.supabase,
    user: r.user,
    tenantId: r.tenantId,
    role: r.role,
    displayName: r.displayName,
  };
}

/**
 * Server Components / Server Actions: tenant-scoped session, or null if not signed in.
 * If signed in but `profiles` is missing or has no `tenant_id`, redirects to login with a clear error (not a credential failure).
 */
async function clearSessionCookie() {
  const c = await cookies();
  c.set(SESSION_COOKIE_NAME, "", { ...getSessionCookieOptions(), maxAge: 0 });
}

export async function getSessionTenant(): Promise<SessionTenant | null> {
  const r = await loadSessionTenantCore();
  if (r.kind === "no_user") return null;
  if (r.kind === "no_profile") {
    // JWT sub often survives TRUNCATE/re-seed (new app_users UUIDs); drop stale cookie so login issues a fresh token.
    await clearSessionCookie();
    redirect("/login?error=session_invalid");
  }
  return {
    supabase: r.supabase,
    user: r.user,
    tenantId: r.tenantId,
    role: r.role,
    displayName: r.displayName,
  };
}
