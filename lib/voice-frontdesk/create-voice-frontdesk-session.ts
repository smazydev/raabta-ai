import type { AppDbClient } from "@/lib/db/types";
import { appendLiveEvent } from "@/lib/orchestration/workflows";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Exact phone match first, then last-10-digits match (handles +92 vs 0… vs spaces). */
async function resolveCustomerIdForCaller(
  supabase: AppDbClient,
  tenantId: string,
  callerPhone: string | null
): Promise<string | null> {
  const phoneKey = callerPhone?.replace(/\s/g, "").trim() || null;
  if (phoneKey) {
    const { data: exact } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone", phoneKey)
      .maybeSingle();
    if (exact?.id) return exact.id as string;
  }
  const d = digitsOnly(callerPhone ?? "");
  if (d.length < 9) return null;
  const tail = d.slice(-10);
  const { data: rowsRaw } = await supabase
    .from("customers")
    .select("id, phone")
    .eq("tenant_id", tenantId);
  const rows = (rowsRaw ?? []) as { id: string; phone: string | null }[];
  const hit = rows.find((r) => {
    const pd = digitsOnly(String(r.phone ?? ""));
    return pd.length >= 9 && pd.slice(-10) === tail;
  });
  return (hit?.id as string | undefined) ?? null;
}

export type CreateVoiceFrontdeskSessionInput = {
  supabase: AppDbClient;
  tenantId: string;
  callerPhone: string | null;
  callerName: string | null;
  twilioCallSid?: string | null;
  twilioParentCallSid?: string | null;
};

export type CreatedVoiceFrontdeskSession = {
  id: string;
  conversationId: string | null;
  callId: string | null;
  preferred_language: string;
};

/**
 * Creates conversation, call, and voice_frontdesk_sessions rows (dashboard + Twilio paths).
 * Expects voice front-desk enabled for tenant (caller should check ai_toggles first).
 */
export async function createVoiceFrontdeskSession(
  input: CreateVoiceFrontdeskSessionInput
): Promise<CreatedVoiceFrontdeskSession> {
  const { supabase, tenantId, callerPhone, callerName, twilioCallSid, twilioParentCallSid } = input;

  const { data: settingsRow } = await supabase
    .from("settings")
    .select("ai_toggles")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const toggles = (settingsRow?.ai_toggles as Record<string, unknown> | null) ?? {};
  const voiceAgentRaw = toggles.voice_frontdesk_agent_id;
  const aiAgentId =
    typeof voiceAgentRaw === "string" && voiceAgentRaw.trim().length > 0 ? voiceAgentRaw.trim() : null;

  const phoneKey = callerPhone?.replace(/\s/g, "").trim() || null;
  const matchedId = await resolveCustomerIdForCaller(supabase, tenantId, callerPhone);
  let customer: { id: string } | null = matchedId ? { id: matchedId } : null;
  if (!customer) {
    const { data: created, error: createErr } = await supabase
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: "Unknown",
        phone: phoneKey,
      })
      .select("id")
      .single();
    if (createErr || !created || typeof (created as { id?: unknown }).id !== "string") {
      throw createErr ?? new Error("Could not create caller profile for this session");
    }
    customer = { id: (created as { id: string }).id };
  }

  const { data: conv } = await supabase
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id ?? null,
      channel: "voice",
      status: "active",
      summary: "Voice front-desk intake",
    })
    .select("id")
    .single();

  const { data: call } = await supabase
    .from("calls")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id ?? null,
      status: "active",
      language: "Urdu",
      summary: "Voice front-desk call started",
    })
    .select("id")
    .single();

  const { data: row, error } = await supabase
    .from("voice_frontdesk_sessions")
    .insert({
      tenant_id: tenantId,
      conversation_id: conv?.id ?? null,
      call_id: call?.id ?? null,
      customer_id: customer.id ?? null,
      caller_phone: callerPhone,
      caller_name: callerName,
      twilio_call_sid: twilioCallSid ?? null,
      twilio_parent_call_sid: twilioParentCallSid ?? null,
      ai_agent_id: aiAgentId,
      preferred_language: "ur",
      language_locked: false,
      status: "active",
      disposition: {
        callerName: callerName ?? null,
        phoneNumber: callerPhone ?? null,
      },
    })
    .select("id, conversation_id, call_id, preferred_language")
    .single();

  if (error || !row) throw error ?? new Error("Failed to create session");

  await appendLiveEvent(supabase, tenantId, "frontdesk.session_started", {
    sessionId: row.id,
    conversationId: row.conversation_id,
    callId: row.call_id,
    ...(twilioCallSid ? { twilioCallSid } : {}),
  });

  return {
    id: row.id as string,
    conversationId: (row.conversation_id as string | null) ?? null,
    callId: (row.call_id as string | null) ?? null,
    preferred_language: row.preferred_language as string,
  };
}
