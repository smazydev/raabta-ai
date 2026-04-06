import { getOpenAI } from "@/lib/ai/openai";
import { sliceFromCompletionUsage } from "@/lib/billing/map-openai-usage";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { nextQuestionForMissingField } from "./capture";
import type { CaptureState, VoiceLanguage } from "./types";

const MAX_VOICE_CHARS = 480;

function languageOrderHint(lang: VoiceLanguage, sindhiEnabled: boolean, pashtoEnabled: boolean): string {
  const lines = [
    "PRIMARY: Urdu — default to Urdu (clear, polite; Roman Urdu is fine if easier for TTS).",
    sindhiEnabled
      ? "SECONDARY: Sindhi — if the caller clearly uses or asks for Sindhi, reply in Sindhi."
      : "Sindhi is disabled for this tenant; do not use Sindhi unless the caller insists, then stay in Urdu and apologize briefly.",
    pashtoEnabled
      ? "THIRD: Pashto — if they clearly want Pashto, reply in Pashto."
      : "Pashto is disabled for this tenant; do not use Pashto unless the caller insists, then stay in Urdu.",
  ];
  if (lang === "sd" && sindhiEnabled) lines.unshift("The active call language is Sindhi — respond in Sindhi unless they switch.");
  if (lang === "ps" && pashtoEnabled) lines.unshift("The active call language is Pashto — respond in Pashto unless they switch.");
  if (lang === "ur") lines.unshift("The active call language is Urdu.");
  return lines.join("\n");
}

function buildIntakeSystemPrompt(
  lang: VoiceLanguage,
  sindhiEnabled: boolean,
  pashtoEnabled: boolean
): string {
  return `You are a warm, conversational phone assistant for a Pakistani financial institution — not a rigid form.
${languageOrderHint(lang, sindhiEnabled, pashtoEnabled)}

Sound human: acknowledge what the caller said, use brief empathy where natural, then gently continue the conversation.
Do NOT read a checklist. Do NOT say "step one" or "next question". One or two short sentences, then at most one clear ask.

You may need to learn any of: their name, mobile number, and why they called — only ask for what is still unknown below.
If they already gave something (even informally), do not ask again.
Do **not** ask for CNIC or national ID last digits, full ID number, OTP, or “preferred callback time” unless the caller explicitly requested a callback. Stick to the three fields above when you need anything.
Do **not** ask when the caller applied for a job, interview dates, or hiring timelines — that is handled by a separate hiring flow; if they mention jobs or interviews, only ask for name, phone, or call reason as needed.

If a "Verified knowledge excerpt" is provided and it answers their question, lead with that answer (within one or two short sentences). Do not invent facts beyond it.
If the excerpt contains **amounts or PKR figures**, repeat those **exact** digits and wording — never substitute another rupee amount (e.g. do not say 20,000 if the excerpt says 150,000).

If the excerpt states a **standard or general** rule (e.g. default ATM withdrawal limits for retail customers, published fees), give that fact even when phone or account details are still "missing" in the checklist — those identifiers are **not** required to quote **published** policy. Only ask for phone if you need follow-up on a **personal** case.

Never ask for hawala numbers, unrelated complaint IDs, or topics that neither the caller nor the knowledge excerpt mentioned. Stay on what they asked and what the excerpt supports.

Never promise account actions you cannot perform. Offer human transfer if they are stuck or upset.

Continuity: if a transcript of earlier turns on this call is included, you are mid-conversation. Acknowledge progress; do not repeat the full opening greeting or a generic "how may I help" if they already stated why they called or you already asked something.`;
}

export async function generateConversationalIntakeReply(input: {
  language: VoiceLanguage;
  utterance: string;
  capture: CaptureState;
  /** Still missing after structured extraction */
  missing: { name: boolean; phone: boolean; reason: boolean };
  kbSnippet: string | null;
  model: string;
  sindhiEnabled: boolean;
  pashtoEnabled: boolean;
  /** Prior caller/assistant lines on this call (optional). */
  recentVoiceTranscript?: string;
}): Promise<{ text: string; usage: TokenUsageSlice | null }> {
  const {
    language,
    utterance,
    capture,
    missing,
    kbSnippet,
    model,
    sindhiEnabled,
    pashtoEnabled,
    recentVoiceTranscript,
  } = input;

  const needLines: string[] = [];
  if (missing.name) needLines.push("name (how we should address them)");
  if (missing.phone) needLines.push("mobile phone number for follow-up");
  if (missing.reason) needLines.push("short reason for this call");

  const knownLines: string[] = [];
  if (capture.callerName) knownLines.push(`Name (have): ${capture.callerName}`);
  if (capture.phoneNumber) knownLines.push(`Phone (have): ${capture.phoneNumber}`);
  if (capture.reasonForCall && capture.reasonForCall.length > 3) {
    knownLines.push(`Reason (have): ${capture.reasonForCall.slice(0, 200)}`);
  }

  const prior =
    recentVoiceTranscript?.trim().slice(-3500) ?? "";
  const kb = kbSnippet?.trim() ?? "";
  const strictAmounts =
    kb.length > 0 && /\d/.test(kb) && /PKR|Rs\.?|rupee|روپ/i.test(kb);
  const userMsg = `${prior ? `Earlier turns (same call, may be truncated):\n${prior}\n\n` : ""}Latest caller transcript:\n${utterance}\n\nAlready known:\n${knownLines.length ? knownLines.join("\n") : "(nothing reliable yet)"}\n\nStill need naturally (weave into conversation, do not list):\n${needLines.length ? needLines.join("; ") : "(nothing — just be helpful and brief)"}\n\nVerified knowledge excerpt (optional, may be empty):\n${kb ? kb : "(none)"}${strictAmounts ? "\n\nIMPORTANT: Copy amounts from the excerpt exactly; do not paraphrase numbers." : ""}`;

  try {
    const openai = getOpenAI();
    const res = await openai.chat.completions.create({
      model,
      temperature: strictAmounts ? 0.28 : 0.55,
      max_tokens: 220,
      messages: [
        { role: "system", content: buildIntakeSystemPrompt(language, sindhiEnabled, pashtoEnabled) },
        { role: "user", content: userMsg },
      ],
    });
    let raw = res.choices[0]?.message?.content?.trim() || "";
    if (raw.length > MAX_VOICE_CHARS) raw = `${raw.slice(0, MAX_VOICE_CHARS).trim()}…`;
    if (!raw) {
      const fb = nextQuestionForMissingField(language, capture);
      raw = fb || "برائے مہربانی دوبارہ بولیں۔";
    }
    const usage: TokenUsageSlice | null = res.usage ? sliceFromCompletionUsage(res.usage) : null;
    return { text: raw, usage };
  } catch {
    const fb = nextQuestionForMissingField(language, capture);
    return { text: fb || "برائے مہربانی دوبارہ بولیں۔", usage: null };
  }
}
