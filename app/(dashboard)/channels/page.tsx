import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ChannelsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;

  const { data: convsRaw } = await supabase
    .from("conversations")
    .select("channel, intent")
    .eq("tenant_id", tenantId);
  const convs = dbRows<{ channel: string; intent: string | null }>(convsRaw);

  const channels = ["web_chat", "app_chat", "voice", "agent_assist"] as const;
  const stats = channels.map((ch) => {
    const subset = convs.filter((c) => c.channel === ch);
    const intents: Record<string, number> = {};
    for (const c of subset) {
      if (c.intent) intents[c.intent] = (intents[c.intent] ?? 0) + 1;
    }
    const top = Object.entries(intents).sort((a, b) => b[1] - a[1])[0];
    return {
      channel: ch,
      volume: subset.length,
      topIntent: top?.[0] ?? "—",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Channels</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Health and intent mix per entry point into the orchestration layer. AI replies and retrieval use the same
          tenant-scoped knowledge and model policy as{" "}
          <a href="/conversations" className="font-medium text-primary hover:underline">
            Conversations
          </a>
          .
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.channel} className="border-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base capitalize">{s.channel.replace("_", " ")}</CardTitle>
              <Badge variant="outline" className="font-mono">
                {s.volume} conv
              </Badge>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p className="text-xs uppercase tracking-widest">Top intent</p>
              <p className="mt-1 font-medium text-foreground">{s.topIntent}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
