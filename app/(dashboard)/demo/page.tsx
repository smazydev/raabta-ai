import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { DemoClient } from "./demo-client";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender: "customer" | "ai" | "agent";
  body: string;
};

export default async function DemoPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;

  const [{ data: convsRaw }, { data: settings }, tenantAi] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, customer_id, channel, last_message_at")
      .eq("tenant_id", tenantId)
      .eq("channel", "app_chat")
      .order("last_message_at", { ascending: false })
      .limit(12),
    supabase.from("settings").select("roman_urdu_support").eq("tenant_id", tenantId).single(),
    getTenantAiSettings(supabase, tenantId),
  ]);
  const demoAiChatEnabled = isOpenAiConfigured() && tenantAi.autoReply;
  const convs = dbRows<{ id: string; customer_id: string; channel: string; last_message_at: string }>(convsRaw);

  const chatConv = convs[0] ?? null;

  let customers: { id: string; full_name: string }[] = [];
  if (chatConv?.customer_id) {
    const { data: custRaw } = await supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", chatConv.customer_id)
      .limit(1);
    customers = dbRows<{ id: string; full_name: string }>(custRaw);
  }

  let messages: MessageRow[] = [];
  if (chatConv?.id) {
    const { data: msgRaw } = await supabase
      .from("conversation_messages")
      .select("id, conversation_id, sender, body")
      .eq("conversation_id", chatConv.id)
      .order("created_at", { ascending: true });
    messages = dbRows<MessageRow>(msgRaw);
  }

  const customerMap = new Map(customers.map((c) => [c.id, c.full_name]));
  const chatLines = messages
    .filter((m) => m.conversation_id === chatConv?.id && (m.sender === "customer" || m.sender === "ai"))
    .map((m) => ({ id: m.id, sender: m.sender as "customer" | "ai", body: m.body }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Client chat simulator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Sandbox workload only: drive a live <code className="text-xs">app_chat</code> thread through the same
          retrieval and policy stack as production, without impersonating real customers. Knowledge articles may stay
          in English; reply language, Roman Urdu, and optional TTS follow Settings.
        </p>
      </div>
      <DemoClient
        romanUrduSupport={Boolean(settings?.roman_urdu_support)}
        openAiConfigured={isOpenAiConfigured()}
        aiAutoReplyEnabled={tenantAi.autoReply}
        aiChatEnabled={demoAiChatEnabled}
        aiTtsEnabled={tenantAi.ttsEnabled}
        chat={{
          conversationId: chatConv?.id ?? null,
          customerName: chatConv ? (customerMap.get(chatConv.customer_id) ?? null) : null,
          lines: chatLines,
        }}
      />
    </div>
  );
}
