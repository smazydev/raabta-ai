"use server";

import { revalidatePath } from "next/cache";
import { dbRows } from "@/lib/db/rows";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { resolveOpenAiChatModelWithOverride } from "@/lib/ai/resolve-model";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getAgentPromptForConversation } from "@/lib/ai/agent-for-conversation";
import { generateConversationReply, generateHandoffSummary } from "@/lib/ai/pipelines";
import {
  loadConversationReplyContext,
  persistConversationAiReply,
} from "@/lib/ai/conversation-reply-context";
import { getSessionTenant } from "@/lib/session";
import { chargeAfterChatCompletion, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import * as workflows from "@/lib/orchestration/workflows";

async function requireConversationsTenant() {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  return { supabase: session.supabase, tenantId: session.tenantId };
}

export async function runAiReplyAction(conversationId: string, languageRaw?: string) {
  if (!isOpenAiConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const { supabase, tenantId } = await requireConversationsTenant();
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.autoReply) {
    throw new Error("AI replies are turned off for this tenant (Settings → AI automation).");
  }

  await preflightAiCredits(tenantId, minPreflightChatCredits());
  const loaded = await loadConversationReplyContext(supabase, tenantId, conversationId, languageRaw);
  const { reply: replyText, usage } = await generateConversationReply(loaded);
  await chargeAfterChatCompletion(
    tenantId,
    usage,
    "openai.ui.conversation_reply",
    { conversationId },
    loaded.model
  );
  await persistConversationAiReply(supabase, tenantId, conversationId, replyText);

  revalidatePath("/conversations");
  return { reply: replyText };
}

export async function blockCardAction(conversationId: string, cardId: string) {
  const { supabase, tenantId } = await requireConversationsTenant();
  const ai = await getTenantAiSettings(supabase, tenantId);
  await workflows.blockCardForCustomer(supabase, tenantId, cardId);

  const { data: conv } = await supabase
    .from("conversations")
    .select("customer_id, agent_id")
    .eq("id", conversationId)
    .single();

  const agentCtx = await getAgentPromptForConversation(
    supabase,
    tenantId,
    (conv as { agent_id?: string | null } | null)?.agent_id
  );
  const model = await resolveOpenAiChatModelWithOverride(
    supabase,
    tenantId,
    agentCtx.agentModelPlaceholder
  );

  if (conv && typeof conv.customer_id === "string") {
    const summary = `Card ${cardId.slice(0, 8)}… blocked from operations console after fraud concern.`;
    await workflows.createComplaintRecord({
      supabase,
      tenantId,
      customerId: conv.customer_id,
      channel: "web_chat",
      category: "Card / fraud",
      summary,
      priority: "high",
      conversationId,
    });

    try {
      if (!isOpenAiConfigured() || !ai.summaries) throw new Error("skip_ai_handoff");
      const { text: handoff, usage } = await generateHandoffSummary({
        context: `Card blocked. Conversation ${conversationId}. Customer id ${conv.customer_id}.`,
        model,
      });
      await chargeAfterChatCompletion(tenantId, usage, "openai.ui.block_card_handoff", { conversationId }, model);
      await workflows.saveAgentSummary({
        supabase,
        tenantId,
        summary: handoff,
        conversationId,
        suggestedReply: "We have blocked your card and opened a reconciliation complaint.",
        nextActions: ["Verify identity", "Offer replacement card"],
      });
    } catch {
      /* template summary when OpenAI off, summaries disabled, or call failed */
      await workflows.saveAgentSummary({
        supabase,
        tenantId,
        summary: "Card blocked; complaint opened from operations console.",
        conversationId,
        suggestedReply: "We have blocked your card and opened a reconciliation complaint.",
        nextActions: ["Verify identity", "Offer replacement card"],
      });
    }
  }

  revalidatePath("/conversations");
  revalidatePath("/complaints");
  revalidatePath("/assist");
  revalidatePath("/overview");
}

export async function createComplaintFromConversationAction(conversationId: string, category: string) {
  const { supabase, tenantId } = await requireConversationsTenant();
  const { data: conv } = await supabase
    .from("conversations")
    .select("customer_id, channel")
    .eq("id", conversationId)
    .single();
  if (!conv || typeof conv.customer_id !== "string" || typeof conv.channel !== "string") {
    throw new Error("Not found");
  }
  await workflows.createComplaintRecord({
    supabase,
    tenantId,
    customerId: conv.customer_id,
    channel: conv.channel,
    category,
    summary: `Complaint raised from conversation ${conversationId.slice(0, 8)}`,
    conversationId,
  });
  revalidatePath("/conversations");
  revalidatePath("/complaints");
}

export async function escalateConversationAction(conversationId: string) {
  const { supabase, tenantId } = await requireConversationsTenant();
  await workflows.escalateConversation(supabase, tenantId, conversationId);
  revalidatePath("/conversations");
  revalidatePath("/assist");
}

export async function resolveConversationAction(conversationId: string, containment: boolean) {
  const { supabase, tenantId } = await requireConversationsTenant();
  await workflows.resolveConversation(supabase, tenantId, conversationId, containment);
  revalidatePath("/conversations");
  revalidatePath("/overview");
}

export async function generateSummaryAction(conversationId: string) {
  if (!isOpenAiConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const { supabase, tenantId } = await requireConversationsTenant();
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.summaries) {
    throw new Error("AI summaries are turned off for this tenant (Settings → AI automation).");
  }
  const { data: convSum } = await supabase
    .from("conversations")
    .select("agent_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const agentCtxSum = await getAgentPromptForConversation(
    supabase,
    tenantId,
    (convSum as { agent_id?: string | null } | null)?.agent_id
  );
  const model = await resolveOpenAiChatModelWithOverride(
    supabase,
    tenantId,
    agentCtxSum.agentModelPlaceholder
  );
  const { data: msgsRaw2 } = await supabase
    .from("conversation_messages")
    .select("sender, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const msgs2 = dbRows<{ sender: string; body: string }>(msgsRaw2);
  const text = msgs2.map((m) => `${m.sender}: ${m.body}`).join("\n");
  await preflightAiCredits(tenantId, minPreflightChatCredits());
  const { text: summary, usage } = await generateHandoffSummary({ context: text, model });
  await chargeAfterChatCompletion(tenantId, usage, "openai.ui.conversation_summary", { conversationId }, model);
  await supabase.from("conversations").update({ summary }).eq("id", conversationId);
  await workflows.saveAgentSummary({
    supabase,
    tenantId,
    summary,
    conversationId,
  });
  revalidatePath("/conversations");
  revalidatePath("/assist");
  return { summary };
}

export async function setConversationAgentAction(conversationId: string, agentId: string | null) {
  const { supabase, tenantId } = await requireConversationsTenant();
  if (agentId) {
    const { data: agent } = await supabase
      .from("ai_agents")
      .select("id")
      .eq("id", agentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!agent) throw new Error("Agent not found");
  }
  const { error } = await supabase
    .from("conversations")
    .update({ agent_id: agentId })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message || "Failed to assign agent");
  revalidatePath("/conversations");
}
