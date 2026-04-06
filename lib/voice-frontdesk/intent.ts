import type { SupportedIntent } from "./types";

/**
 * Caller clearly ends the call (goodbye) — must work even when intake fields are still missing.
 * Matches Arabic script and common Roman spellings.
 */
export function isExplicitGoodbyeUtterance(raw: string): boolean {
  const u = raw.trim();
  if (!u) return false;
  if (/اللہ\s*حافظ|خدا\s*حافظ|فی\s*امان\s*اللہ|الوداع|خدا\s*حافیز|اللہ\s*حافیظ/i.test(u)) return true;
  const low = u
    .toLowerCase()
    .replace(/[.!،۔?"']+$/g, "")
    .trim();
  if (/\balla?h\s+hafiz\b|\balla?h\s+hafeez\b|\bkhuda\s+hafiz\b|\bkhuda\s+hafeez\b|\balvida\b|\bgood\s*bye\b|\bbye\s*bye\b|\bbye\b$/i.test(low))
    return true;
  return false;
}

/**
 * Short "no thanks / we're done" replies (Roman Urdu + English).
 * Pair with `!nextQuestion` in the service layer unless {@link isExplicitGoodbyeUtterance} applies.
 */
export function isConversationCompleteUtterance(raw: string): boolean {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[.!،۔?"']+$/g, "")
    .trim();
  if (!s) return false;
  if (s.length > 56) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;

  const shortNo = /^(nai|nahi|nahin|na|no|nope|nah|nopes)$/i;
  if (shortNo.test(s)) return true;

  const patterns = [
    /^kuch\s+(nai|nahi|nahin)$/,
    /^(nai|nahi|nahin)\s+(shukriya|thanks|thank you|thank)$/,
    /^(shukriya|thanks|thank you)\s+(bas|nai|nahi|nahin)?$/,
    /^bas$/,
    /^bas\s+(hai|hogaya|ho gaya)$/,
    /^theek\s+hai$/,
    /^thik\s+hai$/,
    /^that'?s\s+all$/,
    /^no\s+(more|thanks|thank you|thank)$/,
    /^i'?m\s+good$/,
    /^all\s+set$/,
  ];
  return patterns.some((re) => re.test(s));
}

/**
 * Job / interview application progress (English, Roman Urdu, Urdu script, light Sindhi/Pashto loanwords).
 * Kept before generic `status_check` so "application status" maps here.
 */
export function mentionsHiringInterviewProgress(raw: string, t: string): boolean {
  if (
    /\b(interview\s+progress|job\s+interview|application\s+status|hiring\s+status|my\s+application|candidate\s+status|recruitment\s+status|shortlisted|shortlist|panel\s+interview|offer\s+stage|where\s+(am\s+i|is\s+my)\s+(in\s+)?(the\s+)?(process|application))\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(progress|status|update)\b.*\b(interview|job|application|hiring|naukri)\b/i.test(t)) return true;
  if (/\b(interview|job|application|hiring)\b.*\b(progress|status|update|bare|baare|kahan)\b/i.test(t)) {
    return true;
  }
  if (/\b(naukri|bharti|rozgaar)\b.*\b(interview|inta|status)\b/i.test(t)) return true;
  if (/\b(apply|applied|applying)\b.*\b(job|position|role|here|bank|company)\b/i.test(t)) return true;
  if (/\b(job|vacancy|position)\b.*\b(apply|applied|application)\b/i.test(t)) return true;
  if (/\btrack\b.*\b(application|job)\b/i.test(t)) return true;
  if (/\b(airon|airan|airin|eren|erron|iron)\s+status\b/i.test(t)) return true;
  if (/\binterv?yu\s+status\b/i.test(t)) return true;

  // Urdu script: job / interview / application status (STT often uses English "اسٹیٹس")
  if (
    /انٹرویو.*(اسٹیٹس|سٹیٹس|حالت|معلوم|جاننا|چیک|پوچھ)/u.test(raw) ||
    /(اسٹیٹس|سٹیٹس|حالت).*(انٹرویو)/u.test(raw)
  ) {
    return true;
  }
  if (/(اپلیکیشن|درخواست|نوکری|ملازمت|بھرتی).*(اسٹیٹس|سٹیٹس|حالت|معلوم|جاننا)/u.test(raw)) return true;
  if (/(مجھے|میں).*(اپنا|اپنی)?\s*(انٹرویو|درخواست|اپلیکیشن).*(معلوم|جاننا|اسٹیٹس|سٹیٹس|حالت)/u.test(raw)) {
    return true;
  }
  // Voice mis-STT: "انٹرویو" heard as ائرن / ایرن / ایرون + status
  if (/(ائرن|ایرن|ایرون|ايرن|اَیرن)\s*(اسٹیٹس|سٹیٹس|حالت|سٹیٹس)/u.test(raw)) return true;

  if (/انٹرویو|ملازمت|درخواست|بھرتی|نوکری/.test(raw)) return true;
  return false;
}

/** Caller lines only — avoids assistant wording falsely triggering hiring detection. */
export function extractCallerLinesFromVoiceTranscript(transcript: string | undefined | null): string {
  if (!transcript?.trim()) return "";
  return transcript
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Caller:"))
    .join("\n")
    .slice(-1200);
}

/**
 * Last assistant turn sounded like a job-application / hiring follow-up (often LLM drift).
 * Next short caller reply should be routed into the hiring phone flow, not generic intake.
 */
export function assistantLastTurnSuggestsJobApplicationFollowUp(transcript: string | undefined | null): boolean {
  if (!transcript?.trim()) return false;
  const lines = transcript
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lastAssistant = [...lines].reverse().find((l) => l.startsWith("Assistant:")) ?? "";
  const a = lastAssistant.replace(/^Assistant:\s*/i, "").trim();
  return (
    /\b(when\s+did\s+(you|i|we)\s+apply|when\s+did\s+you\s+submit|your\s+job\s+application|job\s+application|hiring\s+status|application\s+date|checking\s+your\s+hiring|interview\s+application)\b/i.test(
      a
    ) ||
    /\b(i|we)(\s*'?m|\s+am|\s*'?re)\s+(checking|verifying|looking)\b.*\b(hiring|interview|job\s+application)\b/i.test(
      a
    )
  );
}

export function classifyIntent(input: string): { intent: SupportedIntent; confidence: number } {
  const t = input.toLowerCase();
  if (/\b(abuse|stupid|idiot|fraud)\b/.test(t)) return { intent: "spam_abusive", confidence: 0.8 };
  if (/\b(human|agent|representative|transfer)\b/.test(t))
    return { intent: "human_transfer", confidence: 0.95 };
  if (isExplicitGoodbyeUtterance(input)) return { intent: "conversation_complete", confidence: 0.95 };
  if (isConversationCompleteUtterance(input)) return { intent: "conversation_complete", confidence: 0.92 };
  if (/\b(complaint|shikayat)\b/.test(t)) return { intent: "complaint", confidence: 0.84 };
  if (/\b(bill|billing|charges|fee)\b/.test(t)) return { intent: "billing_question", confidence: 0.78 };
  if (/\b(callback|call me|wapis call)\b/.test(t))
    return { intent: "callback_request", confidence: 0.8 };
  if (/\b(hours|timing|location|office|branch)\b/.test(t))
    return { intent: "office_hours_location", confidence: 0.86 };
  if (
    /\b(atm|withdraw|withdrawal|cash limit|daily limit|transaction limit|debit card|card limit|withdrawal limit)\b/.test(
      t
    )
  )
    return { intent: "general_inquiry", confidence: 0.9 };
  if (mentionsHiringInterviewProgress(input, t)) return { intent: "hiring_interview_status", confidence: 0.9 };
  if (/\b(status|track|reference)\b/.test(t)) return { intent: "status_check", confidence: 0.74 };
  if (/\b(sales|pricing|buy|plan)\b/.test(t)) return { intent: "sales_inquiry", confidence: 0.7 };
  if (/\b(help|support|issue|problem|masla)\b/.test(t))
    return { intent: "support_request", confidence: 0.7 };
  return { intent: "general_inquiry", confidence: 0.5 };
}

/**
 * Same as {@link classifyIntent} on the latest utterance, but also treat the call as hiring when
 * earlier caller lines or the last assistant turn clearly concern job / interview application flow.
 */
export function resolveVoiceIntent(
  utterance: string,
  recentVoiceTranscript: string | undefined | null
): { intent: SupportedIntent; confidence: number } {
  const base = classifyIntent(utterance);
  if (base.intent === "human_transfer" || base.intent === "spam_abusive") return base;
  if (base.intent === "conversation_complete") return base;

  const t = utterance.toLowerCase();
  if (/\b(human|agent|representative|transfer)\b/.test(t)) return base;

  const callerTail = extractCallerLinesFromVoiceTranscript(recentVoiceTranscript);
  const mergedRaw = `${callerTail}\n${utterance}`.trim();
  const mergedLow = mergedRaw.toLowerCase();

  if (mentionsHiringInterviewProgress(mergedRaw, mergedLow)) {
    return { intent: "hiring_interview_status", confidence: Math.max(base.confidence, 0.88) };
  }

  if (
    assistantLastTurnSuggestsJobApplicationFollowUp(recentVoiceTranscript) &&
    utterance.trim().length <= 140
  ) {
    return { intent: "hiring_interview_status", confidence: Math.max(base.confidence, 0.85) };
  }

  return base;
}
