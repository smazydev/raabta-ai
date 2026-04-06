import type { AppDbClient } from "@/lib/db/types";
import { dbRows } from "@/lib/db/rows";
import { createFrontdeskToolset } from "@/lib/voice-frontdesk/tools";
import { processFrontdeskTurn } from "@/lib/voice-frontdesk/service";
import { redactSensitive } from "@/lib/voice-frontdesk/redact";
import type { SessionSnapshot, VoiceLanguage, SupportedIntent } from "@/lib/voice-frontdesk/types";
import { appendLiveEvent } from "@/lib/orchestration/workflows";
import { resolveOpenAiChatModel } from "@/lib/ai/resolve-model";
import { getTenantAiSettings } from "@/lib/ai/tenant-ai-settings";
import { chargeAfterAggregatedChat } from "@/lib/billing/credits";

export type VoiceFrontdeskTurnSuccess = {
  responseText: string;
  language: string;
  intent: string;
  shouldEscalate: boolean;
  shouldEndCall: boolean;
  escalationReason: string | null;
};

export type VoiceFrontdeskTurnFailure = {
  error: string;
  code?: string;
  status: number;
};

export async function runVoiceFrontdeskTurnForSession(input: {
  supabase: AppDbClient;
  tenantId: string;
  sessionId: string;
  utterance: string;
  asrConfidence?: number;
}): Promise<{ ok: true; data: VoiceFrontdeskTurnSuccess } | { ok: false; failure: VoiceFrontdeskTurnFailure }> {
  const { supabase, tenantId, sessionId, utterance, asrConfidence } = input;

  try {
    const tenantAi = await getTenantAiSettings(supabase, tenantId);
    if (!tenantAi.voiceFrontdeskAi) {
      return {
        ok: false,
        failure: {
          error: "Voice front desk AI is disabled for this tenant (Settings → AI automation).",
          status: 403,
        },
      };
    }

    const { data: row } = await supabase
      .from("voice_frontdesk_sessions")
      .select(
        "id, tenant_id, conversation_id, call_id, customer_id, preferred_language, language_locked, detected_intent, disposition, ai_agent_id, caller_name"
      )
      .eq("id", sessionId)
      .eq("tenant_id", tenantId)
      .single();

    if (!row) {
      return { ok: false, failure: { error: "Session not found", status: 404 } };
    }

    const { data: turnRowsRaw } = await supabase
      .from("voice_frontdesk_turns")
      .select("id, actor, confidence")
      .eq("session_id", sessionId)
      .eq("tenant_id", tenantId);
    const turnRows = dbRows<{ id: string; actor: string; confidence: unknown }>(turnRowsRaw);
    const ambiguityCount = turnRows.filter(
      (t) => t.actor === "caller" && t.confidence !== null && Number(t.confidence) < 0.5
    ).length;

    const disp = (row.disposition as Record<string, unknown> | null) ?? {};
    const snapshot: SessionSnapshot = {
      id: row.id as string,
      tenantId,
      conversationId: (row.conversation_id as string | null) ?? null,
      callId: (row.call_id as string | null) ?? null,
      customerId: (row.customer_id as string | null) ?? null,
      language: (row.preferred_language as VoiceLanguage) ?? "ur",
      languageLocked: Boolean(row.language_locked),
      detectedIntent: (row.detected_intent as SupportedIntent | null) ?? null,
      ambiguityCount,
      capture: {
        callerName: (disp.callerName as string | undefined) ?? undefined,
        phoneNumber: (disp.phoneNumber as string | undefined) ?? undefined,
        preferredLanguage: (disp.preferredLanguage as VoiceLanguage | undefined) ?? undefined,
        reasonForCall: (disp.reasonForCall as string | undefined) ?? undefined,
        customerReference: (disp.customerReference as string | undefined) ?? undefined,
        urgencyLevel: (disp.urgencyLevel as "low" | "medium" | "high" | undefined) ?? undefined,
        callbackRequested: (disp.callbackRequested as boolean | undefined) ?? undefined,
        hiringInterviewAwaitingPhone: (disp.hiringInterviewAwaitingPhone as boolean | undefined) ?? undefined,
      },
    };

    const openAiChatModel = await resolveOpenAiChatModel(supabase, tenantId);

    /** PSTN voice line: hiring mock + scripted prompts only — no tenant KB / vector retrieval. */
    const knowledgeSearchDisabled = true;

    const { data: priorRaw } = await supabase
      .from("voice_frontdesk_turns")
      .select("actor, text")
      .eq("session_id", sessionId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(40);
    const priorTurns = dbRows<{ actor: string; text: string }>(priorRaw ?? []);
    let recentVoiceTranscript = priorTurns
      .map((t) => `${t.actor === "caller" ? "Caller" : "Assistant"}: ${t.text}`)
      .join("\n");
    if (recentVoiceTranscript.length > 3500) {
      recentVoiceTranscript = recentVoiceTranscript.slice(-3500);
    }

    const result = await processFrontdeskTurn({
      supabase,
      tenantId,
      snapshot,
      utterance,
      asrConfidence,
      recentVoiceTranscript: recentVoiceTranscript.trim() || undefined,
      tools: createFrontdeskToolset(supabase, tenantId, { knowledgeSearchDisabled }),
      openAiChatModel,
      deterministicIntakeOnly: true,
      tenantLanguageFlags: {
        sindhiEnabled: tenantAi.voiceFrontdeskSindhi,
        pashtoEnabled: tenantAi.voiceFrontdeskPashto,
      },
    });

    await supabase.from("voice_frontdesk_turns").insert([
      {
        tenant_id: tenantId,
        session_id: sessionId,
        actor: "caller",
        language: result.language,
        text: utterance,
        redacted_text: redactSensitive(utterance),
        confidence: asrConfidence ?? null,
      },
      {
        tenant_id: tenantId,
        session_id: sessionId,
        actor: "assistant",
        language: result.language,
        text: result.responseText,
        redacted_text: redactSensitive(result.responseText),
        confidence: 1,
      },
    ]);

    const prevCallerName = String((row as { caller_name?: string | null }).caller_name ?? "").trim();
    const capturedCallerName = result.updatedCapture.callerName?.trim() || "";
    const callerNameCol = capturedCallerName || prevCallerName || null;

    await supabase
      .from("voice_frontdesk_sessions")
      .update({
        preferred_language: result.language,
        language_locked: true,
        detected_intent: result.intent,
        caller_name: callerNameCol,
        disposition: {
          ...disp,
          ...result.updatedCapture,
          preferredLanguage: result.language,
        },
        tool_calls: result.toolCalls,
        transfer_reason: result.escalationReason ?? null,
        summary: result.transferSummary ?? (result.updatedCapture.reasonForCall ?? utterance),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("tenant_id", tenantId);

    if (capturedCallerName.length >= 2 && row.customer_id) {
      const { data: cust } = await supabase
        .from("customers")
        .select("full_name")
        .eq("id", row.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const currentName = String(cust?.full_name ?? "").trim();
      if (!currentName || currentName.toLowerCase() === "unknown") {
        await supabase
          .from("customers")
          .update({ full_name: capturedCallerName })
          .eq("id", row.customer_id)
          .eq("tenant_id", tenantId);
      }
    }

    if (row.conversation_id) {
      await supabase.from("conversation_messages").insert([
        {
          tenant_id: tenantId,
          conversation_id: row.conversation_id,
          sender: "customer",
          body: utterance,
        },
        {
          tenant_id: tenantId,
          conversation_id: row.conversation_id,
          sender: "ai",
          body: result.responseText,
        },
      ]);
    }

    await appendLiveEvent(supabase, tenantId, "frontdesk.turn", {
      sessionId,
      language: result.language,
      intent: result.intent,
      escalated: result.shouldEscalate,
    });

    if (result.openAiUsages?.length) {
      await chargeAfterAggregatedChat(
        tenantId,
        result.openAiUsages,
        "openai.voice_frontdesk.turn",
        {
          session_id: sessionId,
        },
        openAiChatModel
      );
    }

    return {
      ok: true,
      data: {
        responseText: result.responseText,
        language: result.language,
        intent: result.intent,
        shouldEscalate: result.shouldEscalate,
        shouldEndCall: Boolean(result.shouldEndCall),
        escalationReason: result.escalationReason ?? null,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Turn failed";
    const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code) : "";
    const status =
      code === "INSUFFICIENT_CREDITS" || code === "PAYG_DEBT_CAP" ? 402 : 500;
    await appendLiveEvent(supabase, tenantId, "frontdesk.turn_error", {
      sessionId,
      error: msg,
    });
    return { ok: false, failure: { error: msg, code: code || undefined, status } };
  }
}
