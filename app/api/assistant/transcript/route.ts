import { NextResponse } from "next/server";
import { loadAppProfileByUserId } from "@/lib/auth/load-app-profile";
import { createClient } from "@/lib/supabase/server";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { recordAuditEvent, recordUsageEvent } from "@/lib/platform/telemetry";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Persists a single user or assistant line from the Realtime voice session into assistant_messages. */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      sessionId?: string;
      role?: string;
      text?: string;
    };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const role = body.role === "user" || body.role === "assistant" ? body.role : null;
    const text = String(body.text ?? "").trim();

    if (!sessionId || !UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ error: "role must be user or assistant" }, { status: 400 });
    }
    if (!text || text.length > 16000) {
      return NextResponse.json({ error: "text is required (max 16000 chars)" }, { status: 400 });
    }

    const { data: sess } = await supabase
      .from("assistant_sessions")
      .select("id, title")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!sess) {
      return NextResponse.json({ error: "Unknown session" }, { status: 404 });
    }

    const { error: insErr } = await supabase.from("assistant_messages").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      role,
      content: text,
      artifact_markdown: null,
    });

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    let sessionTitleUpdated = false;
    const row = sess as { id: string; title: string | null };
    const currentTitle = typeof row.title === "string" ? row.title.trim() : "";
    if (role === "user" && currentTitle === "Voice chat") {
      const nextTitle = text.slice(0, 120).trim() || "Voice chat";
      await supabase.from("assistant_sessions").update({ title: nextTitle, updated_at: now }).eq("id", sessionId);
      sessionTitleUpdated = true;
    } else {
      await supabase.from("assistant_sessions").update({ updated_at: now }).eq("id", sessionId);
    }

    void recordUsageEvent({
      tenantId,
      eventType: "assistant.voice_transcript",
      metadata: { session_id: sessionId, role },
    });
    void recordAuditEvent({
      tenantId,
      source: "ui",
      action: "assistant.voice_transcript",
      actorLabel: user.id,
      resourceType: "assistant_session",
      resourceId: sessionId,
      payload: { role },
    });

    return NextResponse.json({ ok: true, sessionTitleUpdated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Transcript error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
