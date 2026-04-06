import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureTenantBillingRow, getTenantBillingWallet } from "@/lib/billing/credits";
import { ApiKeysPanel, type ApiKeyRow } from "./api-keys-panel";
import { BillingPanel } from "./billing-panel";
import { SettingsTenantForm } from "./settings-tenant-form";

export default async function SettingsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;

  const { data: settings } = await supabase.from("settings").select("*").eq("tenant_id", tenantId).single();

  const ppRaw = (settings?.provider_profile as Record<string, unknown> | null | undefined) ?? {};
  const pp = ppRaw as Record<string, string>;
  const liveSecretRaw = ppRaw.live_events_webhook_secret;
  const liveWebhookSecretStored =
    typeof liveSecretRaw === "string" && liveSecretRaw.trim().length > 0;
  const appName = typeof settings?.app_name === "string" ? settings.app_name : "Raabta AI";
  const escalationThreshold =
    typeof settings?.escalation_threshold === "number" ? settings.escalation_threshold : 3;
  const romanUrduSupport =
    typeof settings?.roman_urdu_support === "boolean" ? settings.roman_urdu_support : true;

  const aiToggles = (settings?.ai_toggles as Record<string, unknown> | null) ?? {};
  const aiAutoReply = aiToggles.auto_reply !== false;
  const aiSummaries = aiToggles.summaries !== false;
  const aiAssistantCopilot = aiToggles.assistant_copilot !== false;
  const aiEmbeddings = aiToggles.embeddings_enabled !== false;
  const aiTts = aiToggles.tts_enabled !== false;

  const telephonyRaw = (settings?.telephony as Record<string, unknown> | null | undefined) ?? {};
  const twilioInbound =
    typeof telephonyRaw.twilio_inbound_e164 === "string" ? telephonyRaw.twilio_inbound_e164 : "";
  const twilioEscalation =
    typeof telephonyRaw.twilio_escalation_e164 === "string" ? telephonyRaw.twilio_escalation_e164 : "";

  const { data: apiKeys } =
    role === "admin"
      ? await supabase
          .from("tenant_api_keys")
          .select("id, name, key_prefix, scopes, created_at, revoked_at, last_used_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
      : { data: null };

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { count: usageWeek } =
    role === "admin"
      ? await supabase
          .from("usage_events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("created_at", weekAgo)
      : { count: null };

  let billingWallet = null;
  if (role === "admin") {
    try {
      await ensureTenantBillingRow(tenantId);
      billingWallet = await getTenantBillingWallet(tenantId);
    } catch {
      billingWallet = null;
    }
  }

  const isAdmin = role === "admin";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Tenant governance: product identity, escalation policy, provider attestations, API credentials, and usage
          metering. Changes apply per tenant via row-level security in PostgreSQL.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Local / sandbox refresh: <code className="rounded bg-secondary/50 px-1">npm run db:seed</code> after migrations.
        </p>
      </div>
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Tenant</CardTitle>
          <CardDescription>AI behavior, telephony mapping, and escalation defaults</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsTenantForm
            isAdmin={isAdmin}
            appName={appName}
            escalationThreshold={escalationThreshold}
            romanUrduSupport={romanUrduSupport}
            aiAutoReply={aiAutoReply}
            aiSummaries={aiSummaries}
            aiAssistantCopilot={aiAssistantCopilot}
            aiEmbeddings={aiEmbeddings}
            aiTts={aiTts}
            twilioInbound={twilioInbound}
            twilioEscalation={twilioEscalation}
            providerProfile={pp}
            liveWebhookSecretStored={liveWebhookSecretStored}
          />
        </CardContent>
      </Card>

      {role === "admin" && (
        <>
          <BillingPanel wallet={billingWallet} />
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-base">Usage (7 days)</CardTitle>
              <CardDescription>Metered platform events (API v1, assistant turns, workflow runs).</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-2xl font-bold tabular-nums">{usageWeek ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Rows in usage_events · pull aggregates via GET /api/v1/metrics/usage
              </p>
            </CardContent>
          </Card>
          <ApiKeysPanel keys={dbRows<ApiKeyRow>(apiKeys)} />
        </>
      )}
    </div>
  );
}
