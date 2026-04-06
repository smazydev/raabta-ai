"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runWorkflowEngine } from "@/lib/orchestration/run-workflow";

async function sessionTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) throw new Error("No tenant");
  return { supabase, userId: user.id, tenantId: profile.tenant_id as string };
}

export async function runPublishedWorkflowAction(
  workflowId: string,
  context: {
    conversationId?: string;
    callId?: string;
    cardId?: string;
    customerId?: string;
  }
) {
  const { supabase, userId, tenantId } = await sessionTenant();

  const { data: wf } = await supabase
    .from("workflows")
    .select("id, definition, enabled")
    .eq("id", workflowId)
    .eq("tenant_id", tenantId)
    .single();
  if (!wf) throw new Error("Workflow not found");
  if (!wf.enabled) throw new Error("Workflow is disabled");

  let customerId = context.customerId;
  let channel: string | undefined;
  if (context.conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("customer_id, channel")
      .eq("id", context.conversationId)
      .eq("tenant_id", tenantId)
      .single();
    if (!conv) throw new Error("Conversation not found");
    customerId = customerId ?? (conv.customer_id as string);
    channel = conv.channel as string;
  }
  if (context.callId) {
    const { data: call } = await supabase
      .from("calls")
      .select("customer_id")
      .eq("id", context.callId)
      .eq("tenant_id", tenantId)
      .single();
    if (!call) throw new Error("Call not found");
    customerId = customerId ?? (call.customer_id as string);
    channel = channel ?? "web_chat";
  }

  const result = await runWorkflowEngine({
    supabase,
    userId,
    tenantId,
    workflowId: wf.id as string,
    definitionRaw: wf.definition,
    context: {
      conversationId: context.conversationId,
      callId: context.callId,
      cardId: context.cardId,
      customerId,
      channel,
    },
  });

  revalidatePath("/conversations");
  revalidatePath("/complaints");
  revalidatePath("/overview");
  revalidatePath("/live");
  revalidatePath("/workflows");

  return result;
}
