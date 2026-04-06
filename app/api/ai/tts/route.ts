import { NextResponse } from "next/server";
import { getSessionTenantForApi } from "@/lib/session";
import { synthesizeSpeechMp3 } from "@/lib/ai/synthesize-speech";
import { parseChatLanguage } from "@/lib/ai/chat-language";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { chargeTtsCredits, preflightAiCredits } from "@/lib/billing/credits";
import { creditsFromTtsInput } from "@/lib/billing/pricing";
import { billingErrorResponse } from "@/lib/billing/http";

const MAX_INPUT_CHARS = 4096;

export async function POST(req: Request) {
  const session = await getSessionTenantForApi();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOpenAiConfigured()) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  }
  const ai = await getTenantAiSettings(session.supabase, session.tenantId);
  if (!ai.ttsEnabled) {
    return NextResponse.json(
      { error: "Text-to-speech is disabled for this tenant (Settings → AI automation)." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const text = String(body.text ?? "").trim().slice(0, MAX_INPUT_CHARS);
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const charCount = text.length;
    await preflightAiCredits(session.tenantId, creditsFromTtsInput(charCount));
    const language =
      body.language !== undefined && body.language !== null && body.language !== ""
        ? parseChatLanguage(body.language)
        : undefined;
    const romanUrdu = Boolean(body.romanUrdu);
    const buffer = await synthesizeSpeechMp3(
      text,
      language !== undefined ? { language, romanUrdu } : undefined
    );
    await chargeTtsCredits(session.tenantId, charCount, {});
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const be = billingErrorResponse(e);
    if (be) return be;
    const msg = e instanceof Error ? e.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
