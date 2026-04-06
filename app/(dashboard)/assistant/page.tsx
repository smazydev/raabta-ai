import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenant } from "@/lib/session";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { dbRows } from "@/lib/db/rows";
import { AssistantClient } from "./assistant-client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchParams = Promise<{ session?: string; new?: string; agent?: string }>;

export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const sp = await searchParams;
  const ai = await getTenantAiSettings(session.supabase, session.tenantId);
  const { supabase, tenantId, user } = session;

  const { data: sessionsRaw } = await supabase
    .from("assistant_sessions")
    .select("id, title, updated_at, ai_agent_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(60);

  const sessions = dbRows<{ id: string; title: string | null; updated_at: string; ai_agent_id: string | null }>(
    sessionsRaw
  );

  const { data: agentsRaw } = await supabase
    .from("ai_agents")
    .select("id, name, status, kind")
    .eq("tenant_id", tenantId)
    .in("status", ["draft", "live"])
    .order("name", { ascending: true });

  const agents = dbRows<{ id: string; name: string; status: string; kind: string }>(agentsRaw);

  const forceNew = sp.new === "1" || sp.new === "true";
  const paramSession = sp.session?.trim() ?? "";

  let activeSessionId: string | null = null;
  if (forceNew) {
    activeSessionId = null;
  } else if (UUID_RE.test(paramSession) && sessions.some((s) => s.id === paramSession)) {
    activeSessionId = paramSession;
  } else if (sessions.length > 0) {
    activeSessionId = sessions[0]!.id;
  }

  const paramAgent = sp.agent?.trim() ?? "";
  let initialAiAgentId: string | null = null;
  if (activeSessionId && !forceNew) {
    initialAiAgentId = sessions.find((s) => s.id === activeSessionId)?.ai_agent_id ?? null;
  } else if (forceNew && UUID_RE.test(paramAgent) && agents.some((a) => a.id === paramAgent)) {
    initialAiAgentId = paramAgent;
  }

  type MsgRow = {
    id: string;
    role: string;
    content: string | null;
    artifact_markdown: string | null;
  };

  const initialLines: {
    id: string;
    role: "user" | "assistant";
    content: string;
    artifact?: string | null;
  }[] = [];

  let initialArtifact: string | null = null;

  if (activeSessionId) {
    const { data: msgRaw } = await supabase
      .from("assistant_messages")
      .select("id, role, content, artifact_markdown")
      .eq("session_id", activeSessionId)
      .order("created_at", { ascending: true });

    const msgs = dbRows<MsgRow>(msgRaw);
    for (const m of msgs) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const line = {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
        artifact: m.artifact_markdown ?? null,
      };
      initialLines.push(line);
      if (m.role === "assistant" && m.artifact_markdown) {
        initialArtifact = m.artifact_markdown;
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tool-grounded chat: RAG over your knowledge base, operations metrics, hiring records, surveys, and course
          MCQs.
        </p>
      </div>
      <AssistantClient
        key={
          forceNew
            ? `new-${initialAiAgentId ?? "workspace"}`
            : (activeSessionId ?? "empty")
        }
        openAiConfigured={isOpenAiConfigured()}
        assistantCopilotEnabled={ai.assistantCopilot}
        sessions={sessions}
        agents={agents}
        initialSessionId={activeSessionId}
        initialAiAgentId={initialAiAgentId}
        initialLines={initialLines}
        initialArtifact={initialArtifact}
        forceNewChat={forceNew}
      />
    </div>
  );
}
