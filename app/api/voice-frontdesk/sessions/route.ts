import { NextResponse } from "next/server";
import { getSessionTenantForApi } from "@/lib/session";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { createVoiceFrontdeskSession } from "@/lib/voice-frontdesk/create-voice-frontdesk-session";

export async function POST(req: Request) {
  if (!VOICE_CALLING_ENABLED) {
    return NextResponse.json({ error: "Voice calling is disabled." }, { status: 410 });
  }
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { supabase, tenantId } = session;
  try {
    const body = await req.json().catch(() => ({}));
    const { data: settings } = await supabase
      .from("settings")
      .select("ai_toggles")
      .eq("tenant_id", tenantId)
      .single();
    const aiToggles = (settings?.ai_toggles as Record<string, unknown> | null) ?? {};
    if (aiToggles.voice_frontdesk_enabled === false) {
      return NextResponse.json({ error: "Voice front-desk disabled for tenant" }, { status: 403 });
    }

    const callerPhone = typeof body.callerPhone === "string" ? body.callerPhone : null;
    const callerName = typeof body.callerName === "string" ? body.callerName : null;

    const row = await createVoiceFrontdeskSession({
      supabase,
      tenantId,
      callerPhone,
      callerName,
    });

    return NextResponse.json({
      id: row.id,
      conversationId: row.conversationId,
      callId: row.callId,
      language: row.preferred_language,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
