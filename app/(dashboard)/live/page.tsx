import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { LiveFeed } from "./live-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LivePage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;

  const [{ count: activeConv }, { count: activeCalls }, { count: queue }] = await Promise.all([
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["active", "pending"]),
    supabase
      .from("calls")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["active", "pending", "escalated"]),
    supabase
      .from("complaints")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "escalated"),
  ]);

  const { data: eventsRaw } = await supabase
    .from("live_events")
    .select("id, event_type, payload, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(40);
  const events = dbRows<{ id: string; event_type: string; payload: Record<string, unknown>; created_at: string }>(
    eventsRaw
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Live monitor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mission control — <code className="text-xs">live_events</code> refreshes on a short poll. Admins can POST each
          new row to an HTTPS endpoint under{" "}
          <a href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
            Settings → Live events webhook
          </a>
          .
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Active conversations", value: activeConv ?? 0 },
          { label: "Voice / IVR (sim)", value: activeCalls ?? 0 },
          { label: "Escalated queue", value: queue ?? 0 },
        ].map((m) => (
          <Card key={m.label} className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {m.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-3xl font-bold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <LiveFeed
        tenantId={tenantId}
        initial={events}
      />
    </div>
  );
}
