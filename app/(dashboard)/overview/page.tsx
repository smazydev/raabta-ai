import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDeploymentLabel } from "@/lib/dashboard-nav";
import { redirect } from "next/navigation";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import {
  Activity,
  AlertTriangle,
  Bot,
  Cable,
  Headphones,
  MessageSquare,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { DemoWidget } from "./demo-widget";

export default async function OverviewPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  if (session.role !== "admin") {
    redirect("/assistant");
  }

  const { supabase, tenantId } = session;

  const { data: tenantRow } = await supabase.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle();
  const tenantName = (tenantRow as { name?: string; slug?: string } | null)?.name ?? "Tenant";
  const tenantSlug = (tenantRow as { name?: string; slug?: string } | null)?.slug ?? "";

  const [
    { count: convActive },
    { count: complaintsOpen },
    { count: escalated },
    { count: contained },
    { data: recentEventsRaw },
    { data: alertsRaw },
    { data: demoConversationsRaw },
    { data: demoCustomersRaw },
    { data: auditRaw },
    { count: wfSuccess },
    { count: unresolvedConv },
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["active", "pending"]),
    supabase
      .from("complaints")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["new", "in_review", "awaiting_customer", "escalated"]),
    supabase
      .from("complaints")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "escalated"),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("containment_resolved", true),
    supabase
      .from("live_events")
      .select("id, event_type, payload, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("alerts")
      .select("id, title, severity, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("conversations")
      .select("id, channel, summary, intent, customer_id")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false })
      .limit(4),
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", tenantId),
    supabase
      .from("audit_events")
      .select("id, action, resource_type, created_at, actor_label")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("workflow_runs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "success"),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["active", "escalated", "pending"]),
  ]);

  const recentEvents = dbRows<{ id: string; event_type: string; payload: unknown; created_at: string }>(
    recentEventsRaw
  );
  const alerts = dbRows<{ id: string; title: string; severity: string; created_at: string }>(alertsRaw);
  const demoConversations = dbRows<{
    id: string;
    channel: string;
    summary: string | null;
    intent: string | null;
    customer_id: string;
  }>(demoConversationsRaw);
  const demoCustomers = dbRows<{ id: string; full_name: string }>(demoCustomersRaw);
  const auditTail = dbRows<{
    id: string;
    action: string;
    resource_type: string | null;
    created_at: string;
    actor_label: string | null;
  }>(auditRaw);

  const totalConv =
    (await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)).count ?? 0;

  const containmentRate =
    totalConv > 0 ? Math.round(((contained ?? 0) / totalConv) * 100) : 0;
  const escalationRate =
    (complaintsOpen ?? 0) > 0
      ? Math.round(((escalated ?? 0) / (complaintsOpen ?? 1)) * 100)
      : 0;
  const [{ data: settingsRow }, tenantAi] = await Promise.all([
    supabase.from("settings").select("roman_urdu_support").eq("tenant_id", tenantId).single(),
    getTenantAiSettings(supabase, tenantId),
  ]);

  const overviewAiChatEnabled = isOpenAiConfigured() && tenantAi.autoReply;

  const deployment = getDeploymentLabel();
  const publicBase =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const eventIngestRef = publicBase ? `${publicBase}/api/v1/events/ingest` : "POST /api/v1/events/ingest";

  const customerMap = new Map(demoCustomers.map((c) => [c.id, c.full_name]));
  const demoRows = demoConversations.map((c) => ({
    id: c.id,
    summary: c.summary,
    intent: c.intent,
    channel: c.channel,
    customerName: customerMap.get(c.customer_id) ?? null,
  }));

  const automationRate =
    totalConv > 0 ? Math.min(99, Math.round(((wfSuccess ?? 0) / Math.max(totalConv, 1)) * 100)) : 0;

  const kpis = [
    {
      title: "Open threads",
      value: String(unresolvedConv ?? 0),
      hint: "Active, escalated, or pending conversations",
      icon: TrendingUp,
    },
    {
      title: "Workflow automation",
      value: `${automationRate}%`,
      hint: "Successful runs vs conversation volume (directional demo)",
      icon: Workflow,
    },
    {
      title: "Active conversations",
      value: String(convActive ?? 0),
      hint: "Across all text channels",
      icon: MessageSquare,
    },
    {
      title: "Open complaints",
      value: String(complaintsOpen ?? 0),
      hint: "Excluding resolved / closed",
      icon: AlertTriangle,
    },
    {
      title: "AI containment",
      value: `${containmentRate}%`,
      hint: "Resolved without escalation",
      icon: Bot,
    },
    {
      title: "Escalation load",
      value: `${escalationRate}%`,
      hint: "Share of open complaints escalated",
      icon: Headphones,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Control plane overview</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Real-time posture for <span className="font-medium text-foreground">{tenantName}</span>
          {tenantSlug ? (
            <span className="font-mono text-xs text-muted-foreground"> ({tenantSlug})</span>
          ) : null}
          : channel load, governed AI containment, escalations, workflow automation, and audit signals. Wire upstream
          systems through the integration catalog and event ingress below.
        </p>
      </div>

      <Card className="border-border/80 bg-gradient-to-br from-card via-card to-secondary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Cable className="h-4 w-4 text-primary" />
            Platform surface
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Deployment</span>
            <Badge variant="outline" className="font-mono text-[10px] font-semibold uppercase tracking-wider">
              {deployment}
            </Badge>
          </div>
          <div className="min-w-0 flex-1 md:text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Event ingress</p>
            <code className="mt-1 block truncate rounded-md bg-secondary/50 px-2 py-1 font-mono text-xs text-foreground">
              {eventIngestRef}
            </code>
            <p className="mt-1 text-xs text-muted-foreground">Authenticated API keys and scopes are managed in Settings.</p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Link
              href="/integrations"
              className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/80"
            >
              Integration catalog
            </Link>
            <Link
              href="/settings"
              className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/80"
            >
              API keys &amp; metering
            </Link>
            <Link
              href="/live"
              className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Live event stream
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.title} className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{k.title}</CardTitle>
              <k.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-mono font-bold">{k.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Audit trail (sample)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {auditTail.length === 0 ? (
              <p className="text-muted-foreground">No audit events yet — API and console actions log here.</p>
            ) : (
              auditTail.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2"
                >
                  <div>
                    <p className="font-mono text-xs text-primary">{a.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.resource_type ?? "resource"} · {a.actor_label ?? "system"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Live events
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {recentEvents.length === 0 ? (
              <p className="text-muted-foreground">No events yet.</p>
            ) : (
              recentEvents.map((e) => (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2"
                >
                  <div>
                    <p className="font-mono text-xs text-primary">{e.event_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {JSON.stringify(e.payload).slice(0, 120)}
                      {JSON.stringify(e.payload).length > 120 ? "…" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              SLA & alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-primary">P1 queue</p>
              <p className="mt-2 text-2xl font-mono font-bold">{escalated ?? 0}</p>
              <p className="text-xs text-muted-foreground">Escalated complaints awaiting agent assist</p>
            </div>
            {alerts.length === 0 ? (
              <p className="text-muted-foreground">No active alerts.</p>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.severity}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <DemoWidget
        romanUrduSupport={Boolean(settingsRow?.roman_urdu_support)}
        openAiConfigured={isOpenAiConfigured()}
        aiAutoReplyEnabled={tenantAi.autoReply}
        aiChatEnabled={overviewAiChatEnabled}
        aiTtsEnabled={tenantAi.ttsEnabled}
        conversations={demoRows}
      />
    </div>
  );
}
