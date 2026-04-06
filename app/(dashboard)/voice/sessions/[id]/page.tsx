import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookOpen, GitBranch, MessageSquare, Shield } from "lucide-react";

type PageProps = { params: Promise<{ id: string }> };

export default async function VoiceSessionDetailPage({ params }: PageProps) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();
  if (!VOICE_CALLING_ENABLED) redirect("/voice");

  const { id } = await params;
  const { supabase, tenantId } = session;

  const { data: sess } = await supabase
    .from("voice_frontdesk_sessions")
    .select(
      "id, status, detected_intent, urgency, caller_name, caller_phone, preferred_language, outcome, transfer_reason, summary, structured_summary, disposition, tool_calls, handoff_state, retrieved_knowledge, ai_agent_id, created_at, ended_at"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!sess) notFound();

  const row = sess as Record<string, unknown>;

  const { data: turnsRaw } = await supabase
    .from("voice_frontdesk_turns")
    .select("id, actor, language, text, confidence, created_at")
    .eq("session_id", id)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  const turns = dbRows<{
    id: string;
    actor: string;
    language: string | null;
    text: string;
    confidence: string | null;
    created_at: string;
  }>(turnsRaw);

  let agentName: string | null = null;
  const aid = row.ai_agent_id as string | null;
  if (aid) {
    const { data: ag } = await supabase.from("ai_agents").select("name").eq("id", aid).maybeSingle();
    agentName = (ag as { name?: string } | null)?.name ?? null;
  }

  const rk = row.retrieved_knowledge;
  const knowledgeList = Array.isArray(rk) ? (rk as { title?: string; confidence?: string }[]) : [];

  const tools = row.tool_calls;
  const toolList = Array.isArray(tools) ? (tools as { name?: string; status?: string }[]) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/voice/sessions" className="text-primary hover:underline">
            ← Voice sessions
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-black tracking-tight">Session detail</h1>
          <Badge variant="outline" className="text-[10px] uppercase">
            {String(row.status ?? "—")}
          </Badge>
          {row.outcome ? (
            <Badge variant="secondary" className="text-[10px] uppercase">
              {String(row.outcome).replace(/_/g, " ")}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm">Classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Intent</span>
              <br />
              <span className="font-medium">{String(row.detected_intent ?? "—")}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Urgency</span>
              <br />
              <span className="font-medium">{String(row.urgency ?? "—")}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Language</span>
              <br />
              <span className="font-medium">{String(row.preferred_language ?? "—")}</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-primary" />
              Handoff &amp; disposition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Handoff state</span>
              <br />
              <span className="font-medium">{String(row.handoff_state ?? "—")}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Transfer reason</span>
              <br />
              <span className="font-medium">{String(row.transfer_reason ?? "—")}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Caller: {String(row.caller_name ?? "").trim() || "Unknown"}{" "}
              {row.caller_phone ? `· ${String(row.caller_phone)}` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" />
            Transcript
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {turns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No turns stored for this session.</p>
          ) : (
            turns.map((t) => (
              <div key={t.id} className="rounded-lg border border-border/60 bg-secondary/15 px-3 py-2 text-sm">
                <p className="text-[10px] font-bold uppercase text-primary">{t.actor}</p>
                <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
                {t.confidence ? (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">Confidence {t.confidence}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4 text-primary" />
              Retrieved knowledge
            </CardTitle>
            <CardDescription>Governed sources surfaced during the call (demo payload).</CardDescription>
          </CardHeader>
          <CardContent>
            {knowledgeList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No retrieval payload on this session.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {knowledgeList.map((k, i) => (
                  <li key={i} className="rounded-md border border-border/50 px-2 py-1.5">
                    <span className="font-medium">{k.title ?? "Article"}</span>
                    {k.confidence ? (
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{k.confidence}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-primary" />
              Workflow actions
            </CardTitle>
            <CardDescription>Tool / workflow signals recorded on the session.</CardDescription>
          </CardHeader>
          <CardContent>
            {toolList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tool calls logged.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {toolList.map((t, i) => (
                  <li key={i} className="font-mono text-xs">
                    {t.name ?? "tool"} {t.status ? `— ${t.status}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm">Summaries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-bold uppercase text-muted-foreground">Narrative summary</p>
            <p className="mt-1">{String(row.summary ?? "—")}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-muted-foreground">Structured handoff</p>
            <p className="mt-1 whitespace-pre-wrap font-mono text-xs">
              {String(row.structured_summary ?? "—")}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-muted-foreground">Voice-capable agent</p>
            <p className="mt-1">{agentName ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Link href="/voice/sessions" className={cn(buttonVariants({ variant: "ghost" }), "no-underline")}>
        Back to sessions
      </Link>
    </div>
  );
}
