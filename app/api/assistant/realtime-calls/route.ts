import { NextResponse } from "next/server";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { createClient } from "@/lib/supabase/server";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { buildAssistantSystemPrompt } from "@/lib/assistant/system-prompt";
import { assistantToolsForRealtimeSession } from "@/lib/assistant/realtime-tools";
import {
  voiceRealtimeLanguageInstructions,
  voiceRealtimeToolsInstructions,
} from "@/lib/assistant/voice-realtime-instructions";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * WebRTC SDP answer proxy: browser posts an SDP offer; we attach session config and forward to OpenAI Realtime.
 * Query: aiAgentId (optional UUID) — governed agent; must be `voice` or `both` when set. Omitted = workspace assistant.
 */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/sdp") && !ct.includes("text/plain")) {
    return NextResponse.json({ error: "Content-Type must be application/sdp" }, { status: 400 });
  }

  const url = new URL(req.url);
  const rawAgent = url.searchParams.get("aiAgentId")?.trim() ?? "";

  const sdpOffer = await req.text();
  if (!sdpOffer.trim()) {
    return NextResponse.json({ error: "Empty SDP offer" }, { status: 400 });
  }

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });
  }

  let effectiveAgentId: string | null = null;
  if (rawAgent) {
    if (!UUID_RE.test(rawAgent)) {
      return NextResponse.json({ error: "Invalid aiAgentId" }, { status: 400 });
    }
    effectiveAgentId = rawAgent;
    const { data: ag } = await supabase
      .from("ai_agents")
      .select("id, status, kind")
      .eq("tenant_id", tenantId)
      .eq("id", effectiveAgentId)
      .maybeSingle();
    if (!ag) {
      return NextResponse.json({ error: "Unknown agent for this workspace" }, { status: 400 });
    }
    if (ag.status === "archived") {
      return NextResponse.json({ error: "That agent is archived" }, { status: 400 });
    }
    const k = typeof ag.kind === "string" ? ag.kind : "chat";
    if (k !== "voice" && k !== "both") {
      return NextResponse.json(
        {
          error:
            "This agent is chat-only. Create or select an agent with Channel coverage “Voice” or “Chat & voice” in Agent studio to use the microphone.",
        },
        { status: 400 }
      );
    }
  }

  let agentBrief: { name: string; description: string | null; instructions: string } | null = null;
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
  }

  const systemPrompt = buildAssistantSystemPrompt(agentBrief);
  const instructions = [
    systemPrompt,
    voiceRealtimeLanguageInstructions(),
    voiceRealtimeToolsInstructions(),
  ].join("\n\n");

  const model =
    process.env.OPENAI_ASSISTANT_REALTIME_MODEL?.trim() ||
    process.env.OPENAI_REALTIME_MODEL?.trim() ||
    "gpt-4o-mini-realtime-preview";
  /** `verse` is widely supported; newer names like `marin` can 500 on some model/API combos — override via env. */
  const voice = process.env.OPENAI_REALTIME_VOICE?.trim() || "verse";

  const includeTools = process.env.OPENAI_REALTIME_ASSISTANT_TOOLS?.trim() !== "false";

  const transcriptionModel =
    process.env.OPENAI_REALTIME_INPUT_TRANSCRIPTION_MODEL?.trim() || "whisper-1";

  const sessionPayload: Record<string, unknown> = {
    type: "realtime",
    model,
    instructions,
    audio: {
      output: { voice },
      /** WebRTC `/v1/realtime/calls` expects this under `audio.input`, not top-level `input_audio_transcription`. */
      input: {
        transcription: {
          model: transcriptionModel,
        },
      },
    },
  };
  if (includeTools) {
    sessionPayload.tools = assistantToolsForRealtimeSession();
    sessionPayload.tool_choice = "auto";
  }

  const sessionConfig = JSON.stringify(sessionPayload);

  const fd = new FormData();
  fd.set("sdp", sdpOffer);
  fd.set("session", sessionConfig);

  try {
    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: fd,
    });

    const answerBody = await r.text();
    if (!r.ok) {
      console.error(
        "[assistant realtime-calls] OpenAI error",
        r.status,
        answerBody.slice(0, 2000)
      );
      try {
        const j = JSON.parse(answerBody) as { error?: { message?: string } };
        return NextResponse.json(
          { error: j?.error?.message ?? "OpenAI Realtime call failed" },
          { status: r.status >= 400 && r.status < 600 ? r.status : 500 }
        );
      } catch {
        return NextResponse.json(
          {
            error:
              answerBody?.trim() ||
              `OpenAI Realtime call failed (HTTP ${r.status}, non-JSON body)`,
          },
          { status: 500 }
        );
      }
    }

    return new NextResponse(answerBody, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Realtime call failed" },
      { status: 500 }
    );
  }
}
