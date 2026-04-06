import { dbRows } from "@/lib/db/rows";
import type { AppDbClient } from "@/lib/db/types";
import { searchKnowledge } from "@/lib/knowledge/retrieve";
import { getAgentPromptForConversation } from "@/lib/ai/agent-for-conversation";
import { resolveOpenAiChatModelWithOverride } from "@/lib/ai/resolve-model";
import { parseChatLanguage } from "@/lib/ai/chat-language";
import type { ChatLanguage } from "@/lib/ai/chat-languages";
import * as workflows from "@/lib/orchestration/workflows";

export type ConversationReplyLoaded = {
  customerName: string;
  messages: { role: string; content: string }[];
  kbContext: string;
  language: ChatLanguage;
  romanUrdu: boolean;
  model: string;
  agentName?: string;
  agentInstructions?: string;
};

/** Loads transcript, KB snippets, and agent prompt — same inputs as `generateConversationReply`. */
export async function loadConversationReplyContext(
  supabase: AppDbClient,
  tenantId: string,
  conversationId: string,
  languageRaw?: string
): Promise<ConversationReplyLoaded> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, customer_id, intent, agent_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single();
  if (!conv || typeof conv.customer_id !== "string") {
    throw new Error("Conversation not found");
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("full_name")
    .eq("id", conv.customer_id)
    .single();

  const { data: settings } = await supabase
    .from("settings")
    .select("roman_urdu_support")
    .eq("tenant_id", tenantId)
    .single();

  const { data: msgsRaw } = await supabase
    .from("conversation_messages")
    .select("sender, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const msgs = dbRows<{ sender: string; body: string; created_at: string }>(msgsRaw);

  const lastCustomer = [...msgs].reverse().find((m) => m.sender === "customer");
  const kb = lastCustomer
    ? await searchKnowledge(supabase, tenantId, lastCustomer.body.slice(0, 200), 4)
    : [];
  const kbContext = kb.map((a) => `## ${a.title}\n${a.body}`).join("\n\n");

  const language = parseChatLanguage(languageRaw);
  const customerName = typeof customer?.full_name === "string" ? customer.full_name : "Customer";

  const agentCtx = await getAgentPromptForConversation(
    supabase,
    tenantId,
    conv.agent_id as string | null | undefined
  );
  const model = await resolveOpenAiChatModelWithOverride(
    supabase,
    tenantId,
    agentCtx.agentModelPlaceholder
  );
  const { agentModelPlaceholder: _p, ...promptOnly } = agentCtx;

  return {
    customerName,
    messages: msgs.map((m) => ({
      role: m.sender === "customer" ? "customer" : m.sender === "agent" ? "agent" : "assistant",
      content: m.body,
    })),
    kbContext,
    language,
    romanUrdu: Boolean(settings?.roman_urdu_support),
    model,
    agentName: promptOnly.agentName,
    agentInstructions: promptOnly.agentInstructions,
  };
}

export async function persistConversationAiReply(
  supabase: AppDbClient,
  tenantId: string,
  conversationId: string,
  replyText: string
): Promise<{ messageId: string }> {
  const { data: row, error } = await supabase
    .from("conversation_messages")
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender: "ai",
      body: replyText,
    })
    .select("id")
    .single();
  if (error || !row?.id) {
    throw new Error(error?.message ?? "Failed to save AI message");
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  await workflows.appendLiveEvent(supabase, tenantId, "ai.reply_generated", { conversationId });

  return { messageId: row.id as string };
}
