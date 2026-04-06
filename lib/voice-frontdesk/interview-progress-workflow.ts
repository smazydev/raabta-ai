/**
 * Mock workflow output for voice happy-path: candidate asks for job / interview application progress.
 * Replace `getMockInterviewProgressPayload` with a real workflow runner when wiring orchestration.
 */

import type { VoiceLanguage } from "./types";

/** Demo-only: only this normalized mobile is treated as having an on-file application. */
export const HIRING_DEMO_APPLICATION_MOBILE_DISPLAY = "03342056691";

const HIRING_DEMO_CANONICAL = "923342056691";

/**
 * Normalize Pakistan mobile strings to 92 + 10-digit national (no leading 0).
 * Accepts 03XXXXXXXXX, 3XXXXXXXXX, +923XXXXXXXXX, 923XXXXXXXXX.
 */
export function normalizePakistanMobileForHiring(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) return `92${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("3")) return `92${d}`;
  if (d.length === 12 && d.startsWith("92")) return d;
  return null;
}

export function hiringApplicationMatchesDemoNumber(normalized: string | null): boolean {
  return normalized === HIRING_DEMO_CANONICAL;
}

export function hiringAskApplicationPhoneMessage(lang: VoiceLanguage): string {
  if (lang === "sd")
    return "پنهنجي نوڪري جي درخواست جي حالت چڪاسڻ لاءِ، صرف اهو موبائل نمبر چئو جيڪو توهان درخواست ۾ ڏنو هو — تاريخ نه؛ مثال 03XXXXXXXXX۔";
  if (lang === "ps")
    return "د دندې غوښتنلیک حالت لپاره یوازې هغه موبایل شمیره ووایاست چې په غوښتنلیک کې مو کارولې — نېټه اړینه نده؛ لکه 03XXXXXXXXX۔";
  if (lang === "ur")
    return "برائے مہربانی صرف وہ موبائل نمبر بولیں جو آپ نے ملازمت کی درخواست پر دیا تھا۔ درخواست کی تاریخ نہیں چاہیے — صرف نمبر، مثلاً 03XXXXXXXXX۔";
  return "To check your job application status, say only the mobile number you used on the application — not the date you applied. For example: zero three three X X X X X X X X X.";
}

export function hiringNoApplicationForNumberMessage(lang: VoiceLanguage): string {
  if (lang === "sd")
    return "اسان وٽ اهڙي ڪابه درخواست ناهي۔";
  if (lang === "ps")
    return "زموږ سره د دې شمیرې لپاره هیڅ غوښتنلیک شتون نلري۔";
  if (lang === "ur")
    return "ایسی کوئی درخواست ہمارے پاس موجود نہیں۔";
  return "We do not have an application on file for that number.";
}

export type MockInterviewProgressPayload = {
  workflowKey: string;
  mockWorkflowRunId: string;
  candidateName: string;
  roleTitle: string;
  currentStageLabel: string;
  summaryLine: string;
  stuckAt: string;
  pendingFromCandidate: string[];
  completedSteps: string[];
  nextStepHint: string;
};

export function getMockInterviewProgressPayload(_input: {
  utterance: string;
  referenceCode?: string;
}): MockInterviewProgressPayload {
  void _input;
  return {
    workflowKey: "candidate_interview_status_v1",
    mockWorkflowRunId: "mock-wf-intvw-7142",
    candidateName: "Sana Malik",
    roleTitle: "Branch Service Officer",
    currentStageLabel: "Document verification",
    summaryLine:
      "Your application passed the phone screen and panel interview round one. HR is now verifying documents before scheduling round two.",
    stuckAt: "File is paused until we receive your attested degree scan and a short gap explanation.",
    pendingFromCandidate: [
      "Bachelor degree — attested scan (PDF)",
      "Brief note explaining the 2024 employment gap",
    ],
    completedSteps: [
      "Application received",
      "Phone screen completed",
      "Panel interview — round one (cleared)",
    ],
    nextStepHint:
      "After documents are approved, you will receive an email to pick a slot for round two within about three business days.",
  };
}

/** Facts string passed to the voice LLM as the approved / verified source (English facts; model localizes). */
/**
 * Fixed spoken script from the mock payload (no LLM) — avoids "checking your status" filler and stalls.
 */
export function mockInterviewProgressSpokenSummary(lang: VoiceLanguage, p: MockInterviewProgressPayload): string {
  if (lang === "ur") {
    return [
      `آپ کی درخواست ${p.roleTitle} کے عہدے کے لیے ہے۔`,
      `موجودہ مرحلہ ${p.currentStageLabel} ہے۔`,
      "فون اسکرین اور پہلا پینل انٹرویو مکمل ہو چکا ہے؛ اب دستاویزات کی تصدیق ہو رہی ہے۔",
      "براہ کرم تصدیق شدہ ڈگرے کا اسکین اور ملازمت کے وقفے کی مختصر وضاحت بھیجیں۔",
      "منظوری کے بعد اگلے تین کاروباری دنوں میں راؤنڈ دو کے لیے وقت منتخب کرنے کی ای میل ملے گی۔",
    ].join(" ");
  }
  if (lang === "sd") {
    return `توھانجو عھدو ${p.roleTitle} آھي. ھاڻوڪو مرحلو ${p.currentStageLabel}. فون اسڪرين ۽ پينل انٽرويو مڪمل، دستاويز تصديق هيٺ آھي. مھرباني ڪري تصديق ٿيل ڊگري اسڪين ۽ وقفي جي مختصر وضاحت موڪليو.`;
  }
  if (lang === "ps") {
    return `ستاسو د ${p.roleTitle} لپاره غوښتنلیک دی. اوسنی پړاو ${p.currentStageLabel}. تلیفون او لومړی پینل انټرویو بشپړ — اوس اسناد تاییدیږي. مهرباني وکړئ تصدیق شوې سندونه او د کار وقفې لنډیز ولېږئ.`;
  }
  const pending = p.pendingFromCandidate.join("; ");
  return `Your application for ${p.roleTitle} is at ${p.currentStageLabel}. ${p.summaryLine} Still needed from you: ${pending}. ${p.nextStepHint}`;
}

export function mockInterviewProgressFactsEnglish(p: MockInterviewProgressPayload): string {
  const pending = p.pendingFromCandidate.map((x) => `• ${x}`).join("\n");
  const done = p.completedSteps.map((x) => `• ${x}`).join("\n");
  return [
    `Verified workflow result (${p.workflowKey}, run ${p.mockWorkflowRunId}).`,
    `Candidate: ${p.candidateName}. Role: ${p.roleTitle}.`,
    `Current stage: ${p.currentStageLabel}.`,
    p.summaryLine,
    `Where it is waiting: ${p.stuckAt}`,
    `Already completed:\n${done}`,
    `Still needed from the candidate:\n${pending}`,
    `What happens next: ${p.nextStepHint}`,
    "Do not invent other stages or documents; only use this list.",
  ].join("\n");
}

export function voiceClosingPhrase(lang: "ur" | "en" | "sd" | "ps"): string {
  if (lang === "ur") return " اللہ حافظ۔";
  if (lang === "sd") return " اللہ حافظ۔";
  if (lang === "ps") return " اللہ پامان۔";
  return " Thank you for calling. Goodbye.";
}
