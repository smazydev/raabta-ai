import { NextResponse } from "next/server";
import { getSessionTenantForApi } from "@/lib/session";
import { VOICE_CALLING_ENABLED } from "@/lib/features";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";

export async function POST() {
  if (!VOICE_CALLING_ENABLED) {
    return NextResponse.json({ error: "Voice calling is disabled." }, { status: 410 });
  }
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantAi = await getTenantAiSettings(session.supabase, session.tenantId);
  if (!tenantAi.voiceFrontdeskAi) {
    return NextResponse.json(
      { error: "Voice front desk AI is disabled for this tenant (Settings → AI automation)." },
      { status: 403 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });

  try {
    const model = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview";
    const voice = process.env.OPENAI_REALTIME_VOICE || "verse";
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        instructions:
          "Urdu is primary language. Keep responses short. If uncertain after repeated unclear audio, transfer to human.",
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return NextResponse.json({ error: data?.error?.message ?? "Realtime session failed" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Realtime session failed" },
      { status: 500 }
    );
  }
}
