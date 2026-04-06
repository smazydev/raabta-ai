"use server";

import { revalidatePath } from "next/cache";
import { dbRows } from "@/lib/db/rows";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { resolveOpenAiChatModelWithOverride } from "@/lib/ai/resolve-model";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { searchKnowledge } from "@/lib/knowledge/retrieve";
import { getAgentPromptForConversation } from "@/lib/ai/agent-for-conversation";
import { generateConversationReply } from "@/lib/ai/pipelines";
import { parseChatLanguage } from "@/lib/ai/chat-language";
import type { ChatLanguage } from "@/lib/ai/chat-languages";
import { getSessionTenant } from "@/lib/session";
import { chargeAfterChatCompletion, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import { appendLiveEvent } from "@/lib/orchestration/workflows";
import type { UserDbClient } from "@/lib/db/app-client";

async function buildReplyForConversation(
  supabase: UserDbClient,
  tenantId: string,
  conversationId: string,
  customerId: string,
  text: string,
  language: ChatLanguage,
  agentId: string | null | undefined
) {
  const agentCtx = await getAgentPromptForConversation(supabase, tenantId, agentId);
  const model = await resolveOpenAiChatModelWithOverride(
    supabase,
    tenantId,
    agentCtx.agentModelPlaceholder
  );
  const promptOnly = { ...agentCtx };
  delete promptOnly.agentModelPlaceholder;

  const [{ data: customer }, { data: settings }, { data: msgsRaw }] = await Promise.all([
    supabase.from("customers").select("full_name").eq("id", customerId).single(),
    supabase.from("settings").select("roman_urdu_support").eq("tenant_id", tenantId).single(),
    supabase
      .from("conversation_messages")
      .select("sender, body")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  ]);
  const msgs = dbRows<{ sender: string; body: string }>(msgsRaw);

  const kb = await searchKnowledge(supabase, tenantId, text.slice(0, 200), 4);
  const kbContext = kb.map((a) => `## ${a.title}\n${a.body}`).join("\n\n");

  const customerName =
    typeof customer?.full_name === "string" ? customer.full_name : "Customer";
  const { reply, usage } = await generateConversationReply({
    customerName,
    messages: msgs.map((m) => ({
      role: m.sender === "customer" ? "customer" : m.sender === "agent" ? "agent" : "assistant",
      content: m.body,
    })),
    kbContext,
    language,
    romanUrdu: Boolean(settings?.roman_urdu_support),
    model,
    ...promptOnly,
  });
  await chargeAfterChatCompletion(tenantId, usage, "openai.ui.demo_chat", { conversationId }, model);
  return reply;
}

export async function sendDemoChatTurnAction(
  conversationId: string,
  input: string,
  languageRaw?: string
) {
  const text = input.trim();
  if (!text) throw new Error("Message cannot be empty");
  if (!isOpenAiConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  const ai = await getTenantAiSettings(supabase, tenantId);
  if (!ai.autoReply) {
    throw new Error("AI replies are turned off for this tenant (Settings → AI automation).");
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, customer_id, agent_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single();
  if (!conv) throw new Error("Conversation not found");

  await supabase.from("conversation_messages").insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender: "customer",
    body: text,
  });

  const language = parseChatLanguage(languageRaw);
  await preflightAiCredits(tenantId, minPreflightChatCredits());
  const reply = await buildReplyForConversation(
    supabase,
    tenantId,
    conversationId,
    conv.customer_id as string,
    text,
    language,
    conv.agent_id as string | null | undefined
  );

  await supabase.from("conversation_messages").insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender: "ai",
    body: reply,
  });

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  await appendLiveEvent(supabase, tenantId, "demo.client_chat_turn", { conversationId });
  revalidatePath("/demo");
  revalidatePath("/conversations");
  revalidatePath("/live");
  return { reply };
}

/** @deprecated Voice demo removed; conversational chat + KB only. */
export async function sendDemoVoiceTurnAction(
  _callId: string,
  _conversationId: string,
  _input: string
) {
  void _callId;
  void _conversationId;
  void _input;
  throw new Error("Voice calling is disabled. Use the chat demo instead.");
}
