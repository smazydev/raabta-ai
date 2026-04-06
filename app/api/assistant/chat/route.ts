import { NextResponse } from "next/server";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { createClient } from "@/lib/supabase/server";
import { dbRows } from "@/lib/db/rows";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { resolveOpenAiChatModel } from "@/lib/ai/resolve-model";
import { runAssistantChat } from "@/lib/assistant/run-assistant";
import { runAssistantChatStreamed } from "@/lib/assistant/run-assistant-stream";
import { recordAuditEvent, recordUsageEvent } from "@/lib/platform/telemetry";
import { chargeAfterAggregatedChat, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import { billingErrorResponse } from "@/lib/billing/http";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { resolveAgentKnowledgeArticleFilter } from "@/lib/knowledge/agent-scope";
import { buildAssistantSystemPrompt } from "@/lib/assistant/system-prompt";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const openAiChatModel = await resolveOpenAiChatModel(supabase, tenantId);

    const body = (await req.json()) as {
      message?: string;
      sessionId?: string | null;
      stream?: boolean;
      aiAgentId?: string | null;
    };
    const message = String(body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    if (message.length > 12000) {
      return NextResponse.json({ error: "message too long" }, { status: 400 });
    }

    let sessionId = body.sessionId?.trim() || null;
    const rawAgent = body.aiAgentId;
    if (typeof rawAgent === "string" && rawAgent.trim() && !UUID_RE.test(rawAgent.trim())) {
      return NextResponse.json({ error: "Invalid aiAgentId" }, { status: 400 });
    }

    let existingSession: { id: string; ai_agent_id: string | null } | null = null;
    if (sessionId) {
      const { data: sess } = await supabase
        .from("assistant_sessions")
        .select("id, ai_agent_id")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!sess) {
        sessionId = null;
      } else {
        const s = sess as { id: string; ai_agent_id: string | null };
        existingSession = { id: s.id, ai_agent_id: s.ai_agent_id ?? null };
      }
    }

    let effectiveAgentId: string | null = null;
    if (typeof rawAgent === "string" && rawAgent.trim()) {
      effectiveAgentId = rawAgent.trim();
    } else if (rawAgent === null || rawAgent === "") {
      effectiveAgentId = null;
    } else if (existingSession) {
      effectiveAgentId = existingSession.ai_agent_id;
    }

    if (effectiveAgentId) {
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

    if (!sessionId) {
      const { data: created, error: cErr } = await supabase
        .from("assistant_sessions")
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          title: message.slice(0, 120),
          ai_agent_id: effectiveAgentId,
        })
        .select("id")
        .single();
      if (cErr || !created || typeof created.id !== "string") {
        return NextResponse.json({ error: cErr?.message ?? "Could not create session" }, { status: 500 });
      }
      sessionId = created.id;
      existingSession = { id: created.id, ai_agent_id: effectiveAgentId };
    } else if (
      existingSession &&
      (existingSession.ai_agent_id ?? null) !== (effectiveAgentId ?? null)
    ) {
      await supabase.from("assistant_sessions").update({ ai_agent_id: effectiveAgentId }).eq("id", sessionId);
      existingSession = { ...existingSession, ai_agent_id: effectiveAgentId };
    }

    let agentBrief: { name: string; description: string | null; instructions: string } | null = null;
    let allowedKnowledgeArticleIds: string[] | undefined = undefined;
    if (effectiveAgentId) {
      const { data: fullAg } = await supabase
        .from("ai_agents")
        .select("name, description, instructions")
        .eq("tenant_id", tenantId)
        .eq("id", effectiveAgentId)
        .maybeSingle();
      if (fullAg && typeof fullAg === "object") {
        const row = fullAg as {
          name: unknown;
          description: unknown;
          instructions: unknown;
        };
        agentBrief = {
          name: typeof row.name === "string" ? row.name : "Agent",
          description: typeof row.description === "string" ? row.description : null,
          instructions: typeof row.instructions === "string" ? row.instructions : "",
        };
      }
      allowedKnowledgeArticleIds = await resolveAgentKnowledgeArticleFilter(supabase, tenantId, effectiveAgentId);
    }

    const systemPrompt = buildAssistantSystemPrompt(agentBrief);

    await supabase.from("assistant_messages").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      role: "user",
      content: message,
    });

    const { data: rowsRaw } = await supabase
      .from("assistant_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(60);
    const rows = dbRows<{ role: string; content: unknown }>(rowsRaw);

    const msgs: ChatCompletionMessageParam[] = [];
    for (const row of rows) {
      if (row.role === "user" && typeof row.content === "string" && row.content) {
        msgs.push({ role: "user", content: row.content });
      }
      if (row.role === "assistant" && typeof row.content === "string" && row.content) {
        msgs.push({ role: "assistant", content: row.content });
      }
    }

    await preflightAiCredits(tenantId, minPreflightChatCredits());

    const persistTurn = async (
      reply: string,
      artifactMarkdown: string | undefined,
      chatUsages: TokenUsageSlice[]
    ) => {
      await chargeAfterAggregatedChat(
        tenantId,
        chatUsages,
        "openai.assistant.turn",
        {
          session_id: sessionId,
        },
        openAiChatModel
      );

      await supabase.from("assistant_messages").insert({
        tenant_id: tenantId,
        session_id: sessionId,
        role: "assistant",
        content: reply,
        artifact_markdown: artifactMarkdown ?? null,
      });

      await supabase
        .from("assistant_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId);

      void recordUsageEvent({
        tenantId,
        eventType: "assistant.turn",
        metadata: { session_id: sessionId },
      });
      void recordAuditEvent({
        tenantId,
        source: "ui",
        action: "assistant.turn",
        actorLabel: user.id,
        resourceType: "assistant_session",
        resourceId: sessionId,
        payload: {},
      });
    };

    if (body.stream) {
      const encoder = new TextEncoder();
      const sse = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(sse({ type: "meta", sessionId }));

            const { reply, artifactMarkdown, chatUsages } = await runAssistantChatStreamed({
              supabase,
              tenantId,
              userId: user.id,
              messages: msgs,
              openAiChatModel,
              systemPrompt,
              allowedKnowledgeArticleIds,
              onTextDelta: (text) => {
                controller.enqueue(sse({ type: "delta", text }));
              },
              onToolRoundStart: () => {
                controller.enqueue(sse({ type: "status", message: "Using tools…" }));
              },
            });

            await persistTurn(reply, artifactMarkdown, chatUsages);

            controller.enqueue(
              sse({
                type: "done",
                sessionId,
                reply,
                artifactMarkdown: artifactMarkdown ?? null,
              })
            );
            controller.close();
          } catch (e) {
            const be = billingErrorResponse(e);
            if (be) {
              const j = (await be.json()) as Record<string, unknown>;
              controller.enqueue(
                sse({
                  type: "error",
                  status: be.status,
                  error: String(j.error ?? "Billing error"),
                  code: j.code,
                  balance: j.balance,
                  required: j.required,
                })
              );
            } else {
              const msg = e instanceof Error ? e.message : "Assistant error";
              controller.enqueue(sse({ type: "error", status: 500, error: msg }));
            }
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const { reply, artifactMarkdown, chatUsages } = await runAssistantChat({
      supabase,
      tenantId,
      userId: user.id,
      messages: msgs,
      openAiChatModel,
      systemPrompt,
      allowedKnowledgeArticleIds,
    });

    await persistTurn(reply, artifactMarkdown, chatUsages);

    return NextResponse.json({ sessionId, reply, artifactMarkdown: artifactMarkdown ?? null });
  } catch (e) {
    const be = billingErrorResponse(e);
    if (be) return be;
    const msg = e instanceof Error ? e.message : "Assistant error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
