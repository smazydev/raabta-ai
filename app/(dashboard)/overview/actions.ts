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
import { getSessionTenant } from "@/lib/session";
import { chargeAfterChatCompletion, preflightAiCredits } from "@/lib/billing/credits";
import { minPreflightChatCredits } from "@/lib/billing/pricing";
import { appendLiveEvent } from "@/lib/orchestration/workflows";

async function requireOverviewTenant() {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  return { supabase: session.supabase, tenantId: session.tenantId };
}

export async function sendDemoMessageAction(
  conversationId: string,
  input: string,
  languageRaw?: string
) {
  const text = input.trim();
  if (!text) throw new Error("Message cannot be empty");
  if (!isOpenAiConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const { supabase, tenantId } = await requireOverviewTenant();
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
  const promptOnly = { ...agentCtx };
  delete promptOnly.agentModelPlaceholder;

  const [{ data: customer }, { data: settings }, { data: msgsRaw }] = await Promise.all([
    supabase.from("customers").select("full_name").eq("id", conv.customer_id).single(),
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
  const language = parseChatLanguage(languageRaw);
  const customerName =
    typeof customer?.full_name === "string" ? customer.full_name : "Customer";
  await preflightAiCredits(tenantId, minPreflightChatCredits());
  const { reply: replyText, usage } = await generateConversationReply({
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
  await chargeAfterChatCompletion(tenantId, usage, "openai.ui.overview_demo", { conversationId }, model);

  await supabase.from("conversation_messages").insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender: "ai",
    body: replyText,
  });

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  await appendLiveEvent(supabase, tenantId, "demo.call_simulated", {
    conversationId,
    source: "admin_demo_widget",
  });

  revalidatePath("/overview");
  revalidatePath("/conversations");
  revalidatePath("/live");
  return { reply: replyText };
}
