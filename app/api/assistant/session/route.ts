import { NextResponse } from "next/server";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { createClient } from "@/lib/supabase/server";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Creates an empty assistant session (e.g. before starting a voice realtime turn)
 * so transcripts can be persisted without sending a text chat message first.
 */
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

    const body = (await req.json()) as { aiAgentId?: string | null };
    const raw = body.aiAgentId;
    let effectiveAgentId: string | null = null;
    if (typeof raw === "string" && raw.trim()) {
      if (!UUID_RE.test(raw.trim())) {
        return NextResponse.json({ error: "Invalid aiAgentId" }, { status: 400 });
      }
      effectiveAgentId = raw.trim();
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

    const { data: created, error: cErr } = await supabase
      .from("assistant_sessions")
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        title: "Voice chat",
        ai_agent_id: effectiveAgentId,
      })
      .select("id")
      .single();

    if (cErr || !created || typeof created.id !== "string") {
      return NextResponse.json({ error: cErr?.message ?? "Could not create session" }, { status: 500 });
    }

    return NextResponse.json({ sessionId: created.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Session error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
