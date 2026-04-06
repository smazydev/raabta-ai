import Link from "next/link";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatYmdHm } from "@/lib/format-date";
import { Headphones, PhoneForwarded } from "lucide-react";

export default async function VoiceSessionsListPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  if (!VOICE_CALLING_ENABLED) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Voice sessions</h1>
        <p className="text-sm text-muted-foreground">
          Enable voice in <code className="text-xs">lib/features.ts</code> to use this control plane surface.
        </p>
      </div>
    );
  }

  const { supabase, tenantId } = session;

  const { data: sessRaw } = await supabase
    .from("voice_frontdesk_sessions")
    .select(
      "id, status, detected_intent, caller_name, preferred_language, created_at, ended_at, outcome, summary, handoff_state, ai_agent_id"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(60);

  const sessions = dbRows<{
    id: string;
    status: string;
    detected_intent: string | null;
    caller_name: string | null;
    preferred_language: string;
    created_at: string | Date;
    ended_at: string | null;
    outcome: string | null;
    summary: string | null;
    handoff_state: string | null;
    ai_agent_id: string | null;
  }>(sessRaw);

  const agentIds = [...new Set(sessions.map((s) => s.ai_agent_id).filter(Boolean) as string[])];
  let agentMap = new Map<string, string>();
  if (agentIds.length) {
    const { data: agRaw } = await supabase.from("ai_agents").select("id, name").in("id", agentIds);
    agentMap = new Map(dbRows<{ id: string; name: string }>(agRaw).map((a) => [a.id, a.name]));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Voice sessions</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Front-desk and hotline sessions on the same orchestration layer as chat — transcript, intent, retrieval
            preview, handoff, and workflow actions. Not full PSTN; simulator-grade for enterprise demos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/voice" className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}>
            Voice calls simulator
          </Link>
          <Link href="/frontdesk" className={cn(buttonVariants({ variant: "outline" }), "no-underline")}>
            Voice front desk
          </Link>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Headphones className="h-4 w-4 text-primary" />
            Session registry
          </CardTitle>
          <CardDescription>Audit-friendly list with disposition and agent routing signals.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              <PhoneForwarded className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>No voice front desk sessions yet.</p>
              <p className="mt-2 text-xs">Run <code className="rounded bg-secondary px-1">npm run db:seed</code> for demo data or open Voice Front Desk.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/80">
              {sessions.map((s) => (
                <li key={s.id} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/voice/sessions/${s.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {s.caller_name?.trim() || "Unknown"}
                      </Link>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{s.id.slice(0, 8)}…</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Intent: <span className="text-foreground">{s.detected_intent ?? "—"}</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {s.status}
                      </Badge>
                      {s.outcome ? (
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {s.outcome.replace(/_/g, " ")}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>Lang: {s.preferred_language}</span>
                    <span>·</span>
                    <span>{formatYmdHm(s.created_at)}</span>
                    {s.ai_agent_id ? (
                      <>
                        <span>·</span>
                        <span>Agent: {agentMap.get(s.ai_agent_id) ?? s.ai_agent_id.slice(0, 8)}</span>
                      </>
                    ) : null}
                    {s.handoff_state ? (
                      <>
                        <span>·</span>
                        <span>Handoff: {s.handoff_state}</span>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
