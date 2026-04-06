"use server";

import { revalidatePath } from "next/cache";
import { dbRows } from "@/lib/db/rows";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { resolveOpenAiChatModelWithOverride } from "@/lib/ai/resolve-model";
import { getAgentPromptForConversation } from "@/lib/ai/agent-for-conversation";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { generateHandoffSummary, suggestAgentReply } from "@/lib/ai/pipelines";
import { getSessionTenant } from "@/lib/session";
import { chargeAfterAggregatedChat, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import * as workflows from "@/lib/orchestration/workflows";

/** Full OpenAI pack: handoff summary + suggested reply, persisted to agent_summaries. */
export async function generateAssistPackAction(conversationId: string) {
  if (!isOpenAiConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.summaries) {
    throw new Error("AI summaries are turned off for this tenant (Settings → AI automation).");
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, summary, intent, status, agent_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  const agentCtx = await getAgentPromptForConversation(
    supabase,
    tenantId,
    (conv as { agent_id?: string | null }).agent_id
  );
  const model = await resolveOpenAiChatModelWithOverride(
    supabase,
    tenantId,
    agentCtx.agentModelPlaceholder
  );

  const { data: msgsRaw } = await supabase
    .from("conversation_messages")
    .select("sender, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const msgs = dbRows<{ sender: string; body: string }>(msgsRaw);
  const thread = msgs.map((m) => `${m.sender}: ${m.body}`).join("\n");
  const seedSummary =
    typeof conv.summary === "string" && conv.summary.trim()
      ? conv.summary.trim()
      : thread.slice(0, 1200) || "(no messages yet)";

  await preflightAiCredits(tenantId, minPreflightChatCredits() * 2);
  const { text: summary, usage: u1 } = await generateHandoffSummary({
    context: thread || seedSummary,
    model,
  });
  const { text: suggestedReply, usage: u2 } = await suggestAgentReply({
    summary: seedSummary,
    thread: thread || seedSummary,
    model,
  });
  await chargeAfterAggregatedChat(tenantId, [u1, u2], "openai.ui.assist_pack", { conversationId }, model);

  await workflows.saveAgentSummary({
    supabase,
    tenantId,
    summary,
    suggestedReply,
    nextActions: ["Review escalated thread", "Confirm resolution with customer"],
    conversationId,
  });

  revalidatePath("/assist");
  revalidatePath("/conversations");
  return { summary, suggestedReply };
}
