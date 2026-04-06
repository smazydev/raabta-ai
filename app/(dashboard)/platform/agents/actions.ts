"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionTenant } from "@/lib/session";

function slugify(s: string) {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "agent"
  );
}

type Kind = "chat" | "voice" | "both";
type Status = "draft" | "live" | "archived";
type Dept = "HR" | "IT" | "Operations" | "Compliance" | "Support";

function parseKind(v: string): Kind {
  if (v === "voice" || v === "both") return v;
  return "chat";
}

function parseStatus(v: string): Status {
  if (v === "live" || v === "archived") return v;
  return "draft";
}

function parseDept(v: string): Dept | null {
  const t = v.trim();
  if (t === "HR" || t === "IT" || t === "Operations" || t === "Compliance" || t === "Support") return t;
  return null;
}

function idsFromForm(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((x) => String(x).trim())
    .filter(Boolean);
}

async function requireAgentTenant() {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  return {
    supabase: session.supabase,
    tenantId: session.tenantId,
    userId: session.user.id,
  };
}

async function syncKnowledgeBaseLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agentId: string,
  knowledgeBaseIds: string[]
) {
  const cleared = await supabase
    .from("ai_agent_knowledge_bases")
    .delete()
    .eq("agent_id", agentId)
    .eq("tenant_id", tenantId);
  if (cleared.error) throw new Error(cleared.error.message || "Failed to clear knowledge base links");
  if (!knowledgeBaseIds.length) return;
  const { error } = await supabase.from("ai_agent_knowledge_bases").insert(
    knowledgeBaseIds.map((knowledge_base_id) => ({
      tenant_id: tenantId,
      agent_id: agentId,
      knowledge_base_id,
    }))
  );
  if (error) throw new Error(error.message || "Failed to link knowledge bases");
}

async function syncKnowledgeLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agentId: string,
  articleIds: string[]
) {
  const cleared = await supabase
    .from("ai_agent_knowledge_articles")
    .delete()
    .eq("agent_id", agentId)
    .eq("tenant_id", tenantId);
  if (cleared.error) throw new Error(cleared.error.message || "Failed to clear knowledge links");
  if (!articleIds.length) return;
  const { error } = await supabase.from("ai_agent_knowledge_articles").insert(
    articleIds.map((article_id) => ({
      tenant_id: tenantId,
      agent_id: agentId,
      article_id,
    }))
  );
  if (error) throw new Error(error.message || "Failed to link knowledge");
}

async function syncWorkflowAllowlist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  agentId: string,
  workflowIds: string[]
) {
  const cleared = await supabase
    .from("ai_agent_workflow_allowlist")
    .delete()
    .eq("agent_id", agentId)
    .eq("tenant_id", tenantId);
  if (cleared.error) throw new Error(cleared.error.message || "Failed to clear workflow allowlist");
  if (!workflowIds.length) return;
  const { error } = await supabase.from("ai_agent_workflow_allowlist").insert(
    workflowIds.map((workflow_id) => ({
      tenant_id: tenantId,
      agent_id: agentId,
      workflow_id,
    }))
  );
  if (error) throw new Error(error.message || "Failed to link workflows");
}

function readCommonFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  let slug = String(formData.get("slug") ?? "").trim();
  if (!slug) slug = slugify(name);
  else slug = slugify(slug);
  const kind = parseKind(String(formData.get("kind") ?? "chat"));
  const description = String(formData.get("description") ?? "").trim() || null;
  const instructions = String(formData.get("instructions") ?? "").trim();
  const status = parseStatus(String(formData.get("status") ?? "draft"));
  const department = parseDept(String(formData.get("department") ?? ""));
  const response_style = String(formData.get("response_style") ?? "").trim() || null;
  const escalation_target_team = String(formData.get("escalation_target_team") ?? "").trim() || null;
  const citations_required = formData.get("citations_required") === "on";
  const human_handoff_enabled = formData.has("human_handoff_enabled")
    ? formData.get("human_handoff_enabled") === "on"
    : true;
  const agent_assist_enabled = formData.get("agent_assist_enabled") === "on";
  const model_placeholder = String(formData.get("model_placeholder") ?? "").trim() || null;
  const articleIds = [...new Set(idsFromForm(formData, "article_ids"))];
  const knowledgeBaseIds = [...new Set(idsFromForm(formData, "knowledge_base_ids"))];
  const workflowIds = [...new Set(idsFromForm(formData, "workflow_ids"))];
  const primaryWorkflow = String(formData.get("workflow_id") ?? "").trim();
  const workflow_id = primaryWorkflow.length > 0 ? primaryWorkflow : workflowIds[0] ?? null;
  return {
    name,
    slug,
    kind,
    description,
    instructions,
    status,
    department,
    response_style,
    escalation_target_team,
    citations_required,
    human_handoff_enabled,
    agent_assist_enabled,
    model_placeholder,
    articleIds,
    knowledgeBaseIds,
    workflowIds: workflowIds.length ? workflowIds : workflow_id ? [workflow_id] : [],
    workflow_id,
  };
}

export async function createAgentAction(formData: FormData) {
  const { supabase, tenantId, userId } = await requireAgentTenant();
  const f = readCommonFields(formData);
  if (!f.name) throw new Error("Name is required");

  const now = new Date().toISOString();
  const published_at =
    f.status === "live" ? now : null;

  const { data: inserted, error } = await supabase
    .from("ai_agents")
    .insert({
      tenant_id: tenantId,
      name: f.name,
      slug: f.slug,
      kind: f.kind,
      description: f.description,
      instructions: f.instructions,
      workflow_id: f.workflow_id,
      status: f.status,
      department: f.department,
      response_style: f.response_style,
      escalation_target_team: f.escalation_target_team,
      citations_required: f.citations_required,
      human_handoff_enabled: f.human_handoff_enabled,
      agent_assist_enabled: f.agent_assist_enabled,
      model_placeholder: f.model_placeholder,
      created_by: userId,
      updated_by: userId,
      published_at,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message || "Failed to create agent");
  const id = inserted!.id as string;

  await syncKnowledgeLinks(supabase, tenantId, id, f.articleIds);
  await syncKnowledgeBaseLinks(supabase, tenantId, id, f.knowledgeBaseIds);
  await syncWorkflowAllowlist(supabase, tenantId, id, f.workflowIds);

  revalidatePath("/platform/agents");
  revalidatePath(`/platform/agents/${id}`);
  redirect(`/platform/agents/${id}`);
}

export async function updateAgentAction(formData: FormData) {
  const { supabase, tenantId, userId } = await requireAgentTenant();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Missing id");
  const f = readCommonFields(formData);
  if (!f.name) throw new Error("Name is required");

  const { data: prev } = await supabase
    .from("ai_agents")
    .select("published_at, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const prevRow = prev as { published_at: string | null; status: string } | null;
  let published_at = prevRow?.published_at ?? null;
  if (f.status === "live" && !published_at) {
    published_at = new Date().toISOString();
  }
  if (f.status !== "live") {
    published_at = prevRow?.published_at ?? null;
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("ai_agents")
    .update({
      name: f.name,
      slug: f.slug,
      kind: f.kind,
      description: f.description,
      instructions: f.instructions,
      workflow_id: f.workflow_id,
      status: f.status,
      department: f.department,
      response_style: f.response_style,
      escalation_target_team: f.escalation_target_team,
      citations_required: f.citations_required,
      human_handoff_enabled: f.human_handoff_enabled,
      agent_assist_enabled: f.agent_assist_enabled,
      model_placeholder: f.model_placeholder,
      updated_by: userId,
      published_at,
      updated_at: now,
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message || "Failed to update agent");

  await syncKnowledgeLinks(supabase, tenantId, id, f.articleIds);
  await syncKnowledgeBaseLinks(supabase, tenantId, id, f.knowledgeBaseIds);
  await syncWorkflowAllowlist(supabase, tenantId, id, f.workflowIds);

  revalidatePath("/platform/agents");
  revalidatePath(`/platform/agents/${id}`);
  redirect(`/platform/agents/${id}`);
}

export async function deleteAgentAction(formData: FormData) {
  const { supabase, tenantId } = await requireAgentTenant();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("Missing id");
  const { error } = await supabase.from("ai_agents").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message || "Failed to delete agent");
  revalidatePath("/platform/agents");
  redirect("/platform/agents");
}
