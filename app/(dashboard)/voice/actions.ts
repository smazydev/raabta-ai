"use server";

import { revalidatePath } from "next/cache";
import { isOpenAiConfigured } from "@/lib/ai/openai";
import { resolveOpenAiChatModel } from "@/lib/ai/resolve-model";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { generateHandoffSummary } from "@/lib/ai/pipelines";
import { getSessionTenant } from "@/lib/session";
import { chargeAfterChatCompletion } from "@/lib/billing/credits";
import * as workflows from "@/lib/orchestration/workflows";

export async function freezeCardVoiceAction(callId: string, cardId: string) {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  await workflows.freezeCardForCustomer(supabase, tenantId, cardId);
  const { data: call } = await supabase.from("calls").select("customer_id").eq("id", callId).single();
  if (call && typeof call.customer_id === "string") {
    await workflows.createComplaintRecord({
      supabase,
      tenantId,
      customerId: call.customer_id,
      channel: "voice",
      category: "Card / fraud",
      summary: "Voice channel: card frozen after suspicious activity discussion.",
      callId,
      priority: "high",
    });
  }
  revalidatePath("/voice");
  revalidatePath("/complaints");
}

export async function escalateCallAction(callId: string) {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  await supabase
    .from("calls")
    .update({ status: "escalated" })
    .eq("id", callId)
    .eq("tenant_id", tenantId);
  const { data: call } = await supabase
    .from("calls")
    .select("customer_id, transcript, summary")
    .eq("id", callId)
    .single();
  if (call) {
    const text =
      typeof call.transcript === "string"
        ? call.transcript
        : JSON.stringify(call.transcript);
    const prior =
      typeof call.summary === "string" ? call.summary : call.summary != null ? JSON.stringify(call.summary) : "";
    let summary = prior || "Voice call escalated.";
    try {
      const ai = await getTenantAiSettings(supabase, tenantId);
      if (isOpenAiConfigured() && ai.summaries) {
        const model = await resolveOpenAiChatModel(supabase, tenantId);
        const { text: aiSummary, usage } = await generateHandoffSummary({
          context: `${prior}\n${text}`,
          model,
        });
        summary = aiSummary;
        await chargeAfterChatCompletion(tenantId, usage, "openai.ui.voice_escalation", { callId }, model);
      }
    } catch {
      /* OPENAI optional / billing skip */
    }
    await workflows.saveAgentSummary({
      supabase,
      tenantId,
      summary,
      callId,
      nextActions: ["Review fee policy", "Callback customer"],
    });
  }
  await workflows.appendLiveEvent(supabase, tenantId, "voice.escalated", { callId });
  revalidatePath("/voice");
  revalidatePath("/assist");
}

export async function completeCallAction(callId: string) {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  await supabase
    .from("calls")
    .update({ status: "resolved", ended_at: new Date().toISOString() })
    .eq("id", callId)
    .eq("tenant_id", tenantId);
  revalidatePath("/voice");
}

export async function voiceComplaintAction(callId: string) {
  const session = await getSessionTenant();
  if (!session) throw new Error("Unauthorized");
  const { supabase, tenantId } = session;
  const { data: call } = await supabase.from("calls").select("customer_id").eq("id", callId).single();
  if (!call || typeof call.customer_id !== "string") throw new Error("Call not found");
  await workflows.createComplaintRecord({
    supabase,
    tenantId,
    customerId: call.customer_id,
    channel: "voice",
    category: "General",
    summary: "Complaint created from voice console.",
    callId,
    priority: "medium",
  });
  revalidatePath("/voice");
  revalidatePath("/complaints");
}
