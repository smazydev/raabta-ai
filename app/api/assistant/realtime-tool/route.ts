import { NextResponse } from "next/server";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { createClient } from "@/lib/supabase/server";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { resolveOpenAiChatModel } from "@/lib/ai/resolve-model";
import { resolveAgentKnowledgeArticleFilter } from "@/lib/knowledge/agent-scope";
import { executeAssistantTool, type ToolContext } from "@/lib/assistant/execute-tool";
import { ASSISTANT_TOOL_NAMES } from "@/lib/assistant/realtime-tools";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Executes one assistant tool call from an OpenAI Realtime session (browser forwards `response.done` function_call). */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isOpenAiConfigured()) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
    }

    const profile = await loadAppProfileByUserId(user.id);
    if (!profile?.tenant_id) {
      return NextResponse.json({ error: "No tenant profile" }, { status: 403 });
    }

    const tenantId = profile.tenant_id;
    const tenantAi = await getTenantAiSettings(supabase, tenantId);
    if (!tenantAi.assistantCopilot) {
      return NextResponse.json(
        { error: "AI copilot is disabled for this tenant (Settings → AI automation)." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      aiAgentId?: string | null;
      name?: string;
      arguments?: string;
    };

    const name = String(body.name ?? "").trim();
    if (!name || !ASSISTANT_TOOL_NAMES.has(name)) {
      return NextResponse.json({ error: "Unknown or disallowed tool" }, { status: 400 });
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(String(body.arguments ?? "{}")) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid tool arguments JSON" }, { status: 400 });
    }

    const rawAgent = body.aiAgentId;
    let effectiveAgentId: string | null = null;
    if (typeof rawAgent === "string" && rawAgent.trim()) {
      if (!UUID_RE.test(rawAgent.trim())) {
        return NextResponse.json({ error: "Invalid aiAgentId" }, { status: 400 });
      }
      effectiveAgentId = rawAgent.trim();
      const { data: ag } = await supabase
        .from("ai_agents")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("id", effectiveAgentId)
        .maybeSingle();
      if (!ag) {
        return NextResponse.json({ error: "Unknown agent for this workspace" }, { status: 400 });
      }
      if (ag.status === "archived") {
        return NextResponse.json({ error: "That agent is archived" }, { status: 400 });
      }
    }

    const allowedKnowledgeArticleIds = await resolveAgentKnowledgeArticleFilter(
      supabase,
      tenantId,
      effectiveAgentId
    );
    const openAiChatModel = await resolveOpenAiChatModel(supabase, tenantId);

    const ctx: ToolContext = {
      supabase,
      tenantId,
      userId: user.id,
      openAiChatModel,
      allowedKnowledgeArticleIds,
    };

    const out = await executeAssistantTool(ctx, name, args);

    return NextResponse.json({
      output: out.content,
      artifactMarkdown: out.artifactMarkdown ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Tool error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
