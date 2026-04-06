import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/db/service-client";
import { synthesizeSpeechMp3 } from "@/lib/ai/synthesize-speech";
import { parseChatLanguage } from "@/lib/ai/chat-language";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { chargeTtsCredits, preflightAiCredits } from "@/lib/billing/credits";
import { creditsFromTtsInput } from "@/lib/billing/pricing";
import { billingErrorResponse } from "@/lib/billing/http";
import { verifyTwilioTtsPlayToken } from "@/lib/twilio/tts-play-token";
import type { VoiceLanguage } from "@/lib/voice-frontdesk/types";

export const dynamic = "force-dynamic";

function voiceToChatLang(v: VoiceLanguage) {
  return parseChatLanguage(v);
}

/** Twilio &lt;Play&gt; fetches this URL (signed token). No Twilio signature on GET. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get("t") ?? "";
  const payload = verifyTwilioTtsPlayToken(token);
  if (!payload) {
    return new NextResponse("Invalid or expired token", { status: 403 });
  }
  if (!isOpenAiConfigured()) {
    return new NextResponse("TTS unavailable", { status: 503 });
  }

  const supabase = createServiceRoleClient();
  const tenantId = payload.tenantId;
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.ttsEnabled) {
    return new NextResponse("TTS disabled for tenant", { status: 403 });
  }

  try {
    const charCount = payload.text.length;
    await preflightAiCredits(tenantId, creditsFromTtsInput(charCount));
    const buffer = await synthesizeSpeechMp3(payload.text, {
      language: voiceToChatLang(payload.lang as VoiceLanguage),
      romanUrdu: Boolean(payload.romanUrdu) && payload.lang === "ur",
    });
    await chargeTtsCredits(tenantId, charCount, {});
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
    return new NextResponse(e instanceof Error ? e.message : "TTS failed", { status: 500 });
  }
}
