import { getOpenAI } from "@/lib/ai/openai";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";
import { fallbackOpenAiChatModel } from "@/lib/ai/resolve-model";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { generateHandoffSummary } from "@/lib/ai/pipelines";
import { appendLiveEvent } from "@/lib/orchestration/workflows";
import { generateConversationalIntakeReply } from "./conversational-intake";
import {
  extractPhoneFromUtterance,
  missingIntakeFields,
  nextQuestionForMissingField,
  updateCaptureFromUtterance,
} from "./capture";
import { isExplicitGoodbyeUtterance, resolveVoiceIntent } from "./intent";
import { detectLanguageFromText, languageFlagsFromEnv, resolveLanguage } from "./language";
import { systemPromptForLanguage } from "./prompt";
import {
  hiringApplicationMatchesDemoNumber,
  hiringAskApplicationPhoneMessage,
  hiringNoApplicationForNumberMessage,
  mockInterviewProgressSpokenSummary,
  normalizePakistanMobileForHiring,
  voiceClosingPhrase,
} from "@/lib/voice-frontdesk/interview-progress-workflow";
import type { CaptureState, SessionSnapshot, SupportedIntent, TurnResult, VoiceLanguage } from "./types";
import type { FrontdeskToolset } from "./tools";
import type { AppDbClient } from "@/lib/db/types";

const MIN_USEFUL_KB_CHARS = 40;

/** English boost for semantic search when the caller uses Urdu/Roman Urdu for limits/ATM. */
const ATM_POLICY_SEARCH_BOOST =
  "ATM withdrawal daily debit card limit PKR standard retail customer published policy";

function knowledgeAnswerLooksUseful(faq: string | null): boolean {
  return (faq?.trim().length ?? 0) >= MIN_USEFUL_KB_CHARS;
}

/** Caller is asking for a general published rule (limits, standard ATM policy), not account-specific servicing. */
function callerAsksPublishedPolicyOrLimit(raw: string): boolean {
  const u = raw.trim();
  if (!u) return false;
  const low = u.toLowerCase();
  if (
    /\b(atm|withdraw|withdrawal|limit|debit|card|daily|pkr|retail|standard|general|published|policy)\b/.test(low)
  )
    return true;
  if (
    /اے\s*ٹی\s*ایم|اے ٹی ایم|ای ٹی ایم|ایٹی\s*ایم|لیمیٹ|لمیٹ|نکال|کیش|روزانہ|ڈےلی|ڈیلی|جنرل|عمومی|عام|سٹینڈرڈ|پالیسی/.test(
      u
    )
  )
    return true;
  return false;
}

function enrichKnowledgeSearchQuery(base: string, utterancePlusContext: string): string {
  const merged = `${base} ${utterancePlusContext}`.trim();
  if (!callerAsksPublishedPolicyOrLimit(utterancePlusContext)) return merged.slice(0, 800);
  return `${merged} ${ATM_POLICY_SEARCH_BOOST}`.slice(0, 800);
}

/** When KB has a substantive hit, answer the question instead of forcing intake first. */
function shouldAnswerKnowledgeBeforeIntake(
  intent: SupportedIntent,
  faq: string | null,
  utterancePlusContext: string
): boolean {
  if (!knowledgeAnswerLooksUseful(faq)) return false;
  if (callerAsksPublishedPolicyOrLimit(utterancePlusContext)) return true;
  const informational: SupportedIntent[] = [
    "general_inquiry",
    "office_hours_location",
    "billing_question",
    "sales_inquiry",
    "support_request",
    "status_check",
  ];
  return informational.includes(intent);
}

/** Detect when the model invented a rupee/amount not present in the verified KB text. */
function responseInventsMajorAmountNotInFaq(response: string, faq: string): boolean {
  const nums = (s: string) =>
    [...s.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{4,7})\b/g)].map((m) => m[1].replace(/,/g, ""));
  const fromFaq = new Set(nums(faq));
  if (fromFaq.size === 0) return false;
  for (const r of nums(response)) {
    if (!fromFaq.has(r)) return true;
  }
  return false;
}

/** Short excerpt from knowledge base for voice (avoid long Play URLs / timeouts). */
function snippetForVoice(text: string, maxLen = 360): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSentence = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("۔"));
  if (lastSentence > 60) return cut.slice(0, lastSentence + 1).trim();
  return `${cut.trim()}…`;
}

async function aiReply(
  language: VoiceLanguage,
  userText: string,
  faq: string | null,
  model: string,
  recentTranscript?: string | null
): Promise<{ text: string; usage: TokenUsageSlice | null }> {
  const openai = getOpenAI();
  const tail = recentTranscript?.trim().slice(-3500);
  const policyHint =
    callerAsksPublishedPolicyOrLimit(userText) || (tail && callerAsksPublishedPolicyOrLimit(tail))
      ? " If the approved answer is a general policy for all customers (e.g. standard limits), state it; do not require account or phone for that."
      : "";
  const amountHint =
    faq && /\d/.test(faq) && /PKR|Rs\.?|rupee/i.test(faq)
      ? " Copy every PKR amount and number from the approved answer exactly — do not use any other figure."
      : "";
  const userContent = tail
    ? `Earlier in this same call (may be truncated):\n${tail}\n\nLatest caller message: ${userText}\nApproved answer: ${faq ?? "(none)"}\nRespond briefly.${policyHint}${amountHint} Continue the thread — do not repeat the full opening greeting or broad "how may I help" if the topic was already underway.`
    : `Caller: ${userText}\nApproved answer: ${faq ?? "(none)"}\nRespond briefly.${policyHint}${amountHint}`;
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.42,
    messages: [
      { role: "system", content: systemPromptForLanguage(language) },
      {
        role: "user",
        content: userContent,
      },
    ],
  });
  const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
  return {
    text: res.choices[0]?.message?.content?.trim() || "",
    usage,
  };
}

async function completeHiringInterviewWithMockWorkflow(input: {
  supabase: AppDbClient;
  tenantId: string;
  snapshot: SessionSnapshot;
  lang: VoiceLanguage;
  utterance: string;
  updatedCapture: CaptureState;
  tools: FrontdeskToolset;
  toolCalls: TurnResult["toolCalls"];
  openAiUsages: TokenUsageSlice[];
}): Promise<TurnResult> {
  const { supabase, tenantId, snapshot, lang, utterance, updatedCapture, tools, toolCalls, openAiUsages } =
    input;
  const ref = updatedCapture.customerReference?.trim();
  const payload = await tools.runMockInterviewProgressWorkflow({
    utterance,
    referenceCode: ref || null,
  });
  toolCalls.push({ name: "runMockInterviewProgressWorkflow", ok: true, ref: payload.mockWorkflowRunId });
  const summary = mockInterviewProgressSpokenSummary(lang, payload);
  const responseText = snippetForVoice(`${summary.trim()}${voiceClosingPhrase(lang)}`, 420);
  await tools.saveDisposition({
    sessionId: snapshot.id,
    summary: `Interview status (mock workflow ${payload.mockWorkflowRunId})`,
    intent: "hiring_interview_status",
    outcome: "resolved",
    disposition: {
      language: lang,
      workflowKey: payload.workflowKey,
      mockWorkflowRunId: payload.mockWorkflowRunId,
      currentStage: payload.currentStageLabel,
    },
  });
  toolCalls.push({ name: "saveDisposition", ok: true });
  await appendLiveEvent(supabase, tenantId, "frontdesk.turn_processed", {
    sessionId: snapshot.id,
    intent: "hiring_interview_status",
    language: lang,
    escalated: false,
    mockWorkflowRunId: payload.mockWorkflowRunId,
  });
  return {
    responseText,
    language: lang,
    intent: "hiring_interview_status",
    shouldEscalate: false,
    shouldEndCall: true,
    updatedCapture,
    disposition: { outcome: "resolved" },
    toolCalls,
    openAiUsages,
  };
}

export async function processFrontdeskTurn(input: {
  supabase: AppDbClient;
  tenantId: string;
  snapshot: SessionSnapshot;
  utterance: string;
  asrConfidence?: number;
  tools: FrontdeskToolset;
  generateReply?: (language: VoiceLanguage, userText: string, faq: string | null) => Promise<string>;
  tenantLanguageFlags?: { sindhiEnabled?: boolean; pashtoEnabled?: boolean };
  /** When omitted, uses env / default chat model. */
  openAiChatModel?: string;
  /** Prior turns on this PSTN session (caller/assistant), for continuity. */
  recentVoiceTranscript?: string;
  /**
   * When true, intake uses fixed `nextQuestion` strings only (no conversational LLM).
   * Stops invented questions like “when did you apply” on the voice line.
   */
  deterministicIntakeOnly?: boolean;
}): Promise<TurnResult> {
  const { supabase, tenantId, snapshot, utterance, asrConfidence, tools } = input;
  const chatModel = input.openAiChatModel?.trim() || fallbackOpenAiChatModel();
  const toolCalls: TurnResult["toolCalls"] = [];
  const openAiUsages: TokenUsageSlice[] = [];

  const det = detectLanguageFromText(utterance);
  const langCandidate = snapshot.languageLocked ? snapshot.language : det.language;
  const envFlags = languageFlagsFromEnv();
  const resolved = resolveLanguage(langCandidate, {
    urduEnabled: envFlags.urduEnabled,
    sindhiEnabled: input.tenantLanguageFlags?.sindhiEnabled ?? envFlags.sindhiEnabled,
    pashtoEnabled: input.tenantLanguageFlags?.pashtoEnabled ?? envFlags.pashtoEnabled,
  });
  const lang = resolved.language;
  const lowConfidence = (asrConfidence ?? det.confidence) < 0.5;
  const ambiguityCount = snapshot.ambiguityCount + (lowConfidence ? 1 : 0);
  if (ambiguityCount >= 2) {
    const reason = "Repeated low-confidence speech recognition";
    await tools.transferToHuman({ sessionId: snapshot.id, reason });
    toolCalls.push({ name: "transferToHuman", ok: true });
    return {
      responseText:
        lang === "ur"
          ? "معذرت، آواز واضح نہیں آرہی۔ میں آپ کو ہمارے انسانی نمائندے سے ملاتا ہوں۔"
          : "Sorry, I could not hear clearly. I am transferring you to a human agent.",
      language: lang,
      intent: "human_transfer",
      shouldEscalate: true,
      escalationReason: reason,
      updatedCapture: { ...snapshot.capture, preferredLanguage: lang },
      toolCalls,
      openAiUsages,
    };
  }

  const intentInfo = resolveVoiceIntent(utterance, input.recentVoiceTranscript);
  const knowledgeQueryBase =
    intentInfo.intent !== "general_inquiry" && intentInfo.intent !== "conversation_complete"
      ? `${utterance} ${intentInfo.intent.replace(/_/g, " ")}`
      : utterance;
  const transcriptTail = input.recentVoiceTranscript?.trim().slice(-900) ?? "";
  const policySearchContext = `${utterance}\n${transcriptTail}`.trim();
  let knowledgeQuery = enrichKnowledgeSearchQuery(knowledgeQueryBase, policySearchContext);
  const updatedCapture = updateCaptureFromUtterance(
    {
      ...snapshot.capture,
      preferredLanguage: snapshot.capture.preferredLanguage ?? lang,
    },
    utterance
  );

  if (intentInfo.intent === "human_transfer" || intentInfo.intent === "spam_abusive") {
    const reason =
      intentInfo.intent === "human_transfer" ? "Caller requested human transfer" : "Potential abusive caller";
    await tools.transferToHuman({ sessionId: snapshot.id, reason });
    toolCalls.push({ name: "transferToHuman", ok: true });
    const { text: transferSummary, usage: sumUsage } = await generateHandoffSummary({
      context: `Language: ${lang}. Intent: ${intentInfo.intent}. Caller said: ${utterance}`,
      model: chatModel,
    });
    if (sumUsage) openAiUsages.push(sumUsage);
    return {
      responseText:
        lang === "ur"
          ? "میں آپ کی کال انسانی ایجنٹ کو ٹرانسفر کر رہا ہوں۔"
          : "I am transferring your call to a human agent now.",
      language: lang,
      intent: intentInfo.intent,
      shouldEscalate: true,
      escalationReason: reason,
      updatedCapture,
      transferSummary,
      toolCalls,
      openAiUsages,
    };
  }

  if (snapshot.capture.hiringInterviewAwaitingPhone) {
    const phoneRaw = extractPhoneFromUtterance(utterance);
    const normalized = normalizePakistanMobileForHiring(phoneRaw);
    const baseCapture: CaptureState = { ...updatedCapture, preferredLanguage: lang };

    if (!normalized) {
      return {
        responseText: snippetForVoice(hiringAskApplicationPhoneMessage(lang), 380),
        language: lang,
        intent: "hiring_interview_status",
        shouldEscalate: false,
        shouldEndCall: false,
        updatedCapture: { ...baseCapture, hiringInterviewAwaitingPhone: true },
        toolCalls,
        openAiUsages,
      };
    }

    const clearedCapture: CaptureState = {
      ...baseCapture,
      hiringInterviewAwaitingPhone: false,
      phoneNumber: baseCapture.phoneNumber ?? phoneRaw,
    };

    if (!hiringApplicationMatchesDemoNumber(normalized)) {
      const responseText = snippetForVoice(
        `${hiringNoApplicationForNumberMessage(lang)}${voiceClosingPhrase(lang)}`,
        420
      );
      await tools.saveDisposition({
        sessionId: snapshot.id,
        summary: "Hiring application lookup — no record for number provided",
        intent: "hiring_interview_status",
        outcome: "resolved",
        disposition: { language: lang, hiringLookupResult: "not_found" },
      });
      toolCalls.push({ name: "saveDisposition", ok: true });
      await appendLiveEvent(supabase, tenantId, "frontdesk.turn_processed", {
        sessionId: snapshot.id,
        intent: "hiring_interview_status",
        language: lang,
        escalated: false,
        hiringLookupResult: "not_found",
      });
      return {
        responseText,
        language: lang,
        intent: "hiring_interview_status",
        shouldEscalate: false,
        shouldEndCall: true,
        updatedCapture: clearedCapture,
        disposition: { outcome: "resolved" },
        toolCalls,
        openAiUsages,
      };
    }

    return completeHiringInterviewWithMockWorkflow({
      supabase,
      tenantId,
      snapshot,
      lang,
      utterance,
      updatedCapture: clearedCapture,
      tools,
      toolCalls,
      openAiUsages,
    });
  }

  if (intentInfo.intent === "hiring_interview_status") {
    const phoneRaw = extractPhoneFromUtterance(utterance);
    const normalized = normalizePakistanMobileForHiring(phoneRaw);
    const baseCapture: CaptureState = { ...updatedCapture, preferredLanguage: lang };

    if (!normalized) {
      return {
        responseText: snippetForVoice(hiringAskApplicationPhoneMessage(lang), 380),
        language: lang,
        intent: "hiring_interview_status",
        shouldEscalate: false,
        shouldEndCall: false,
        updatedCapture: { ...baseCapture, hiringInterviewAwaitingPhone: true },
        toolCalls,
        openAiUsages,
      };
    }

    if (!hiringApplicationMatchesDemoNumber(normalized)) {
      const clearedCapture: CaptureState = {
        ...baseCapture,
        hiringInterviewAwaitingPhone: false,
        phoneNumber: baseCapture.phoneNumber ?? phoneRaw,
      };
      const responseText = snippetForVoice(
        `${hiringNoApplicationForNumberMessage(lang)}${voiceClosingPhrase(lang)}`,
        420
      );
      await tools.saveDisposition({
        sessionId: snapshot.id,
        summary: "Hiring application lookup — no record for number provided",
        intent: "hiring_interview_status",
        outcome: "resolved",
        disposition: { language: lang, hiringLookupResult: "not_found" },
      });
      toolCalls.push({ name: "saveDisposition", ok: true });
      await appendLiveEvent(supabase, tenantId, "frontdesk.turn_processed", {
        sessionId: snapshot.id,
        intent: "hiring_interview_status",
        language: lang,
        escalated: false,
        hiringLookupResult: "not_found",
      });
      return {
        responseText,
        language: lang,
        intent: "hiring_interview_status",
        shouldEscalate: false,
        shouldEndCall: true,
        updatedCapture: clearedCapture,
        disposition: { outcome: "resolved" },
        toolCalls,
        openAiUsages,
      };
    }

    return completeHiringInterviewWithMockWorkflow({
      supabase,
      tenantId,
      snapshot,
      lang,
      utterance,
      updatedCapture: {
        ...baseCapture,
        hiringInterviewAwaitingPhone: false,
        phoneNumber: baseCapture.phoneNumber ?? phoneRaw,
      },
      tools,
      toolCalls,
      openAiUsages,
    });
  }

  const nextQuestion = nextQuestionForMissingField(lang, updatedCapture);

  if (
    intentInfo.intent === "conversation_complete" &&
    (!nextQuestion || isExplicitGoodbyeUtterance(utterance))
  ) {
    const goodbye =
      lang === "ur"
        ? "آپ سے بات کر کے خوشی ہوئی۔ اللہ حافظ۔"
        : "Thank you for calling. Goodbye.";
    await tools.saveDisposition({
      sessionId: snapshot.id,
      summary: updatedCapture.reasonForCall ?? utterance,
      intent: "conversation_complete",
      outcome: "resolved",
      disposition: {
        language: lang,
        callbackRequested: updatedCapture.callbackRequested ?? false,
        urgency: updatedCapture.urgencyLevel ?? "medium",
      },
    });
    toolCalls.push({ name: "saveDisposition", ok: true });
    await appendLiveEvent(supabase, tenantId, "frontdesk.turn_processed", {
      sessionId: snapshot.id,
      intent: "conversation_complete",
      language: lang,
      escalated: false,
    });
    return {
      responseText: goodbye,
      language: lang,
      intent: "conversation_complete",
      shouldEscalate: false,
      shouldEndCall: true,
      updatedCapture,
      disposition: { outcome: "resolved" },
      toolCalls,
      openAiUsages,
    };
  }

  let faq = await tools.getFaqAnswer(knowledgeQuery);
  if (!knowledgeAnswerLooksUseful(faq) && callerAsksPublishedPolicyOrLimit(policySearchContext)) {
    const fb = await tools.getFaqAnswer(ATM_POLICY_SEARCH_BOOST);
    if (knowledgeAnswerLooksUseful(fb)) faq = fb;
  }
  toolCalls.push({ name: "getFaqAnswer", ok: Boolean(faq) });

  if (nextQuestion && shouldAnswerKnowledgeBeforeIntake(intentInfo.intent, faq, policySearchContext)) {
    const ar = await aiReply(lang, utterance, faq, chatModel, input.recentVoiceTranscript);
    if (ar.usage) openAiUsages.push(ar.usage);
    let responseText = ar.text.trim();
    if (!responseText) responseText = snippetForVoice(faq!.trim());
    else if (faq && responseInventsMajorAmountNotInFaq(responseText, faq)) {
      responseText = snippetForVoice(faq.trim());
    }
    return {
      responseText,
      language: lang,
      intent: intentInfo.intent,
      shouldEscalate: false,
      updatedCapture,
      toolCalls,
      openAiUsages,
    };
  }

  if (nextQuestion) {
    const kbSnippet = faq?.trim() ? snippetForVoice(faq.trim()) : null;
    if (input.deterministicIntakeOnly) {
      const responseText = kbSnippet
        ? lang === "ur"
          ? `${kbSnippet} ${nextQuestion}`
          : `${kbSnippet} ${nextQuestion}`
        : nextQuestion;
      return {
        responseText,
        language: lang,
        intent: intentInfo.intent,
        shouldEscalate: false,
        updatedCapture,
        toolCalls,
        openAiUsages,
      };
    }
    const missing = missingIntakeFields(updatedCapture);
    const conv = await generateConversationalIntakeReply({
      language: lang,
      utterance,
      capture: updatedCapture,
      missing,
      kbSnippet,
      model: chatModel,
      sindhiEnabled: input.tenantLanguageFlags?.sindhiEnabled ?? envFlags.sindhiEnabled,
      pashtoEnabled: input.tenantLanguageFlags?.pashtoEnabled ?? envFlags.pashtoEnabled,
      recentVoiceTranscript: input.recentVoiceTranscript,
    });
    if (conv.usage) openAiUsages.push(conv.usage);
    let responseText = conv.text.trim();
    if (
      kbSnippet &&
      responseText &&
      responseInventsMajorAmountNotInFaq(responseText, kbSnippet)
    ) {
      responseText =
        lang === "ur"
          ? `${kbSnippet} ${nextQuestion}`
          : `${kbSnippet} ${nextQuestion}`;
    }
    if (!responseText) {
      responseText = nextQuestion;
      if (kbSnippet) {
        responseText =
          lang === "ur"
            ? `${kbSnippet} ${nextQuestion}`
            : `${kbSnippet} Now, ${nextQuestion.charAt(0).toLowerCase()}${nextQuestion.slice(1)}`;
      }
    }
    return {
      responseText,
      language: lang,
      intent: intentInfo.intent,
      shouldEscalate: false,
      updatedCapture,
      toolCalls,
      openAiUsages,
    };
  }
  let responseText: string;
  if (input.generateReply) {
    responseText = await input.generateReply(lang, utterance, faq);
  } else {
    const ar = await aiReply(lang, utterance, faq, chatModel, input.recentVoiceTranscript);
    responseText = ar.text;
    if (ar.usage) openAiUsages.push(ar.usage);
  }
  if (faq && responseText?.trim() && responseInventsMajorAmountNotInFaq(responseText, faq)) {
    responseText = snippetForVoice(faq.trim());
  }
  let outcome: "resolved" | "callback_scheduled" | "ticket_created" = "resolved";

  if (intentInfo.intent === "callback_request" || updatedCapture.callbackRequested) {
    try {
      const cb = await tools.requestCallback({
        sessionId: snapshot.id,
        customerId: null,
        phone: updatedCapture.phoneNumber,
        reason: updatedCapture.reasonForCall,
      });
      toolCalls.push({ name: "requestCallback", ok: true, ref: cb.id });
      outcome = "callback_scheduled";
      responseText =
        lang === "ur"
          ? "شکریہ، آپ کی کال بیک درخواست درج کر دی گئی ہے۔"
          : "Thank you, your callback request is registered.";
    } catch (e) {
      toolCalls.push({
        name: "requestCallback",
        ok: false,
        error: e instanceof Error ? e.message : "callback failed",
      });
    }
  } else if (intentInfo.intent === "complaint" || intentInfo.intent === "support_request") {
    try {
      const ticket = await tools.createTicket({
        customerId: snapshot.customerId,
        summary: updatedCapture.reasonForCall ?? utterance,
        callId: snapshot.callId,
      });
      toolCalls.push({ name: "createTicket", ok: true, ref: ticket.ref });
      outcome = "ticket_created";
      responseText =
        lang === "ur"
          ? `ہم نے آپ کی شکایت درج کر دی ہے۔ ریفرنس: ${ticket.ref}`
          : `We have created your support ticket. Reference: ${ticket.ref}`;
    } catch (e) {
      toolCalls.push({
        name: "createTicket",
        ok: false,
        error: e instanceof Error ? e.message : "ticket failed",
      });
    }
  }

  await tools.saveDisposition({
    sessionId: snapshot.id,
    summary: updatedCapture.reasonForCall ?? utterance,
    intent: intentInfo.intent,
    outcome,
    disposition: {
      language: lang,
      callbackRequested: updatedCapture.callbackRequested ?? false,
      urgency: updatedCapture.urgencyLevel ?? "medium",
    },
  });
  toolCalls.push({ name: "saveDisposition", ok: true });

  await appendLiveEvent(supabase, tenantId, "frontdesk.turn_processed", {
    sessionId: snapshot.id,
    intent: intentInfo.intent,
    language: lang,
    escalated: false,
  });

  return {
    responseText,
    language: lang,
    intent: intentInfo.intent,
    shouldEscalate: false,
    updatedCapture,
    disposition: { outcome },
    toolCalls,
    openAiUsages,
  };
}
