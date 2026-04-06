import { AppShell } from "@/components/dashboard/app-shell";
import { AgentStaffRouteRedirect } from "@/components/dashboard/agent-staff-route-redirect";
import { DashboardAiStrip } from "@/components/dashboard/dashboard-ai-strip";
import { Toaster } from "@/components/ui/sonner";
import { getDeploymentLabel, shouldShowDemoNav } from "@/lib/dashboard-nav";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return await redirectUnauthenticatedToLogin();
  }

  const profile = await loadAppProfileByUserId(user.id);

  let displayName = user.email ?? "User";
  let roleLabel = "Agent";
  let tenantName = "Organization";
  let workspaceName = "Raabta AI";
  const isAdmin = profile?.role === "admin";

  if (typeof profile?.display_name === "string" && profile.display_name) displayName = profile.display_name;
  if (typeof profile?.role === "string")
    roleLabel = profile.role === "admin" ? "Admin / Ops" : "Agent";

  const tenantId = profile?.tenant_id as string | undefined;
  if (tenantId) {
    const [{ data: tenantRow }, { data: settingsRow }] = await Promise.all([
      supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
      supabase.from("settings").select("app_name").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    if (typeof tenantRow?.name === "string" && tenantRow.name.trim()) tenantName = tenantRow.name.trim();
    if (typeof settingsRow?.app_name === "string" && settingsRow.app_name.trim())
      workspaceName = settingsRow.app_name.trim();
  }

  return (
    <>
      <AgentStaffRouteRedirect
        isAgentStaff={Boolean(profile?.tenant_id) && profile?.role !== "admin"}
      />
      <AppShell
        displayName={displayName}
        role={roleLabel}
        signOut={signOutAction}
        workspaceName={workspaceName}
        tenantName={tenantName}
        isAdmin={Boolean(isAdmin)}
        showDemoNav={shouldShowDemoNav() && Boolean(isAdmin)}
        deploymentLabel={getDeploymentLabel()}
      >
        <>
          {tenantId ? <DashboardAiStrip /> : null}
          {children}
        </>
      </AppShell>
      <Toaster position="bottom-right" />
    </>
  );
}
