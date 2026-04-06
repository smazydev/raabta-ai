import type { AppDbClient } from "@/lib/db/types";
import { openAiModelIdFromPlaceholder } from "./model-placeholder";

type ProviderProfile = {
  default_openai_model?: string;
};

/** Env default when Settings → provider profile has no model. */
export function fallbackOpenAiChatModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/**
 * Preferred chat model from `settings.provider_profile.default_openai_model`, else `OPENAI_MODEL` / gpt-4o-mini.
 */
export async function resolveOpenAiChatModel(supabase: AppDbClient, tenantId: string): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("provider_profile")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const pp = (data?.provider_profile as ProviderProfile | null) ?? {};
  const m = typeof pp.default_openai_model === "string" ? pp.default_openai_model.trim() : "";
  if (m) return m;
  return fallbackOpenAiChatModel();
}

/**
 * Uses `agentModelPlaceholder` when it parses as an OpenAI model id; otherwise tenant default.
 */
export async function resolveOpenAiChatModelWithOverride(
  supabase: AppDbClient,
  tenantId: string,
  agentModelPlaceholder?: string | null
): Promise<string> {
  const id = openAiModelIdFromPlaceholder(agentModelPlaceholder);
  if (id) return id;
  return resolveOpenAiChatModel(supabase, tenantId);
}
