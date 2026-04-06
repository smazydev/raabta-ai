import { notFound } from "next/navigation";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { AgentDetailShell } from "../_components/agent-detail-shell";
import type { AgentFieldDefaults } from "../_components/agent-fields";

type PageProps = { params: Promise<{ id: string }> };

export default async function AgentDetailPage({ params }: PageProps) {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { id } = await params;
  const { supabase, tenantId } = session;

  const { data: agentRaw } = await supabase
    .from("ai_agents")
    .select(
      "id, name, slug, kind, description, instructions, workflow_id, status, department, response_style, escalation_target_team, citations_required, human_handoff_enabled, agent_assist_enabled, model_placeholder, created_by, updated_by, published_at, created_at, updated_at"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!agentRaw) notFound();

  const agent = agentRaw as {
    id: string;
    name: string;
    slug: string;
    kind: string;
    description: string | null;
    instructions: string;
    workflow_id: string | null;
    status: string;
    department: string | null;
    response_style: string | null;
    escalation_target_team: string | null;
    citations_required: boolean | null;
    human_handoff_enabled: boolean | null;
    agent_assist_enabled: boolean | null;
    model_placeholder: string | null;
    created_by: string | null;
    updated_by: string | null;
    published_at: string | null;
    created_at: string;
    updated_at: string;
  };

  const [
    { data: wfRaw },
    { data: artRaw },
    { data: kaRaw },
    { data: waRaw },
    { data: akbRaw },
    { data: kbListRaw },
    { count: convCount },
  ] = await Promise.all([
    supabase.from("workflows").select("id, name").eq("tenant_id", tenantId).order("name", { ascending: true }),
    supabase.from("knowledge_articles").select("id, title").eq("tenant_id", tenantId).order("title", { ascending: true }),
    supabase.from("ai_agent_knowledge_articles").select("article_id").eq("agent_id", id).eq("tenant_id", tenantId),
    supabase.from("ai_agent_workflow_allowlist").select("workflow_id").eq("agent_id", id).eq("tenant_id", tenantId),
    supabase.from("ai_agent_knowledge_bases").select("knowledge_base_id").eq("agent_id", id).eq("tenant_id", tenantId),
    supabase.from("knowledge_bases").select("id, name").eq("tenant_id", tenantId).order("name", { ascending: true }),
    supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("agent_id", id),
  ]);

  const workflows = dbRows<{ id: string; name: string }>(wfRaw);
  const articles = dbRows<{ id: string; title: string }>(artRaw);
  const kaIds = dbRows<{ article_id: string }>(kaRaw).map((r) => r.article_id);
  const akbIds = dbRows<{ knowledge_base_id: string }>(akbRaw).map((r) => r.knowledge_base_id);
  const knowledgeBases = dbRows<{ id: string; name: string }>(kbListRaw);
  const waIds = dbRows<{ workflow_id: string }>(waRaw).map((r) => r.workflow_id);

  const { data: recentRaw } = await supabase
    .from("conversations")
    .select("id, channel, summary, last_message_at")
    .eq("tenant_id", tenantId)
    .eq("agent_id", id)
    .order("last_message_at", { ascending: false })
    .limit(8);
  const recentConversations = dbRows<{
    id: string;
    channel: string;
    summary: string | null;
    last_message_at: string;
  }>(recentRaw);

  const articleById = new Map(articles.map((a) => [a.id, a]));
  const wfById = new Map(workflows.map((w) => [w.id, w]));
  const linkedArticles = kaIds.map((kid) => articleById.get(kid)).filter(Boolean) as { id: string; title: string }[];
  const linkedWorkflows = waIds.map((wid) => wfById.get(wid)).filter(Boolean) as { id: string; name: string }[];

  const profileIds = [...new Set([agent.created_by, agent.updated_by].filter(Boolean) as string[])];
  let createdByLabel: string | null = null;
  let updatedByLabel: string | null = null;
  if (profileIds.length) {
    const { data: profRaw } = await supabase.from("profiles").select("id, display_name").in("id", profileIds);
    const profs = dbRows<{ id: string; display_name: string | null }>(profRaw);
    const pmap = new Map(profs.map((p) => [p.id, p.display_name?.trim() || p.id.slice(0, 8)]));
    createdByLabel = agent.created_by ? pmap.get(agent.created_by) ?? null : null;
    updatedByLabel = agent.updated_by ? pmap.get(agent.updated_by) ?? null : null;
  }

  const defaults: AgentFieldDefaults = {
    name: agent.name,
    slug: agent.slug,
    kind: agent.kind,
    status: agent.status ?? "draft",
    department: agent.department ?? "",
    description: agent.description ?? "",
    instructions: agent.instructions,
    response_style: agent.response_style ?? "",
    escalation_target_team: agent.escalation_target_team ?? "",
    model_placeholder: agent.model_placeholder ?? "",
    citations_required: Boolean(agent.citations_required),
    human_handoff_enabled: agent.human_handoff_enabled !== false,
    agent_assist_enabled: Boolean(agent.agent_assist_enabled),
    workflow_id: agent.workflow_id ?? "",
    selectedArticleIds: kaIds,
    selectedKnowledgeBaseIds: akbIds,
    selectedWorkflowIds: waIds.length ? waIds : agent.workflow_id ? [agent.workflow_id] : [],
  };

  return (
    <div className="mx-auto max-w-5xl">
      <AgentDetailShell
        agentMeta={{
          id: agent.id,
          name: agent.name,
          slug: agent.slug,
          kind: agent.kind,
          status: agent.status ?? "draft",
          department: agent.department,
          created_at: agent.created_at,
          updated_at: agent.updated_at,
          published_at: agent.published_at,
        }}
        defaults={defaults}
        workflows={workflows}
        articles={articles}
        knowledgeBases={knowledgeBases}
        linkedArticles={linkedArticles}
        linkedWorkflows={linkedWorkflows}
        recentConversations={recentConversations}
        convCount={convCount ?? 0}
        createdByLabel={createdByLabel}
        updatedByLabel={updatedByLabel}
      />
    </div>
  );
}
