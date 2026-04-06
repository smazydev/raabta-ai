import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelBar } from "./charts";

export default async function AnalyticsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId, role } = session;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: convsRaw } = await supabase
    .from("conversations")
    .select("channel")
    .eq("tenant_id", tenantId);
  const convs = dbRows<{ channel: string }>(convsRaw);

  const mix: Record<string, number> = {};
  for (const c of convs) {
    mix[c.channel] = (mix[c.channel] ?? 0) + 1;
  }
  const channelData = Object.entries(mix).map(([channel, count]) => ({
    channel: channel.replace("_", " "),
    count,
  }));

  const { data: complaintsRaw } = await supabase
    .from("complaints")
    .select("category, status, created_at, resolved_at")
    .eq("tenant_id", tenantId);
  const complaints = dbRows<{
    category: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }>(complaintsRaw);

  const byCat: Record<string, number> = {};
  for (const c of complaints) {
    byCat[c.category] = (byCat[c.category] ?? 0) + 1;
  }

  const resolved = complaints.filter((c) => c.status === "resolved" || c.status === "closed").length;
  const totalC = complaints.length;
  const resolutionRate = totalC ? Math.round((resolved / totalC) * 100) : 0;

  let aiMeteredCount = 0;
  const aiTypeCounts: Record<string, number> = {};
  if (role === "admin") {
    const { data: usageRaw } = await supabase
      .from("usage_events")
      .select("event_type")
      .eq("tenant_id", tenantId)
      .gte("created_at", thirtyDaysAgo);
    const usageRows = dbRows<{ event_type: string }>(usageRaw ?? []);
    for (const r of usageRows) {
      if (r.event_type.startsWith("openai.")) {
        aiMeteredCount += 1;
        aiTypeCounts[r.event_type] = (aiTypeCounts[r.event_type] ?? 0) + 1;
      }
    }
  }

  const topAiTypes = Object.entries(aiTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Derived from live Postgres data — suitable for executive reviews.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Complaints logged</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold">{totalC}</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Resolution rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold">{resolutionRate}%</p>
          </CardContent>
        </Card>
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase text-muted-foreground">Conversation volume</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-3xl font-bold">{convs.length}</p>
          </CardContent>
        </Card>
      </div>
      {role === "admin" ? (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">AI usage events (30 days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-mono text-2xl font-bold tabular-nums">{aiMeteredCount}</p>
            <p className="text-xs text-muted-foreground">
              Rows in <code className="rounded bg-secondary px-1">usage_events</code> with{" "}
              <code className="rounded bg-secondary px-1">openai.*</code> types (chat, assist, API routes, etc.).
            </p>
            {topAiTypes.length ? (
              <ul className="space-y-1 text-sm">
                {topAiTypes.map(([t, n]) => (
                  <li key={t} className="flex justify-between gap-2 border-b border-border/60 py-1 last:border-0">
                    <code className="truncate text-xs">{t}</code>
                    <span className="shrink-0 font-mono font-semibold">{n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No OpenAI-metered events in this window yet.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Channel mix</CardTitle>
        </CardHeader>
        <CardContent>
          <ChannelBar data={channelData.length ? channelData : [{ channel: "none", count: 0 }]} />
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Issue categories</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {Object.entries(byCat).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span>{k}</span>
              <span className="font-mono font-bold">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
