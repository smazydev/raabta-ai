import type { AppDbClient } from "@/lib/db/types";

export type AgentPromptContext = {
  agentName?: string;
  agentInstructions?: string;
  /** Raw `model_placeholder`; resolve with `resolveOpenAiChatModelWithOverride` when calling OpenAI. */
  agentModelPlaceholder?: string | null;
};

export async function getAgentPromptForConversation(
  supabase: AppDbClient,
  tenantId: string,
  agentId: string | null | undefined
): Promise<AgentPromptContext> {
  if (!agentId) return {};
  const { data } = await supabase
    .from("ai_agents")
    .select("name, instructions, model_placeholder")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return {};
  const name = typeof data.name === "string" ? data.name : undefined;
  const instructions = typeof data.instructions === "string" ? data.instructions.trim() : "";
  const mp = (data as { model_placeholder?: string | null }).model_placeholder;
  const model_placeholder = typeof mp === "string" ? mp : null;
  const base: AgentPromptContext = {
    agentModelPlaceholder: model_placeholder,
  };
  if (!instructions) return name ? { ...base, agentName: name } : base;
  return { ...base, agentName: name, agentInstructions: instructions };
}
