import type { AppDbClient } from "@/lib/db/types";

export type TenantAiSettings = {
  autoReply: boolean;
  summaries: boolean;
  voiceFrontdeskSindhi: boolean;
  voiceFrontdeskPashto: boolean;
  /** `/assistant` UI + `POST /api/assistant/chat` + tool loop */
  assistantCopilot: boolean;
  /** Voice front desk LLM turns (`/api/voice-frontdesk/.../turn`, realtime session) */
  voiceFrontdeskAi: boolean;
  /** OpenAI embeddings API for KB chunks + semantic retrieval */
  embeddingsEnabled: boolean;
  /** OpenAI speech (TTS) */
  ttsEnabled: boolean;
};

/** Reads `settings.ai_toggles` with safe defaults (features on unless explicitly false). */
export async function getTenantAiSettings(
  supabase: AppDbClient,
  tenantId: string
): Promise<TenantAiSettings> {
  const { data } = await supabase.from("settings").select("ai_toggles").eq("tenant_id", tenantId).maybeSingle();
  const t = (data?.ai_toggles as Record<string, unknown> | null) ?? {};
  return {
    autoReply: t.auto_reply !== false,
    summaries: t.summaries !== false,
    /** On unless explicitly turned off — Urdu-first product with Sindhi/Pashto as 2nd/3rd. */
    voiceFrontdeskSindhi: t.voice_frontdesk_sindhi_enabled !== false,
    voiceFrontdeskPashto: t.voice_frontdesk_pashto_enabled !== false,
    assistantCopilot: t.assistant_copilot !== false,
    voiceFrontdeskAi: t.voice_frontdesk_ai !== false,
    embeddingsEnabled: t.embeddings_enabled !== false,
    ttsEnabled: t.tts_enabled !== false,
  };
}
