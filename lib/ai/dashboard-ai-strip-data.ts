import type { AppDbClient } from "@/lib/db/types";
import { isOpenAiConfigured } from "./openai";
import { resolveOpenAiChatModel } from "./resolve-model";
import { getTenantAiSettings } from "./tenant-ai-settings";

export type DashboardAiStripData = {
  openAiConfigured: boolean;
  defaultChatModel: string;
  autoReply: boolean;
  summaries: boolean;
  assistantCopilot: boolean;
  voiceFrontdeskAi: boolean;
  embeddingsEnabled: boolean;
  ttsEnabled: boolean;
};

export async function getDashboardAiStripData(
  supabase: AppDbClient,
  tenantId: string
): Promise<DashboardAiStripData> {
  const [ai, model] = await Promise.all([
    getTenantAiSettings(supabase, tenantId),
    resolveOpenAiChatModel(supabase, tenantId),
  ]);
  return {
    openAiConfigured: isOpenAiConfigured(),
    defaultChatModel: model,
    autoReply: ai.autoReply,
    summaries: ai.summaries,
    assistantCopilot: ai.assistantCopilot,
    voiceFrontdeskAi: ai.voiceFrontdeskAi,
    embeddingsEnabled: ai.embeddingsEnabled,
    ttsEnabled: ai.ttsEnabled,
  };
}
