import { NextResponse } from "next/server";
import { getSessionTenantForApi } from "@/lib/session";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { runVoiceFrontdeskTurnForSession } from "@/lib/voice-frontdesk/run-voice-frontdesk-turn";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!VOICE_CALLING_ENABLED) {
    return NextResponse.json({ error: "Voice calling is disabled." }, { status: 410 });
  }
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { supabase, tenantId } = session;
  const { id } = await context.params;

  try {
    const body = await req.json();
    const utterance = String(body.utterance ?? "").trim();
    if (!utterance) return NextResponse.json({ error: "Utterance required" }, { status: 400 });
    const asrConfidence = typeof body.asrConfidence === "number" ? body.asrConfidence : undefined;

    const turn = await runVoiceFrontdeskTurnForSession({
      supabase,
      tenantId,
      sessionId: id,
      utterance,
      asrConfidence,
    });

    if (!turn.ok) {
      return NextResponse.json(
        { error: turn.failure.error, code: turn.failure.code },
        { status: turn.failure.status }
      );
    }

    return NextResponse.json({
      responseText: turn.data.responseText,
      language: turn.data.language,
      intent: turn.data.intent,
      shouldEscalate: turn.data.shouldEscalate,
      shouldEndCall: turn.data.shouldEndCall,
      escalationReason: turn.data.escalationReason,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Turn failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
