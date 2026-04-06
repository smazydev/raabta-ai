import type { AppDbClient } from "@/lib/db/types";
import { enqueueLiveEventWebhook } from "@/lib/platform/live-events-webhook";

export async function appendLiveEvent(
  supabase: AppDbClient,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from("live_events")
    .insert({
      tenant_id: tenantId,
      event_type: eventType,
      payload,
    })
    .select("id, created_at")
    .single();
  if (error) {
    console.error("appendLiveEvent", error);
    return;
  }
  const id = data && typeof (data as { id?: string }).id === "string" ? (data as { id: string }).id : null;
  const createdAt =
    data && typeof (data as { created_at?: string }).created_at === "string"
      ? (data as { created_at: string }).created_at
      : new Date().toISOString();
  if (id) {
    enqueueLiveEventWebhook({
      tenant_id: tenantId,
      live_event_id: id,
      event_type: eventType,
      payload,
      created_at: createdAt,
    });
  }
}

export async function blockCardForCustomer(
  supabase: AppDbClient,
  tenantId: string,
  cardId: string
) {
  const { error } = await supabase
    .from("cards")
    .update({ status: "blocked" })
    .eq("id", cardId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  await appendLiveEvent(supabase, tenantId, "card.blocked", { cardId });
}

export async function freezeCardForCustomer(
  supabase: AppDbClient,
  tenantId: string,
  cardId: string
) {
  const { error } = await supabase
    .from("cards")
    .update({ status: "frozen" })
    .eq("id", cardId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  await appendLiveEvent(supabase, tenantId, "card.frozen", { cardId });
}

function complaintRef() {
  return `CMP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function createComplaintRecord(input: {
  supabase: AppDbClient;
  tenantId: string;
  customerId: string;
  channel: string;
  category: string;
  summary: string;
  priority?: string;
  conversationId?: string | null;
  callId?: string | null;
}): Promise<{ id: string; reference: string }> {
  const {
    supabase,
    tenantId,
    customerId,
    channel,
    category,
    summary,
    priority = "medium",
    conversationId,
    callId,
  } = input;

  const reference = complaintRef();
  const { data, error } = await supabase
    .from("complaints")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      reference,
      channel,
      category,
      priority,
      status: "new",
      summary,
      conversation_id: conversationId ?? null,
      call_id: callId ?? null,
      sla_due_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      assigned_team: "Operations",
    })
    .select("id, reference")
    .single();

  if (error) throw error;
  if (!data || typeof data.id !== "string" || typeof data.reference !== "string") {
    throw new Error("Failed to create complaint row");
  }

  await supabase.from("cases").insert({
    tenant_id: tenantId,
    title: `${reference} — ${category}`,
    complaint_id: data.id,
    conversation_id: conversationId ?? null,
    call_id: callId ?? null,
    status: "open",
  });

  await appendLiveEvent(supabase, tenantId, "complaint.created", {
    complaintId: data.id,
    reference: data.reference,
    category,
  });

  return { id: data.id, reference: data.reference };
}

export async function resolveConversation(
  supabase: AppDbClient,
  tenantId: string,
  conversationId: string,
  containment: boolean
) {
  const { error } = await supabase
    .from("conversations")
    .update({
      status: "resolved",
      containment_resolved: containment,
    })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  await appendLiveEvent(supabase, tenantId, "conversation.resolved", {
    conversationId,
    containment,
  });
}

export async function escalateConversation(
  supabase: AppDbClient,
  tenantId: string,
  conversationId: string
) {
  const { error } = await supabase
    .from("conversations")
    .update({ status: "escalated" })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
  await appendLiveEvent(supabase, tenantId, "conversation.escalated", { conversationId });
}

export async function saveAgentSummary(input: {
  supabase: AppDbClient;
  tenantId: string;
  summary: string;
  suggestedReply?: string;
  nextActions?: string[];
  conversationId?: string | null;
  complaintId?: string | null;
  callId?: string | null;
}) {
  const {
    supabase,
    tenantId,
    summary,
    suggestedReply,
    nextActions,
    conversationId,
    complaintId,
    callId,
  } = input;
  await supabase.from("agent_summaries").insert({
    tenant_id: tenantId,
    summary,
    suggested_reply: suggestedReply ?? null,
    next_actions: nextActions ?? [],
    conversation_id: conversationId ?? null,
    complaint_id: complaintId ?? null,
    call_id: callId ?? null,
  });
}
