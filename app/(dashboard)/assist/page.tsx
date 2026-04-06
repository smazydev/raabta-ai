import { isOpenAiConfigured } from "@/lib/ai/openai";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { getSessionTenant } from "@/lib/session";
import { dbRows } from "@/lib/db/rows";
import { redirectUnauthenticatedToLogin } from "@/lib/auth/redirect-unauthenticated";
import { AssistClient } from "./assist-client";

export default async function AssistPage() {
  const session = await getSessionTenant();
  if (!session) return await redirectUnauthenticatedToLogin();

  const { supabase, tenantId } = session;
  const aiSettings = await getTenantAiSettings(supabase, tenantId);

  const { data: convsRaw } = await supabase
    .from("conversations")
    .select("id, customer_id, channel, summary, status, intent")
    .eq("tenant_id", tenantId)
    .eq("status", "escalated");
  const convs = dbRows<{
    id: string;
    customer_id: string;
    channel: string;
    summary: string | null;
    status: string;
    intent: string | null;
  }>(convsRaw);

  const { data: complaintsRaw } = await supabase
    .from("complaints")
    .select("id, reference, summary, customer_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "escalated");
  const complaints = dbRows<{
    id: string;
    reference: string;
    summary: string | null;
    customer_id: string;
    status: string;
  }>(complaintsRaw);

  const cids = [
    ...new Set([
      ...convs.map((c) => c.customer_id),
      ...complaints.map((c) => c.customer_id),
    ]),
  ];

  let customers: { id: string; full_name: string; account_number: string | null }[] = [];
  if (cids.length) {
    const { data: custRaw } = await supabase
      .from("customers")
      .select("id, full_name, account_number")
      .in("id", cids);
    customers = dbRows<{ id: string; full_name: string; account_number: string | null }>(custRaw);
  }
  const cmap = new Map(customers.map((c) => [c.id, c]));

  const { data: summariesRaw } = await supabase
    .from("agent_summaries")
    .select("id, summary, suggested_reply, next_actions, conversation_id, complaint_id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(20);
  const summaries = dbRows<{
    id: string;
    summary: string;
    suggested_reply: string | null;
    next_actions: unknown;
    conversation_id: string | null;
    complaint_id: string | null;
    created_at: string;
  }>(summariesRaw);

  const items = convs.map((c) => ({
    type: "conversation" as const,
    id: c.id,
    title: `Conversation · ${c.channel}`,
    summary: c.summary,
    intent: c.intent,
    customer: cmap.get(c.customer_id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Agent assist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escalated queue with AI summaries and suggested replies (server-side OpenAI).
        </p>
      </div>
      <AssistClient
        items={items}
        summaries={summaries}
        openAiConfigured={isOpenAiConfigured()}
        aiSummariesEnabled={aiSettings.summaries}
      />
    </div>
  );
}
