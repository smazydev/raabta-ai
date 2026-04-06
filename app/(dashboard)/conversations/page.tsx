import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { ConversationsClient } from "./conversations-client";

export default async function ConversationsPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;

  const { data: conversationsRaw } = await supabase
    .from("conversations")
    .select("id, channel, status, intent, summary, last_message_at, customer_id, agent_id")
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false });
  const convList = dbRows<{
    id: string;
    channel: string;
    status: string;
    intent: string | null;
    summary: string | null;
    last_message_at: string;
    customer_id: string;
    agent_id: string | null;
  }>(conversationsRaw);
  const customerIds = [...new Set(convList.map((c) => c.customer_id))];

  let customers: {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    account_number: string | null;
    risk_level: string | null;
  }[] = [];
  if (customerIds.length) {
    const { data: custRaw } = await supabase
      .from("customers")
      .select("id, full_name, phone, email, account_number, risk_level")
      .in("id", customerIds);
    customers = dbRows<{
      id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      account_number: string | null;
      risk_level: string | null;
    }>(custRaw);
  }

  const convIds = convList.map((c) => c.id);
  let messages: {
    id: string;
    conversation_id: string;
    sender: string;
    body: string;
    created_at: string;
  }[] = [];
  if (convIds.length) {
    const { data: msgRaw } = await supabase
      .from("conversation_messages")
      .select("id, conversation_id, sender, body, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true });
    messages = dbRows<{
      id: string;
      conversation_id: string;
      sender: string;
      body: string;
      created_at: string;
    }>(msgRaw);
  }

  const { data: cardsRaw } = await supabase
    .from("cards")
    .select("id, customer_id, last_four, status")
    .eq("tenant_id", tenantId);
  const cards = dbRows<{ id: string; customer_id: string; last_four: string; status: string }>(cardsRaw);

  const [{ data: settingsRow }, aiSettings] = await Promise.all([
    supabase.from("settings").select("roman_urdu_support").eq("tenant_id", tenantId).single(),
    getTenantAiSettings(supabase, tenantId),
  ]);
  const aiTtsEnabled = aiSettings.ttsEnabled;

  const { data: workflowRowsRaw } = await supabase
    .from("workflows")
    .select("id, name, channels, trigger_type, trigger_config")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  const workflowRows = dbRows<{
    id: string;
    name: string;
    channels: unknown;
    trigger_type: string;
    trigger_config: unknown;
  }>(workflowRowsRaw);

  const manualWorkflows = workflowRows
    .filter((w) => w.trigger_type === "manual")
    .map((w) => ({
      id: w.id,
      name: w.name,
      channels: (Array.isArray(w.channels) ? w.channels : []) as string[],
    }));
  const intentWorkflows = workflowRows
    .filter((w) => w.trigger_type === "intent_match")
    .map((w) => ({
      id: w.id,
      name: w.name,
      intent: String((w.trigger_config as { intent?: string } | null)?.intent ?? ""),
      channels: (Array.isArray(w.channels) ? w.channels : []) as string[],
    }));

  const { data: agentsRaw } = await supabase
    .from("ai_agents")
    .select("id, name, kind, status, citations_required, escalation_target_team, human_handoff_enabled")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  const allAgents = dbRows<{
    id: string;
    name: string;
    kind: string;
    status: string | null;
    citations_required: boolean | null;
    escalation_target_team: string | null;
    human_handoff_enabled: boolean | null;
  }>(agentsRaw);
  const chatAgents = allAgents.filter(
    (a) => (a.kind === "chat" || a.kind === "both") && (a.status ?? "live") === "live"
  );
  const agentInsights = Object.fromEntries(
    allAgents.map((a) => [
      a.id,
      {
        name: a.name,
        citationsRequired: Boolean(a.citations_required),
        escalationTeam: a.escalation_target_team,
        handoffEnabled: a.human_handoff_enabled !== false,
      },
    ])
  );

  const custMap = new Map(customers.map((c) => [c.id, c]));
  const msgMap = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = msgMap.get(m.conversation_id) ?? [];
    list.push(m);
    msgMap.set(m.conversation_id, list);
  }

  const initial = convList.map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    intent: c.intent,
    summary: c.summary,
    last_message_at: c.last_message_at,
    agent_id: c.agent_id,
    customer: custMap.get(c.customer_id) ?? null,
    messages: msgMap.get(c.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Conversation operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Omnichannel service desk — workflow automation, governed AI replies, and structured human handoff on one
          orchestration layer.
        </p>
      </div>
      <ConversationsClient
        romanUrduSupport={Boolean(settingsRow?.roman_urdu_support)}
        openAiConfigured={isOpenAiConfigured()}
        aiAutoReplyEnabled={aiSettings.autoReply}
        aiSummariesEnabled={aiSettings.summaries}
        aiTtsEnabled={aiTtsEnabled}
        initial={initial}
        cards={cards}
        manualWorkflows={manualWorkflows}
        intentWorkflows={intentWorkflows}
        chatAgents={chatAgents}
        agentInsights={agentInsights}
      />
    </div>
  );
}
